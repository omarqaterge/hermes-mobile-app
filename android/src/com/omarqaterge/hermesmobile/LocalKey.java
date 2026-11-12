package com.omarqaterge.hermesmobile;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * The one owner of the shared key that local authentication ({@link LocalAuth}) and the raw key header use: the app's
 * listener, the app as a client and the copy for Termux all take it from here, so a rotation reaches every one of them.
 * Kept in the {@code hermes} preferences ({@link Store}, the glue is {@code HermesService.keys}): {@code event_key} (the
 * current key), {@code event_key_prev} and {@code event_key_prev_until} (the previous key and the end of its grace, in
 * epoch ms), {@code event_key_version} (the app version the current key was made under), {@code event_key_rotated_at},
 * {@code event_key_seen}, and the switch's own entries ({@link #tick}).
 *
 * <p>{@link #rotate} keeps the previous key accepted for {@link #GRACE_MS} (24 h), so Termux processes that still hold
 * it keep working until the new key file reaches them; {@link #confirm} (the first request verified under the new key)
 * cuts that to {@link #CONFIRM_MS} (2 min) for requests already in flight. Rotations are limited ({@link #rotateWait}):
 * at most one every {@link #MIN_ROTATE_MS}, never while the previous key is in its grace and Termux has not yet shown
 * it holds the current one (so at most the current key and one previous one ever count, and none Termux may still use
 * is dropped early), {@code update} once per app version, {@code enforce} once, {@code legacy_seen} once a day.
 *
 * <p><b>The switch</b> ({@link #tick}, {@link #confirm}): the raw key stays accepted during a compatibility window
 * after an update that brings local authentication. The window closes in three recorded steps, each surviving a crash
 * before the next: (1) the key is rotated ({@code why=enforce}) and {@code local_enforce_kid} saved with it in one
 * commit; (2) the new key and {@code ~/.hermes-mobile/enforced} are written to Termux in one command
 * ({@link #shareCommand(String, Mode)}, {@link Mode#ENFORCED}; the {@code enforced} file before the key, so a Termux
 * holding the new key always has the file too), and every later share uses that command; (3) {@code local_enforced}
 * is saved, after which the app's listener refuses the raw key ({@link #rawAccepted}): only once a request verified
 * under a key written by step 2 arrives from Termux ({@link #confirm}), or once the cap ({@link #CAP_MS}) is reached.
 *
 * <p>Plain Java (no Android classes) so {@code tools/test_local_key.sh} tests it with a JDK. No method returns or throws
 * a key in its message, and {@link #toString} names none. Thread-safe.
 *
 * <p>RELEASE-CHECKLIST (before the first release with local authentication; spec 7.5 has the whole list, and 2.3 "The
 * compatibility window"; also: check the plugin loads on the oldest supported Hermes with {@code tools/hermes-contract},
 * measure battery and the viewer's frame rate on a phone, update the README's privacy list after the release):
 * <ol>
 * <li>Set {@link LocalDashboard#P_HELLO} as its own note says (the merge's commit time). While it is 0 a plugin counts as
 *     speaking the hello only when it is at least as new as the APK's own, which is safe, only stricter.</li>
 * <li>Ship the app and the plugin together (the APK carries the plugin, {@code PluginSync}): no release between the
 *     first merge of local authentication and this switch.</li>
 * <li>{@code BgHost} ordering: the plugin starts it with {@code HM_AUTH=mac} and the app signs its requests to it; both
 *     halves are in the same release.</li>
 * <li>Rollback, if ever needed: a release with {@link #ENFORCE} false. Its key share removes
 *     {@code ~/.hermes-mobile/enforced} ({@link Mode#OPEN}), its listener accepts the raw key again, and its first look
 *     forgets the switch's saved steps, the cap's row and the window ({@link #forgetSwitch}), so the next release with it
 *     on starts a new window and waits for the conditions (or a new cap) instead of enforcing at once.</li>
 * <li>Owner decisions still open (the defaults here): a scheduled rotation and a "Reset" row in Settings (none:
 *     rotation only at the switch, after an app update and after {@code legacy_seen}); a line in Settings while the
 *     window lasts (none: diagnostics only).</li>
 * </ol>
 */
final class LocalKey implements LocalClient.KeySet {
    /** The switch is built in: once {@link #tick} and {@link #confirm} have closed the window, the raw key is refused. */
    static final boolean ENFORCE = true;
    static final long GRACE_MS = 24 * 3_600_000L;
    static final long CONFIRM_MS = 120_000L;
    /** The shortest time between two rotations, whatever asks for them. */
    static final long MIN_ROTATE_MS = 5 * 60_000L;
    /** A {@code legacy_seen} rotation at most this often. */
    static final long LEGACY_EVERY_MS = 24 * 3_600_000L;
    /** The window ends at the latest this long after it began ({@link #window}), whatever the conditions say. */
    static final long CAP_MS = 14 * 24 * 3_600_000L;
    /** While Termux has not shown it holds the current key, the key is shared again at most this often. */
    static final long RESHARE_MS = 10 * 60_000L;
    /** Why a key is replaced; the diagnostic event {@code local key_rotated} names one of these. */
    static final List<String> WHYS = Collections.unmodifiableList(Arrays.asList("update", "enforce", "legacy_seen", "user"));

    static final String P_KEY = "event_key", P_PREV = "event_key_prev", P_PREV_UNTIL = "event_key_prev_until",
            P_VERSION = "event_key_version", P_ENFORCED = "local_enforced", P_ROTATED_AT = "event_key_rotated_at",
            P_SEEN = "event_key_seen", P_VERIFIED = "local_verified", P_SCRIPTS_OK = "local_scripts_ok",
            P_ENFORCE_KID = "local_enforce_kid", P_CAP = "local_cap", P_LEGACY_AT = "local_legacy_at",
            P_LEGACY_SEEN_AT = "local_legacy_seen_at", P_LEGACY_RUN = "local_legacy_run", P_LEGACY_PAUSED = "local_legacy_paused",
            P_WINDOW_VERSION = "local_window_version", P_WINDOW_MS = "local_window_ms", P_WINDOW_SEEN = "local_window_seen",
            P_WINDOW_BOOT = "local_window_boot", P_TICKER = "local_ticker_ok";
    /** While the window is open the app looks at it at least this often (a non-waking alarm: {@link #lookAgainMs}). */
    static final long LOOK_EVERY_MS = 3_600_000L;
    /** While the cap's Setup row is on, {@code legacy_seen} rotations stop after this many in a row (they can't help). */
    static final int LEGACY_MAX_RUN = 3;

    /** What a key share writes in Termux besides the key ({@link #shareCommand(String, Mode)}). */
    enum Mode {
        /** The key only; an {@code enforced} file already there stays. */
        KEEP,
        /** The {@code enforced} file, then the key: from step 1 of the switch on. */
        ENFORCED,
        /** The key, and the {@code enforced} file removed: a build with {@link #ENFORCE} false (a rollback). */
        OPEN
    }

    /**
     * Where the key lives. {@code save} writes all its entries at once (a null value removes that entry) and says whether
     * they reached storage; like Android's {@code SharedPreferences.Editor.commit()}, a save that fails may still have
     * changed the values read back in this process. {@code get} is an entry's stored value as it is (null when absent).
     */
    interface Store {
        String getString(String name);
        long getLong(String name);
        boolean getBoolean(String name);
        Object get(String name);
        boolean save(Map<String, Object> changes);
    }

    /** Runs the command that writes the key file in Termux (a {@code RUN_COMMAND}); throws when it can't be handed over. */
    interface Runner { void run(String command) throws Exception; }

    /**
     * A {@link Runner} over a call that starts something and returns null when nothing was started (as
     * {@code Context.startForegroundService} does when the service can't be found): a null counts as not handed over, so
     * {@link #share} reports false and the caller tries again on its next trigger.
     */
    static Runner starting(java.util.function.Function<String, Object> start) {
        return command -> {
            if (start.apply(command) == null) throw new IllegalStateException("not handed over");
        };
    }

    /** The key could not be saved: nothing may be sent with a key that the next start would not have. No key in it. */
    static final class NotSaved extends IllegalStateException {
        NotSaved() { super("key not saved"); }
    }

    /**
     * What the app knows when {@link #tick} looks at the switch, from its own state only (never from what a port says).
     * {@code pluginHello} is {@link LocalDashboard#plugin}'s answer, the same one the app's clients use.
     */
    static final class Facts {
        /** Termux has accepted a command of ours and Hermux is not being uninstalled. */
        final boolean setUp;
        /** {@code PluginSync}'s last answer was {@code current}. */
        final boolean pluginCurrent;
        /** The installed plugin's stamp says it speaks the hello. */
        final boolean pluginHello;
        /** A plugin update or the installer is running. */
        final boolean busy;

        Facts(boolean setUp, String pluginState, String installedStamp, String apkStamp, boolean busy) {
            this.setUp = setUp;
            this.pluginCurrent = "current".equals(pluginState);
            this.pluginHello = LocalDashboard.plugin(installedStamp, apkStamp) == LocalDashboard.Plugin.HELLO;
            this.busy = busy;
        }
    }

    /** What one {@link #tick} or {@link #legacySeen} did, for the caller's diagnostics and its next try. */
    static final class Result {
        /** The reason of the rotation made (one of {@link #WHYS}), or null for none. */
        String rotated;
        /** A share was handed to Termux in this call. */
        boolean shared;
        /** The listener began refusing the raw key in this call ("cap": forced by {@link #CAP_MS}), else null. */
        String enforced;
        /** When to look again (ms), because a rotation is due but limited for now; -1 for no need. */
        long retryMs = -1;
        /** {@code legacy_seen} rotations stopped in this call ({@link #LEGACY_MAX_RUN} in a row with the cap's row on). */
        boolean paused;
        /** A build without {@link #ENFORCE} forgot the switch's saved steps in this call ({@link #forgetSwitch}). */
        boolean forgot;
    }

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final Store store;
    private final LongSupplier clock, elapsed;
    private final long appVersion;
    /** The last share handed over in this process (epoch ms), for {@link #shareDue}. */
    private long sharedAt = 0;
    /** The listener saw a key id Termux holds that isn't ours, or the previous one: a share is wanted ({@link #reshareWanted}). */
    private boolean shareWanted = false;
    /** The last raw key reported after the switch (epoch ms), exact; -1 until one in this process ({@link #legacySeen}). */
    private long legacySeenAt = -1, legacySavedAt = -1;
    /** {@code local_legacy_seen_at} reaches storage at most this often. */
    static final long LEGACY_SAVE_MS = 60_000L;

    private final java.util.function.IntSupplier boot;

    /** The same clock for both (tests, where time only moves forward); no boot count. */
    LocalKey(Store store, LongSupplier clock, long appVersion) {
        this(store, clock, clock, () -> -1, appVersion);
    }

    /** No boot count (a reboot is then seen by the time since boot going down). */
    LocalKey(Store store, LongSupplier clock, LongSupplier elapsed, long appVersion) {
        this(store, clock, elapsed, () -> -1, appVersion);
    }

    /**
     * @param clock wall-clock epoch ms (rotations and their grace); @param elapsed real time since boot in ms, which a
     * clock set wrong can't move (the window's length, {@link #window}); @param boot the phone's boot count, or -1 when
     * unknown; @param appVersion this app's version code.
     */
    LocalKey(Store store, LongSupplier clock, LongSupplier elapsed, java.util.function.IntSupplier boot, long appVersion) {
        if (store == null || clock == null || elapsed == null || boot == null) throw new IllegalArgumentException("store");
        this.store = store;
        this.clock = clock;
        this.elapsed = elapsed;
        this.boot = boot;
        this.appVersion = appVersion;
    }

    /**
     * The current key; made once (24 random bytes as lowercase hex) when there is none or the stored one isn't a key.
     * A new key is returned only once it is saved (one retry); otherwise {@link NotSaved}, and the caller sends nothing.
     */
    synchronized String current() {
        String k = store.getString(P_KEY);
        if (isKey(k)) return k;
        k = fresh(null);
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_KEY, k);
        c.put(P_VERSION, appVersion);
        c.put(P_SEEN, null); // nothing in Termux has shown it holds this key yet
        c.put(P_VERIFIED, null);
        saveOrFail(c);
        return k;
    }

    /** The key id a client names in its hello: the current key's. */
    @Override
    public String hint() {
        return LocalAuth.kid(current());
    }

    /** The keys a request may use: the current one, then the previous one while its grace lasts. */
    synchronized List<String> accepted() {
        List<String> out = new ArrayList<>(2);
        out.add(current());
        String prev = prevInGrace();
        if (prev != null) out.add(prev);
        return Collections.unmodifiableList(out);
    }

    /** The accepted key with this key id, else null (an unknown or malformed id). Compares every key's id. */
    @Override
    public synchronized String byKid(String kid) {
        if (!LocalAuth.isKid(kid)) return null;
        String found = null;
        for (String k : accepted()) if (LocalAuth.same(LocalAuth.kid(k), kid) && found == null) found = k;
        return found;
    }

    /** True when {@code value} is an accepted key; compares against every accepted key in constant time. */
    synchronized boolean isAccepted(String value) {
        boolean ok = false;
        for (String k : accepted()) ok |= LocalAuth.same(value, k);
        return ok;
    }

    /**
     * How long until a rotation for {@code why} may run: 0 now, a positive delay when it is due but limited for now
     * ({@link #MIN_ROTATE_MS} since the last one, or the previous key still in its grace while Termux has not shown it
     * holds the current one: then until that grace ends, unless a {@link #confirm} comes first), -1 when it is not due
     * at all ({@code update} with a key made under this version, {@code enforce} once begun, {@code legacy_seen}
     * before the switch or within a day of the last one). {@code why} outside {@link #WHYS}: IllegalArgumentException.
     * A clock set back counts as time passed, so it can never block a rotation for long.
     */
    synchronized long rotateWait(String why) {
        if (!WHYS.contains(why)) throw new IllegalArgumentException("why");
        long now = clock.getAsLong();
        if ("update".equals(why) && version() == appVersion) return -1;
        if ("enforce".equals(why) && (!ENFORCE || begun())) return -1;
        if ("legacy_seen".equals(why)) {
            if (rawAccepted()) return -1; // only after the switch is a raw key a sign of an old client
            long at = store.getLong(P_LEGACY_AT);
            if (at > 0 && now >= at && now - at < LEGACY_EVERY_MS) return -1; // the next sighting asks again
        }
        long wait = 0;
        long at = store.getLong(P_ROTATED_AT);
        if (at > 0 && now >= at && now - at < MIN_ROTATE_MS) wait = MIN_ROTATE_MS - (now - at);
        if (prevInGrace() != null && !store.getBoolean(P_SEEN)) wait = Math.max(wait, Math.max(1, store.getLong(P_PREV_UNTIL) - now));
        return wait;
    }

    /**
     * Replaces the key when {@link #rotateWait} allows it now: the current one becomes the previous one for
     * {@link #GRACE_MS}, a new random key (never the old one) becomes current under this app version. True when it was
     * replaced; false when the limits said not now. The caller shares the new key with Termux and records
     * {@code local key_rotated why=<why>}. A save that fails: {@link NotSaved}, and the old key stays current.
     */
    synchronized boolean rotate(String why) {
        if (rotateWait(why) != 0) return false;
        replace(why, false);
        return true;
    }

    private void replace(String why, boolean cap) {
        String old = current();
        String key = fresh(old);
        long now = clock.getAsLong();
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_KEY, key);
        c.put(P_PREV, old);
        c.put(P_PREV_UNTIL, now + GRACE_MS);
        c.put(P_VERSION, appVersion);
        c.put(P_ROTATED_AT, now);
        c.put(P_SEEN, null);
        c.put(P_VERIFIED, null);
        if ("enforce".equals(why)) { // step 1 of the switch, in the same commit as the new key
            c.put(P_ENFORCE_KID, LocalAuth.kid(key));
            c.put(P_CAP, cap ? Boolean.TRUE : null);
        }
        if ("legacy_seen".equals(why)) {
            c.put(P_LEGACY_AT, now);
            c.put(P_LEGACY_RUN, store.getLong(P_LEGACY_RUN) + 1);
        }
        if ("update".equals(why)) { // a new app version may have fixed what kept sending the raw key: count again
            c.put(P_LEGACY_RUN, null);
            c.put(P_LEGACY_PAUSED, null);
        }
        saveOrFail(c); // NotSaved: the old key stays current, and nothing is shared
    }

    /**
     * A request was verified under {@code kid}. When that is the current key's id: Termux holds the current key
     * ({@code event_key_seen}, and {@code local_verified} until the next plugin run's scripts line); once the switch has
     * begun, step 3 ({@code local_enforced}: every key since step 1 reached Termux with the {@code enforced} file); and
     * a previous key still in its grace now ends {@link #CONFIRM_MS} from now (never later than it would have). True
     * when the grace was cut.
     */
    synchronized boolean confirm(String kid) {
        if (!LocalAuth.isKid(kid) || !LocalAuth.same(kid, LocalAuth.kid(current()))) return false;
        Map<String, Object> c = new LinkedHashMap<>();
        if (!store.getBoolean(P_SEEN)) c.put(P_SEEN, true);
        if (!store.getBoolean(P_VERIFIED)) c.put(P_VERIFIED, true);
        if (ENFORCE && begun() && !store.getBoolean(P_ENFORCED)) c.put(P_ENFORCED, true);
        boolean cut = false;
        if (prevInGrace() != null) {
            long at = clock.getAsLong() + CONFIRM_MS;
            if (store.getLong(P_PREV_UNTIL) > at) {
                c.put(P_PREV_UNTIL, at);
                cut = true;
            }
        }
        if (c.isEmpty()) return false;
        return store.save(c) && cut;
    }

    /** A request was verified under the previous key during its grace: Termux still holds that one (share again). */
    synchronized boolean stale(String kid) {
        String prev = prevInGrace();
        boolean old = prev != null && LocalAuth.isKid(kid) && LocalAuth.same(kid, LocalAuth.kid(prev));
        if (old) shareWanted = true;
        return old;
    }

    /** A hello named a key id that is no accepted key: whatever sent it holds a key Termux shouldn't have kept. */
    synchronized void foreignHint() {
        shareWanted = true;
    }

    /**
     * A share of the key is wanted and allowed now: the listener saw Termux use the previous key or a key id that isn't
     * ours since the last share ({@link #stale}, {@link #foreignHint}), and {@link #shareDue}. A bare nudge (the keeper's
     * wake, {@code StartReceiver}) shares only then.
     */
    synchronized boolean reshareWanted() {
        return shareWanted && shareDue();
    }

    /** The app version the current key was made under; 0 for a key from before this was kept. */
    synchronized long version() {
        current();
        return store.getLong(P_VERSION);
    }

    /** Whether the app's listener still accepts the raw key: until step 3 of the switch (always while ENFORCE is false). */
    synchronized boolean rawAccepted() {
        return !(ENFORCE && store.getBoolean(P_ENFORCED));
    }

    /** Step 1 of the switch has run (or a store says it is enforced). */
    private boolean begun() {
        return store.getString(P_ENFORCE_KID) != null || store.getBoolean(P_ENFORCED);
    }

    /** The Setup check's "Phone scripts out of date" row ({@link #scriptsRow}). */
    synchronized boolean scriptsOld() {
        return ENFORCE && scriptsRow(store.getBoolean(P_CAP), store.getBoolean(P_SCRIPTS_OK));
    }

    /**
     * The row shows only when the switch was forced by the cap and the last plugin run's scripts line did not say
     * {@code ok}: a plugin changed by hand whose scripts were copied before is not "out of date".
     */
    static boolean scriptsRow(boolean cap, boolean scriptsOk) {
        return cap && !scriptsOk;
    }

    /**
     * What the row's button can do for the plugin's state: {@code force} (replace it, {@code --force}: a plugin changed
     * by hand, which a normal update never touches; its dialog says the hand changes go), {@code none} (a plugin held
     * for testing or newer than the app's: nothing the app does replaces it, so the row has no button and says why), else
     * {@code update}.
     */
    static String scriptsFix(String pluginState) {
        if ("modified".equals(pluginState)) return "force";
        if ("held".equals(pluginState) || "newer".equals(pluginState)) return "none";
        return "update";
    }

    /**
     * A plugin run printed its scripts line ({@link #scriptsLine}): {@code ok} records that Termux's scripts are the
     * APK's, and either way a verified request is needed again after it before the switch counts it. An {@code ok} also
     * clears the cap's Setup row. False when it couldn't be saved.
     */
    synchronized boolean scriptsCopied(boolean ok) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_SCRIPTS_OK, ok);
        c.put(P_TICKER, null); // the update may have replaced the ticker: it must be heard again
        c.put(P_VERIFIED, null);
        if (ok) c.put(P_CAP, null);
        return store.save(c);
    }

    /** From a plugin run's output: true for a last {@code HMPLUGIN SCRIPTS ok}, false for {@code HMPLUGIN SCRIPTS fail …}, null for no such line. */
    static Boolean scriptsLine(String out) {
        if (out == null) return null;
        Boolean got = null;
        for (String l : out.split("\n")) {
            String t = l.trim();
            if (t.equals("HMPLUGIN SCRIPTS ok")) got = Boolean.TRUE;
            else if (t.equals("HMPLUGIN SCRIPTS fail") || t.startsWith("HMPLUGIN SCRIPTS fail ")) got = Boolean.FALSE;
        }
        return got;
    }

    /**
     * How long the window has lasted, as {@code {version, ms, seen, boot}} to keep: {@code ms} the time counted so far
     * (never above {@link #CAP_MS}), {@code seen} the time since boot at this look, {@code boot} the boot count then. The
     * first look once the phone is set up starts it at 0 under this app version; a later version keeps counting (an
     * update doesn't lengthen it); an older version than the one stored (a downgrade that kept the app's data), or a
     * stored length outside 0 to the cap (a damaged value), starts it again at 0.
     *
     * <p>Each look adds, with {@code u} the time since boot now and {@code seen} at the last look: {@code u - seen} when
     * {@code u >= seen} (whatever the boot counts say); otherwise {@code u}, the time since this boot (a reboot), except
     * with an unchanged boot count, where a time since boot that went down is a damaged value and adds 0. A stored
     * {@code seen} below 0, or missing, is damaged too: that look adds 0 and counts from now. The wall clock plays no
     * part.
     *
     * <p><b>Never early.</b> In one boot both values come from one clock that counts real time, sleep included, and
     * can't be set, so {@code u - seen} is exactly the real time between the two looks. When a reboot came in between,
     * {@code u} is no more than the real time since that boot, which came after the last look, so both {@code u} and,
     * when {@code u >= seen}, the smaller {@code u - seen} are at most the real time since the last look; a boot count
     * that is wrong or changes within one boot can only pick the smaller of the two. A damaged value adds 0. So every look
     * adds at most the real time since the one before, and the total is never more than the real time since the window
     * began: the cap can't come before 14 real days. <b>Not decades.</b> What a look misses is only the time from the
     * last look before a shutdown to the shutdown (and, after a reboot whose time since boot passed the last look's,
     * up to that stretch once more), and the time switched off. While the window is open the app looks at least every
     * {@link #LOOK_EVERY_MS} of real time (a non-waking alarm delivered at the next wake, plus every service start,
     * request on its port and plugin check), so a phone awake enough for those looks and restarted every night reaches
     * the cap after about 15 days (up to about 16 to 18 when the nightly restart lands while Doze holds the alarm back),
     * one that is off half the time after about 28, and every phone that keeps running gets there.
     */
    static long[] window(long storedVersion, long storedMs, long storedSeen, long storedBoot, long version, long up, long boot) {
        long b = boot >= 0 ? boot : -1, u = Math.max(0, up);
        if (storedVersion <= 0 || storedVersion > version || storedMs < 0 || storedMs > CAP_MS || up < 0)
            return new long[] {version, 0, u, b};
        if (storedSeen < 0) return new long[] {version, storedMs, u, b}; // damaged or missing: count from this look
        long add;
        if (u >= storedSeen) add = u - storedSeen; // the same boot, or a reboot: never more than the real time
        else add = b >= 0 && storedBoot >= 0 && b == storedBoot ? 0 : u; // a reboot, or (same count) a damaged value
        return new long[] {version, Math.min(CAP_MS, storedMs + add), u, b};
    }

    /**
     * While the window is open and counting (the switch's step 3 not done, the window started, and {@code setUp}: the
     * phone is set up, else no look counts): look again within {@link #LOOK_EVERY_MS}; else -1, so no alarm is kept for
     * a window that is closed or not counting.
     */
    synchronized long lookAgainMs(boolean setUp) {
        return ENFORCE && setUp && !store.getBoolean(P_ENFORCED) && store.getLong(P_WINDOW_VERSION) > 0 ? LOOK_EVERY_MS : -1;
    }

    /** The window has lasted {@link #CAP_MS} of real time ({@link #window}). */
    static boolean capReached(long ms) {
        return ms >= CAP_MS;
    }

    /**
     * A build with {@link #ENFORCE} false (a rollback) forgets the switch's saved steps, the cap's row and the window, so
     * that a later build with it on runs the conditions again instead of enforcing at once. True when something was
     * forgotten. {@code enforce} is {@link #ENFORCE} (a parameter so a test can play a build without it).
     */
    synchronized boolean forgetSwitch(boolean enforce) {
        if (enforce) return false;
        String[] names = {P_ENFORCE_KID, P_ENFORCED, P_CAP, P_WINDOW_VERSION, P_WINDOW_MS, P_WINDOW_SEEN, P_WINDOW_BOOT, P_LEGACY_RUN, P_LEGACY_PAUSED};
        Map<String, Object> c = new LinkedHashMap<>();
        for (String n : names) if (store.get(n) != null) c.put(n, null);
        return !c.isEmpty() && store.save(c);
    }

    /**
     * Whether the switch may close the window now: the phone is set up; the plugin is current and speaks the hello; the
     * last plugin run copied Termux's scripts; a request verified under the current key came from Termux since then; the
     * cron ticker runs the new code ({@code tickerOk}: a signed ticker event or a verified poke since then, and no raw
     * ticker event after it, {@link #tickerSeen}); and nothing is being updated or installed.
     */
    static boolean ready(Facts f, boolean scriptsOk, boolean verified, boolean tickerOk) {
        return f.setUp && f.pluginCurrent && f.pluginHello && scriptsOk && verified && tickerOk && !f.busy;
    }

    /**
     * The cron ticker was heard: {@code signed} for a ticker event signed after a hello ({@code wake_at},
     * {@code cron_idle}) or a verified poke, which only the new ticker can make; false for such an event with the raw key
     * (an older ticker still runs, which would keep sending the key: the switch waits). Saved only when it changes.
     */
    synchronized void tickerSeen(boolean signed) {
        if (store.getBoolean(P_TICKER) == signed) return;
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_TICKER, signed ? Boolean.TRUE : null);
        store.save(c);
    }

    /**
     * One look at the rotations and the switch (service start, a plugin run's answer, verified requests now and then).
     * In order: a rotation after an app update ({@code event_key_version} isn't this version); the window's start; when
     * {@link #ready} holds, or the cap is reached, step 1 ({@code enforce}, at most one rotation per call); step 2, the
     * share, after any rotation and, while Termux has not shown it holds the current key, again every
     * {@link #RESHARE_MS}; step 3 once the cap is reached (else {@link #confirm} does it). A save that fails leaves
     * everything as it was and asks to be tried again in a minute.
     */
    synchronized Result tick(Facts f, Runner runner) {
        Result r = new Result();
        try {
            r.forgot = forgetSwitch(ENFORCE);
            long w = rotateWait("update");
            if (w == 0) {
                replace("update", false);
                r.rotated = "update";
            } else if (w > 0) r.retryMs = w;
            if (ENFORCE && !store.getBoolean(P_ENFORCED) && f.setUp) {
                Object sb = store.get(P_WINDOW_BOOT), ss = store.get(P_WINDOW_SEEN);
                long[] win = window(store.getLong(P_WINDOW_VERSION), store.getLong(P_WINDOW_MS), ss instanceof Long ? (Long) ss : -1,
                        sb instanceof Long ? (Long) sb : -1, appVersion, elapsed.getAsLong(), boot.getAsInt());
                Map<String, Object> c = new LinkedHashMap<>();
                c.put(P_WINDOW_VERSION, win[0]);
                c.put(P_WINDOW_MS, win[1]);
                c.put(P_WINDOW_SEEN, win[2]);
                c.put(P_WINDOW_BOOT, win[3]);
                store.save(c); // a look not saved is counted again from the last saved one: only less time, never more
            }
            boolean cap = ENFORCE && f.setUp && store.getLong(P_WINDOW_VERSION) > 0 && capReached(store.getLong(P_WINDOW_MS));
            if (ENFORCE && r.rotated == null && !begun()) {
                boolean ok = ready(f, store.getBoolean(P_SCRIPTS_OK), store.getBoolean(P_VERIFIED), store.getBoolean(P_TICKER));
                if (ok || cap) {
                    long e = rotateWait("enforce");
                    if (e == 0) {
                        replace("enforce", !ok);
                        r.rotated = "enforce";
                    } else if (e > 0) r.retryMs = r.retryMs < 0 ? e : Math.min(r.retryMs, e);
                }
            }
            boolean pending = ENFORCE && begun() && !store.getBoolean(P_ENFORCED);
            if (r.rotated != null || (pending && !store.getBoolean(P_SEEN) && shareDue())) r.shared = share(runner);
            if (pending && cap) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put(P_ENFORCED, true);
                if (store.save(c)) r.enforced = "cap";
            }
        } catch (NotSaved e) {
            r.retryMs = 60_000L;
        }
        return r;
    }

    /**
     * A raw key reached a server after the switch: some old client still sends it, so the key is replaced once more
     * ({@code legacy_seen}, at most once a day, within the rotation limits) and the new one shared.
     */
    synchronized Result legacySeen(Runner runner) {
        Result r = new Result();
        if (rawAccepted()) return r; // before the switch a raw key is no sign of anything
        long now = clock.getAsLong(), last = legacySeenAt >= 0 ? legacySeenAt : store.getLong(P_LEGACY_SEEN_AT);
        legacySeenAt = now; // exact in memory; on disk at most once a minute (a sender may knock often)
        Map<String, Object> seen = new LinkedHashMap<>();
        seen.put(P_LEGACY_SEEN_AT, now);
        // A whole day without a raw key since the last one (two days between them): whatever sent it has stopped.
        boolean quiet = last > 0 && now >= last && now - last >= 2 * LEGACY_EVERY_MS;
        if (quiet) {
            seen.put(P_LEGACY_RUN, null);
            seen.put(P_LEGACY_PAUSED, null);
        }
        if (quiet || legacySavedAt < 0 || now < legacySavedAt || now - legacySavedAt >= LEGACY_SAVE_MS) {
            store.save(seen);
            legacySavedAt = now;
        }
        // A lasting sender with the cap's row on (a held old plugin re-reads the key file anyway): after a few
        // rotations in a row more of them can't help, so they stop until that changes; noted once.
        if (store.getBoolean(P_CAP) && store.getLong(P_LEGACY_RUN) >= LEGACY_MAX_RUN) {
            if (!store.getBoolean(P_LEGACY_PAUSED)) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put(P_LEGACY_PAUSED, true);
                r.paused = store.save(c);
            }
            return r;
        }
        try {
            if (rotateWait("legacy_seen") == 0) {
                replace("legacy_seen", false);
                r.rotated = "legacy_seen";
                r.shared = share(runner);
            }
        } catch (NotSaved e) {
            // the next sighting tries again
        }
        return r;
    }

    /** No share handed over in this process yet, or the last one is {@link #RESHARE_MS} old (or the clock went back). */
    synchronized boolean shareDue() {
        long now = clock.getAsLong();
        return sharedAt <= 0 || now - sharedAt >= RESHARE_MS || now < sharedAt;
    }

    /** What the next share writes besides the key: {@link Mode#ENFORCED} from step 1 on, {@link Mode#OPEN} without {@link #ENFORCE}. */
    synchronized Mode shareMode() {
        if (!ENFORCE) return Mode.OPEN;
        return begun() ? Mode.ENFORCED : Mode.KEEP;
    }

    /** The listener's view of these keys ({@link LocalServer#accept}): it proves with the key a hello names, else the current one. */
    LocalServer.Keys serverKeys() {
        return new LocalServer.Keys() {
            @Override public String proving() { return current(); }
            @Override public boolean rawOk(String value) { return isAccepted(value); }
            @Override public String byKid(String kid) { return LocalKey.this.byKid(kid); }
            @Override public void foreignHint() { LocalKey.this.foreignHint(); }
        };
    }

    /** {@link #shareCommand(String, Mode)} with {@link Mode#KEEP}. */
    static String shareCommand(String key) {
        return shareCommand(key, Mode.KEEP);
    }

    /**
     * The command that writes {@code key} to Termux's {@code ~/.hermes-mobile/key} (run as {@code sh -c}): a private
     * umask, the folder made, the key written to a temporary file named after the shell's process id, then moved over the
     * old file, so a reader sees the old key or the new one, never an empty or half-written file, and two writes at
     * once can't mix; when a step fails, the temporary files are removed and the command fails. {@link Mode#ENFORCED}
     * first moves an empty {@code enforced.<pid>.tmp} over {@code ~/.hermes-mobile/enforced} (a link there is replaced,
     * never written through), then the key: a Termux that has the new key has the file. {@link Mode#OPEN} removes the
     * {@code enforced} file after the key. The key must be lowercase hex ({@link #isKey}), so nothing in it means anything
     * to the shell.
     */
    static String shareCommand(String key, Mode mode) {
        if (!isKey(key) || mode == null) throw new IllegalArgumentException("key");
        String d = "~/.hermes-mobile/";
        String write = "printf %s " + key + " > " + d + "key.$$.tmp";
        String move = "mv -f " + d + "key.$$.tmp " + d + "key";
        String body, clean = "rm -f " + d + "key.$$.tmp";
        switch (mode) {
            case ENFORCED:
                body = write + " && : > " + d + "enforced.$$.tmp && mv -f " + d + "enforced.$$.tmp " + d + "enforced && " + move;
                clean += " " + d + "enforced.$$.tmp";
                break;
            case OPEN:
                body = write + " && " + move + " && rm -f " + d + "enforced";
                break;
            default:
                body = write + " && " + move;
        }
        return "umask 077 && mkdir -p ~/.hermes-mobile && { " + body + " || { " + clean + "; exit 1; }; }";
    }

    /** A key as this class makes it: 32 to 128 lowercase hex characters. */
    static boolean isKey(String k) {
        if (k == null || k.length() < 32 || k.length() > 128) return false;
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    @Override
    public String toString() {
        return "LocalKey";
    }

    /** The previous key while its grace lasts (at most GRACE_MS ahead, so a clock set back can't stretch it); an expired one is removed. */
    private String prevInGrace() {
        String prev = store.getString(P_PREV);
        if (prev == null) return null;
        long now = clock.getAsLong(), until = store.getLong(P_PREV_UNTIL);
        if (isKey(prev) && until > now && until - now <= GRACE_MS) return prev;
        if (until <= now || !isKey(prev)) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put(P_PREV, null);
            c.put(P_PREV_UNTIL, null);
            store.save(c);
        }
        return null;
    }

    /**
     * Saves {@code c} (one retry), or throws {@link NotSaved} after putting the old values back: a failed save may have
     * left the new ones in the values this process reads (Android's commit does), and a key that is not on disk must
     * never be returned or shared, since the next start would not have it.
     */
    private void saveOrFail(Map<String, Object> c) {
        Map<String, Object> undo = new LinkedHashMap<>();
        for (String n : c.keySet()) undo.put(n, store.get(n));
        if (store.save(c) || store.save(c)) return;
        store.save(undo); // whatever reaches the disk, the values read back are the saved ones again
        throw new NotSaved();
    }

    /**
     * Shares the current key with Termux, with what {@link #shareMode} says besides it: true only when the key was
     * obtained (saved) and its command handed to {@code runner}; false (nothing handed over) when the key isn't saved
     * or the runner throws, so the caller tries again on its next trigger.
     */
    boolean share(Runner runner) {
        String cmd;
        try {
            synchronized (this) {
                cmd = shareCommand(current(), shareMode());
            }
        } catch (RuntimeException e) {
            return false;
        }
        try {
            runner.run(cmd);
        } catch (Exception e) {
            return false;
        }
        synchronized (this) {
            sharedAt = clock.getAsLong();
            shareWanted = false;
        }
        return true;
    }

    private static String fresh(String not) {
        while (true) {
            byte[] b = new byte[24];
            RANDOM.nextBytes(b);
            char[] out = new char[48];
            for (int i = 0; i < 24; i++) {
                out[2 * i] = HEX[(b[i] >> 4) & 0xf];
                out[2 * i + 1] = HEX[b[i] & 0xf];
            }
            String k = new String(out);
            if (!k.equals(not)) return k;
        }
    }
}
