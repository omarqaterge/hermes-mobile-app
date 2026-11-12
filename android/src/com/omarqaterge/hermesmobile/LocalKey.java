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
 * epoch ms), {@code event_key_version} (the app version the current key was made under) and {@code local_enforced}.
 *
 * <p>{@link #rotate} keeps the previous key accepted for {@link #GRACE_MS} (24 h), so Termux processes that still hold
 * it keep working until the new key file reaches them; {@link #confirm} (the first request verified under the new key)
 * cuts that to {@link #CONFIRM_MS} (2 min) for requests already in flight. Nothing calls {@code rotate} yet, and while
 * {@link #ENFORCE} is false the raw key is accepted whatever {@code local_enforced} says. Plain Java (no Android
 * classes) so {@code tools/test_local_key.sh} tests it with a JDK. No method returns or throws a key in its message, and
 * {@link #toString} names none. Thread-safe.
 */
final class LocalKey implements LocalClient.KeySet {
    /** False until local authentication is switched on for every caller: the raw key stays accepted. */
    static final boolean ENFORCE = false;
    static final long GRACE_MS = 24 * 3_600_000L;
    static final long CONFIRM_MS = 120_000L;
    /** Why a key is replaced; the diagnostic event {@code local key_rotated} names one of these. */
    static final List<String> WHYS = Collections.unmodifiableList(Arrays.asList("update", "enforce", "legacy_seen", "user"));

    static final String P_KEY = "event_key", P_PREV = "event_key_prev", P_PREV_UNTIL = "event_key_prev_until",
            P_VERSION = "event_key_version", P_ENFORCED = "local_enforced";

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

    /** The key could not be saved: nothing may be sent with a key that the next start would not have. No key in it. */
    static final class NotSaved extends IllegalStateException {
        NotSaved() { super("key not saved"); }
    }

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final Store store;
    private final LongSupplier clock;
    private final long appVersion;

    /** @param clock wall-clock epoch ms; @param appVersion this app's version code (stored with a new key). */
    LocalKey(Store store, LongSupplier clock, long appVersion) {
        if (store == null || clock == null) throw new IllegalArgumentException("store");
        this.store = store;
        this.clock = clock;
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
     * Replaces the key: the current one becomes the previous one for {@link #GRACE_MS}, a new random key (never the old
     * one) becomes current under this app version. {@code why} is one of {@link #WHYS}, else IllegalArgumentException.
     * The caller shares the new key with Termux and records {@code local key_rotated why=<why>}.
     */
    synchronized void rotate(String why) {
        if (!WHYS.contains(why)) throw new IllegalArgumentException("why");
        String old = current();
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_KEY, fresh(old));
        c.put(P_PREV, old);
        c.put(P_PREV_UNTIL, clock.getAsLong() + GRACE_MS);
        c.put(P_VERSION, appVersion);
        saveOrFail(c); // NotSaved: the old key stays current, and nothing is shared
    }

    /**
     * A request was verified under {@code kid}: when that is the current key's id and a previous key is still in its
     * grace, the grace ends {@link #CONFIRM_MS} from now (never later than it would have). True when it was cut.
     */
    synchronized boolean confirm(String kid) {
        if (!LocalAuth.isKid(kid) || !LocalAuth.same(kid, LocalAuth.kid(current()))) return false;
        if (prevInGrace() == null) return false;
        long cut = clock.getAsLong() + CONFIRM_MS;
        if (store.getLong(P_PREV_UNTIL) <= cut) return false;
        Map<String, Object> c = new LinkedHashMap<>();
        c.put(P_PREV_UNTIL, cut);
        return store.save(c);
    }

    /** The app version the current key was made under; 0 for a key from before this was kept. */
    synchronized long version() {
        current();
        return store.getLong(P_VERSION);
    }

    /** Whether the raw key is still accepted: always while {@link #ENFORCE} is false. */
    synchronized boolean rawAccepted() {
        return !(ENFORCE && store.getBoolean(P_ENFORCED));
    }

    /** The listener's view of these keys ({@link LocalServer#accept}): it proves with the key a hello names, else the current one. */
    LocalServer.Keys serverKeys() {
        return new LocalServer.Keys() {
            @Override public String proving() { return current(); }
            @Override public boolean rawOk(String value) { return isAccepted(value); }
            @Override public String byKid(String kid) { return LocalKey.this.byKid(kid); }
        };
    }

    /**
     * The command that writes {@code key} to Termux's {@code ~/.hermes-mobile/key} (run as {@code sh -c}): a private
     * umask, the folder made, the key written to a temporary file named after the shell's process id, then moved over the
     * old file, so a reader sees the old key or the new one, never an empty or half-written file, and two writes at
     * once can't mix; when the write or the move fails, the temporary file is removed and the command fails. The key must
     * be lowercase hex ({@link #isKey}), so nothing in it means anything to the shell.
     */
    static String shareCommand(String key) {
        if (!isKey(key)) throw new IllegalArgumentException("key");
        return "umask 077 && mkdir -p ~/.hermes-mobile && { printf %s " + key + " > ~/.hermes-mobile/key.$$.tmp"
                + " && mv -f ~/.hermes-mobile/key.$$.tmp ~/.hermes-mobile/key || { rm -f ~/.hermes-mobile/key.$$.tmp; exit 1; }; }";
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
     * Shares the current key with Termux: true only when the key was obtained (saved) and its command handed to
     * {@code runner}; false (nothing handed over) when the key isn't saved or the runner throws, so the caller tries again
     * on its next trigger.
     */
    boolean share(Runner runner) {
        String cmd;
        try {
            cmd = shareCommand(current());
        } catch (RuntimeException e) {
            return false;
        }
        try {
            runner.run(cmd);
            return true;
        } catch (Exception e) {
            return false;
        }
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
