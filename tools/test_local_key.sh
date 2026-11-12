#!/bin/bash
# Tests the owner of the shared key (android/.../LocalKey.java) with a plain JDK and an in-memory store: the key is made
# once and kept, a stored value that isn't a key is replaced, rotation keeps the previous key accepted for 24 h and
# never reuses it, confirm cuts that grace to 2 minutes (only for the current key's id, never longer), byKid picks the
# right key and nothing else, the version, the raw key stays accepted while ENFORCE is false, no key in toString or an
# exception's message, and the command that writes the key file for Termux (only hex keys; run with a real sh in a
# temporary HOME: the file holds exactly the key, mode 600, and no temporary file is left). Needs javac 11+. Also run
# by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/LocalKey.java android/src/com/omarqaterge/hermesmobile/LocalAuth.java \
  android/src/com/omarqaterge/hermesmobile/LocalClient.java android/src/com/omarqaterge/hermesmobile/LocalServer.java \
  android/src/com/omarqaterge/hermesmobile/LocalDashboard.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/LocalKeyTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class LocalKeyTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }

    static long now = 1_700_000_000_000L;
    /** Like Android's SharedPreferences: a commit changes the values read back (m) first, then writes the disk; a failed
     *  write returns false and leaves the new values in m. A new start would read only the disk. */
    static final class Mem implements LocalKey.Store {
        final Map<String, Object> m = new HashMap<>(), disk = new HashMap<>();
        int saves = 0, failNext = 0;
        @Override public String getString(String n) { Object v = m.get(n); return v instanceof String ? (String) v : null; }
        @Override public long getLong(String n) { Object v = m.get(n); return v instanceof Long ? (Long) v : 0; }
        @Override public boolean getBoolean(String n) { return Boolean.TRUE.equals(m.get(n)); }
        @Override public Object get(String n) { return m.get(n); }
        @Override public boolean save(Map<String, Object> c) {
            saves++;
            apply(m, c);
            if (failNext > 0) { failNext--; return false; } // the write failed: the disk keeps what it had, m does not
            apply(disk, c);
            return true;
        }
        static void apply(Map<String, Object> to, Map<String, Object> c) {
            for (Map.Entry<String, Object> e : c.entrySet()) { if (e.getValue() == null) to.remove(e.getKey()); else to.put(e.getKey(), e.getValue()); }
        }
    }
    static LocalKey make(Mem m, long version) { return new LocalKey(m, () -> now, version); }

    public static void main(String[] a) throws Exception {
        // current: made once, kept, the stored one used
        Mem m = new Mem();
        LocalKey k = make(m, 7);
        String k1 = k.current();
        check(k1.matches("[0-9a-f]{48}"), "a new key is 24 random bytes as lowercase hex");
        check(k1.equals(k.current()) && k1.equals(m.getString("event_key")) && m.saves == 1, "made once, stored as event_key, then kept");
        check(k.version() == 7, "a new key is stored with this app's version (event_key_version)");
        check(k1.equals(make(m, 8).current()), "another LocalKey over the same store reads the same key");
        Mem old = new Mem();
        old.m.put("event_key", "0123456789abcdef0123456789abcdef0123456789abcdef");
        LocalKey ko = make(old, 9);
        check(ko.current().equals("0123456789abcdef0123456789abcdef0123456789abcdef") && old.saves == 0, "a key from an older app is used as it is");
        check(ko.version() == 0, "... and its version is 0 (made before versions were kept)");
        for (String bad : new String[] {"", "short", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef 0123456789abcdef", "x".repeat(48), "0123456789abcdef;0123456789abcdef&&01234567"}) {
            Mem b = new Mem();
            b.m.put("event_key", bad);
            String got = make(b, 1).current();
            check(!got.equals(bad) && LocalKey.isKey(got), "a stored value that isn't a key is replaced (" + bad.length() + " chars)");
        }
        check(make(new Mem(), 1).current() != null && !make(new Mem(), 1).current().equals(make(new Mem(), 1).current()), "two new keys differ");

        // accepted, byKid
        check(k.accepted().equals(List.of(k1)), "no rotation: only the current key is accepted");
        check(k1.equals(k.byKid(LocalAuth.kid(k1))), "byKid finds the current key by its id");
        check(k.byKid("00000000") == null && k.byKid(null) == null && k.byKid("ABCDEF12") == null && k.byKid(k1) == null
                && (LocalAuth.kid(k1).matches("[0-9]+") || k.byKid(LocalAuth.kid(k1).toUpperCase()) == null),
                "byKid: an unknown, missing, upper-case or malformed id finds nothing");
        check(k.isAccepted(k1) && !k.isAccepted(k1 + "0") && !k.isAccepted(null) && !k.isAccepted(k1.substring(1)), "isAccepted: the key itself and nothing else");

        // rotate
        boolean refused = false;
        try { k.rotate("because"); } catch (IllegalArgumentException e) { refused = "why".equals(e.getMessage()); }
        check(refused && k.current().equals(k1), "rotate with a reason outside the list is refused and changes nothing");
        for (String why : LocalKey.WHYS) check(why.matches("[a-z_]+"), "reason " + why + " is a plain token");
        LocalKey k8 = make(m, 8);
        k8.rotate("update");
        String k2 = k8.current();
        check(!k2.equals(k1) && LocalKey.isKey(k2), "rotate: a new key, never the old one");
        check(k8.accepted().equals(List.of(k2, k1)), "during the grace the previous key is accepted after the current one");
        check(k8.version() == 8, "rotate stores this app's version");
        check(m.getLong("event_key_prev_until") == now + LocalKey.GRACE_MS && LocalKey.GRACE_MS == 24 * 3_600_000L, "the grace is 24 h");
        check(k1.equals(k8.byKid(LocalAuth.kid(k1))) && k2.equals(k8.byKid(LocalAuth.kid(k2))), "byKid finds either key during the grace");
        check(k8.isAccepted(k1) && k8.isAccepted(k2), "both keys are accepted raw during the grace");
        check(LocalAuth.kid(k2).equals(k8.hint()), "the hello hint is the current key's id");
        LocalServer.Keys sk0 = k8.serverKeys();
        check(k1.equals(LocalServer.helloKey(sk0, LocalAuth.kid(k1))) && k2.equals(LocalServer.helloKey(sk0, LocalAuth.kid(k2)))
                && k2.equals(LocalServer.helloKey(sk0, null)) && k2.equals(LocalServer.helloKey(sk0, "00000000")),
                "the listener proves with the key a hint names (current or previous in its grace), else the current one");
        LocalServer.Keys sk = k8.serverKeys();
        check(k2.equals(sk.proving()) && sk.rawOk(k1) && sk.rawOk(k2) && !sk.rawOk("nope"), "the listener proves with the current key and accepts both raw");
        now += LocalKey.GRACE_MS - 1;
        check(k8.accepted().size() == 2, "still accepted 1 ms before the grace ends");
        now += 1;
        check(k8.accepted().equals(List.of(k2)) && k8.byKid(LocalAuth.kid(k1)) == null && !k8.isAccepted(k1), "at the end of the grace the previous key is refused");
        check(m.getString("event_key_prev") == null && !m.m.containsKey("event_key_prev_until"), "... and removed from the store");

        // a clock set back can't stretch the grace beyond 24 h from now
        Mem c = new Mem();
        LocalKey kc = make(c, 1);
        String c1 = kc.current();
        kc.rotate("user");
        now -= 3 * 24 * 3_600_000L;
        check(kc.accepted().size() == 1, "a clock set back: the previous key is not accepted for longer than the grace");
        now += 3 * 24 * 3_600_000L;
        check(kc.accepted().size() == 2 && kc.isAccepted(c1), "... and counts again once the clock is right");

        // confirm
        check(!kc.confirm(LocalAuth.kid(c1)), "confirm under the previous key's id does nothing");
        check(!kc.confirm("zz") && !kc.confirm(null), "confirm with a malformed id does nothing");
        check(kc.accepted().size() == 2, "... the grace is unchanged");
        check(kc.confirm(LocalAuth.kid(kc.current())), "confirm under the current key's id cuts the grace");
        check(c.getLong("event_key_prev_until") == now + LocalKey.CONFIRM_MS && LocalKey.CONFIRM_MS == 120_000L, "... to 2 minutes from now");
        int saves = c.saves;
        now += 60_000;
        check(!kc.confirm(LocalAuth.kid(kc.current())) && c.saves == saves, "a later confirm never moves the end of the grace back out");
        now += 60_000;
        check(kc.accepted().size() == 1 && !kc.isAccepted(c1), "2 minutes after the confirm the previous key is refused");
        check(!kc.confirm(LocalAuth.kid(kc.current())), "confirm with no previous key does nothing");

        // the switch is built in: the raw key is refused only once local_enforced is saved
        check(LocalKey.ENFORCE, "ENFORCE is on in this version");
        Mem e = new Mem();
        e.m.put("local_enforced", true);
        check(!make(e, 1).rawAccepted() && make(new Mem(), 1).rawAccepted(), "the raw key is accepted until local_enforced is saved, then refused");

        // no key in toString or an exception
        String all = k8.toString() + kc.toString() + String.valueOf(k8.serverKeys());
        check(!all.contains(k1) && !all.contains(k2) && !all.contains(c1) && !all.contains(kc.current()), "toString names no key");
        String msg = "";
        try { LocalKey.shareCommand(k2 + "Z"); } catch (IllegalArgumentException x) { msg = String.valueOf(x.getMessage()); }
        check("key".equals(msg), "a refused key file command names no key in its message");

        // the key file command
        String cmd = LocalKey.shareCommand(k2);
        check(cmd.equals("umask 077 && mkdir -p ~/.hermes-mobile && { printf %s " + k2 + " > ~/.hermes-mobile/key.$$.tmp && mv -f ~/.hermes-mobile/key.$$.tmp ~/.hermes-mobile/key"
                        + " || { rm -f ~/.hermes-mobile/key.$$.tmp; exit 1; }; }"),
                "the command: private umask, the folder, a temporary file, a move over the key file, the temporary file removed on failure");
        for (String bad : new String[] {null, "", "abc", k2.toUpperCase(), k2 + ";id", k2 + " ", "$(id)" + k2, k2 + "`id`", k2.substring(0, 31), "a".repeat(129)}) {
            boolean no = false;
            try { LocalKey.shareCommand(bad); } catch (IllegalArgumentException x) { no = true; }
            check(no, "no command for a key that isn't 32-128 lowercase hex characters (" + (bad == null ? "null" : bad.length() + " chars") + ")");
        }
        File home = Files.createTempDirectory("lk").toFile();
        File dir = new File(home, ".hermes-mobile");
        int rc = run(home, cmd);
        File key = new File(dir, "key");
        check(rc == 0 && key.isFile() && new String(Files.readAllBytes(key.toPath()), StandardCharsets.US_ASCII).equals(k2), "run by sh: the file holds exactly the key (no newline)");
        Set<PosixFilePermission> perms = Files.getPosixFilePermissions(key.toPath());
        check(perms.equals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)), "... readable and writable by its owner only (" + perms + ")");
        Set<PosixFilePermission> dperms = Files.getPosixFilePermissions(dir.toPath());
        check(!dperms.contains(PosixFilePermission.GROUP_READ) && !dperms.contains(PosixFilePermission.OTHERS_READ), "... in a folder made private (" + dperms + ")");
        long ino = (Long) Files.getAttribute(key.toPath(), "unix:ino");
        rc = run(home, LocalKey.shareCommand(k1));
        String[] left = dir.list();
        check(rc == 0 && new String(Files.readAllBytes(key.toPath()), StandardCharsets.US_ASCII).equals(k1) && left != null && left.length == 1,
                "run again: the new key replaces the old one, no temporary file is left");
        check((Long) Files.getAttribute(key.toPath(), "unix:ino") != ino, "... by a move (a new file), never by truncating the old one");
        for (File f : dir.listFiles()) f.delete();
        if (!"root".equals(System.getProperty("user.name"))) { // permissions don't stop root
            // the move fails (the key's place is a folder nobody may write): the temporary file is removed, the command fails
            File blocked = new File(dir, "key");
            blocked.mkdir();
            blocked.setWritable(false, false);
            rc = run(home, LocalKey.shareCommand(k1));
            left = dir.list();
            check(rc != 0 && left != null && left.length == 1 && left[0].equals("key") && blocked.list().length == 0,
                    "a move that fails: the command fails and no temporary file with the key is left (" + rc + ", " + Arrays.toString(left) + ")");
            blocked.setWritable(true, false);
            blocked.delete();
            // the write fails (the folder isn't writable): the command fails and leaves nothing
            dir.setWritable(false, false);
            rc = run(home, LocalKey.shareCommand(k1));
            left = dir.list();
            dir.setWritable(true, false);
            check(rc != 0 && left != null && left.length == 0, "a write that fails: the command fails and leaves nothing (" + rc + ")");
        }
        for (File f : dir.listFiles()) f.delete();
        dir.delete();
        home.delete();

        // a store whose commit fails: no key that wasn't saved is ever returned
        Mem f = new Mem();
        f.failNext = 1;
        LocalKey kf = make(f, 1);
        String once = kf.current();
        check(once.equals(f.getString("event_key")) && f.saves == 2, "a commit that fails once is retried, and the key returned is the one saved");
        Mem g = new Mem();
        g.failNext = 2;
        LocalKey kg = make(g, 1);
        String why = "";
        try { kg.current(); why = "returned"; } catch (LocalKey.NotSaved x) { why = x.getMessage(); }
        check("key not saved".equals(why) && g.getString("event_key") == null, "a commit that fails twice: NotSaved (no key in its message), nothing returned");
        check(g.m.equals(g.disk), "... and the values read back are the saved ones again (the unsaved key is not left in memory)");
        String later = kg.current();
        check(later.equals(g.getString("event_key")) && later.equals(kg.current()), "... and the next call makes a key and keeps it");
        String before = kg.current();
        g.failNext = 2;
        why = "";
        try { kg.rotate("user"); why = "rotated"; } catch (LocalKey.NotSaved x) { why = "not saved"; }
        check("not saved".equals(why) && g.m.equals(g.disk) && kg.current().equals(before) && kg.accepted().size() == 1 && g.getString("event_key_prev") == null,
                "a rotation that can't be saved: NotSaved, memory is the saved state again, the old key stays current and no previous key appears");
        // storage that stays full: every call fails, and no key ever comes back that isn't on disk
        Mem full = new Mem();
        full.failNext = 1000;
        LocalKey kfull = make(full, 1);
        int notSaved = 0;
        for (int i = 0; i < 5; i++) { try { kfull.current(); } catch (LocalKey.NotSaved x) { notSaved++; } }
        check(notSaved == 5 && full.m.equals(full.disk) && full.getString("event_key") == null, "storage that stays full: every call is NotSaved, nothing unsaved is ever read back");
        full.failNext = 0;
        String saved = kfull.current();
        check(saved.equals(full.disk.get("event_key")), "once storage works, the key returned is the one on disk");
        // a failed undo too (the third commit fails): the values read back are still the saved ones
        Mem u = new Mem();
        u.failNext = 3;
        try { make(u, 1).current(); } catch (LocalKey.NotSaved x) { }
        check(u.m.equals(u.disk), "even when putting the old values back also fails to reach the disk, memory holds no unsaved key");
        // share: true only once the key was saved and its command handed over
        java.util.List<String> ran = new java.util.ArrayList<>();
        Mem sfull = new Mem();
        sfull.failNext = 1000;
        check(!make(sfull, 1).share(ran::add) && ran.isEmpty(), "share with a key that can't be saved: false, nothing handed over");
        Mem sok = new Mem();
        LocalKey ks = make(sok, 1);
        check(!ks.share(c2 -> { throw new Exception("refused"); }), "share when the command can't be handed over: false (the caller tries again)");
        check(ks.share(ran::add) && ran.size() == 1 && ran.get(0).equals(LocalKey.shareCommand(ks.current())), "share: true, and the command carries the saved key");
        java.util.List<String> started = new java.util.ArrayList<>();
        check(!ks.share(LocalKey.starting(c2 -> { started.add(c2); return null; })) && started.size() == 1,
                "share through a start call that returns null (nothing started): false, so the caller tries again");
        check(ks.share(LocalKey.starting(c2 -> "started")), "share through a start call that started something: true");
        String hintWhy = "";
        Mem h = new Mem();
        h.failNext = 2;
        try { make(h, 1).hint(); } catch (LocalKey.NotSaved x) { hintWhy = "not saved"; }
        check("not saved".equals(hintWhy), "the hello hint of an unsaved key: NotSaved too (a client then sends nothing)");

        rotationLimits();
        switchConditions();
        switchSteps();
        switchCap();
        legacyAndUpdate();
        legacyPause();
        reshareOnlyWhenSeen();
        bootLooks();
        tickerHeard();
        damagedSeen();
        legacySaves();
        enforcedCommands();

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }

    // ── the switch (LocalKey.tick, confirm, legacySeen) and the rotation limits ──

    /** A new process after a crash: it reads only what reached the disk. */
    static Mem restart(Mem x) {
        Mem r = new Mem();
        r.m.putAll(x.disk);
        r.disk.putAll(x.disk);
        return r;
    }
    static final String STAMP = "1800000000";
    static LocalKey.Facts ready() { return new LocalKey.Facts(true, "current", STAMP, STAMP, false); }
    /** A store whose key Termux has shown it holds, whose last plugin run copied the scripts, and a request verified since. */
    static LocalKey readyKey(Mem m, long version) {
        LocalKey k = make(m, version);
        k.current();
        k.scriptsCopied(true);
        k.tickerSeen(true);
        k.confirm(LocalAuth.kid(k.current()));
        return k;
    }
    static final class Rec implements LocalKey.Runner {
        final java.util.List<String> cmds = new java.util.ArrayList<>();
        boolean fail;
        Runnable during;
        @Override public void run(String cmd) throws Exception {
            if (during != null) during.run();
            if (fail) throw new Exception("not handed over");
            cmds.add(cmd);
        }
    }

    static void rotationLimits() {
        Mem m = new Mem();
        LocalKey k = make(m, 3);
        String a = k.current();
        check(k.rotateWait("user") == 0 && k.rotate("user"), "a first rotation runs at once");
        String b = k.current();
        check(!k.rotate("user") && k.current().equals(b), "a second one right after is refused (the minimum interval)");
        long w = k.rotateWait("user");
        check(w >= LocalKey.MIN_ROTATE_MS && w <= LocalKey.GRACE_MS, "... and waits while Termux hasn't shown it holds the new key (" + w + " ms)");
        now += LocalKey.MIN_ROTATE_MS;
        check(!k.rotate("user") && k.accepted().equals(List.of(b, a)), "past the minimum interval, still refused while the previous key is in its grace and the current one unconfirmed");
        k.confirm(LocalAuth.kid(b));
        check(k.rotateWait("user") == 0 && k.rotate("user"), "once Termux used the current key, the next rotation may run");
        String c = k.current();
        check(k.accepted().equals(List.of(c, b)) && k.byKid(LocalAuth.kid(a)) == null && !k.isAccepted(a),
                "at most the current key and one previous one count: the oldest is gone");
        // a storm: a thousand requests for a rotation in an hour, with Termux confirming every key at once
        Mem s = new Mem();
        LocalKey ks = make(s, 3);
        ks.current();
        int rotations = 0, most = 0;
        for (int i = 0; i < 1000; i++) {
            now += 3_600; // 3.6 s apart: 1000 in an hour
            if (ks.rotate(i % 2 == 0 ? "user" : "legacy_seen")) rotations++;
            ks.confirm(LocalAuth.kid(ks.current()));
            most = Math.max(most, ks.accepted().size());
        }
        check(rotations >= 1 && rotations <= 3600_000 / LocalKey.MIN_ROTATE_MS + 1 && most <= 2, "a storm of requests: at most one rotation per " + (LocalKey.MIN_ROTATE_MS / 60_000) + " minutes, never more than two keys (" + rotations + ")");
        // the same storm without Termux ever confirming: one rotation in a day
        Mem u = new Mem();
        LocalKey ku = make(u, 3);
        ku.current();
        rotations = 0;
        for (int i = 0; i < 1000; i++) { now += 60_000; if (ku.rotate("user")) rotations++; }
        check(rotations == 1, "without a confirm, one rotation until the previous key's grace ends (" + rotations + ")");
        now += LocalKey.GRACE_MS;
        check(ku.rotate("user"), "... and the next once it has ended");
        // a clock set back does not block rotations
        Mem cb = new Mem();
        LocalKey kb = make(cb, 3);
        kb.rotate("user");
        kb.confirm(LocalAuth.kid(kb.current()));
        now -= 3_600_000L;
        check(kb.rotateWait("user") == 0, "a clock set back counts as time passed: the minimum interval doesn't hold rotations for long");
        now += 3_600_000L;
        // per reason
        check(make(cb, 3).rotateWait("update") == -1, "update: not due while the key was made under this version");
        check(make(cb, 4).rotateWait("update") >= 0, "update: due under a new version");
        check(make(cb, 3).rotateWait("legacy_seen") == -1, "legacy_seen: never before the switch");
        boolean bad = false;
        try { k.rotateWait("x"); } catch (IllegalArgumentException x) { bad = true; }
        check(bad, "rotateWait: an unknown reason is refused");
        // signed requests with the previous key during its grace, the raw previous key after the switch
        Mem p = new Mem();
        LocalKey kp = readyKey(p, 3);
        String old = kp.current();
        Rec rec = new Rec();
        kp.tick(ready(), rec);
        String cur = kp.current();
        check(kp.byKid(LocalAuth.kid(old)) != null && kp.stale(LocalAuth.kid(old)) && !kp.stale(LocalAuth.kid(cur)) && !kp.stale("zz"),
                "during the grace a signed request under the previous key is accepted, and marks Termux as stale");
        kp.confirm(LocalAuth.kid(cur));
        check(!kp.rawAccepted() && kp.isAccepted(old) && kp.byKid(LocalAuth.kid(old)) != null,
                "after the switch the previous key still signs for its 2 minutes, but no raw key counts (the listener refuses rawAccepted false)");
        now += LocalKey.CONFIRM_MS;
        check(kp.byKid(LocalAuth.kid(old)) == null && kp.accepted().equals(List.of(cur)), "... then only the current key");
    }

    static void switchConditions() {
        // the plugin speaks the hello by the same definition the app's clients use (LocalDashboard.plugin)
        check(new LocalKey.Facts(true, "current", STAMP, STAMP, false).pluginHello, "a plugin as new as the APK's speaks the hello");
        check(!new LocalKey.Facts(true, "current", "1700000000", STAMP, false).pluginHello, "an older stamp does not (P_HELLO not set)");
        check(!new LocalKey.Facts(true, "current", "", STAMP, false).pluginHello && !new LocalKey.Facts(true, "current", "x", STAMP, false).pluginHello, "no stamp or a malformed one does not");
        check(LocalDashboard.P_HELLO == 0 || new LocalKey.Facts(true, "current", String.valueOf(LocalDashboard.P_HELLO), STAMP, false).pluginHello, "a stamp at P_HELLO does, once it is set");
        // ready: every condition on its own keeps the window open
        LocalKey.Facts ok = ready();
        check(LocalKey.ready(ok, true, true, true), "all conditions: ready");
        check(!LocalKey.ready(new LocalKey.Facts(false, "current", STAMP, STAMP, false), true, true, true), "not set up: not ready");
        for (String st : new String[] {"older", "held", "modified", "newer", "failed", "busy", "unknown", ""})
            check(!LocalKey.ready(new LocalKey.Facts(true, st, STAMP, STAMP, false), true, true, true), "plugin state " + st + ": not ready");
        check(!LocalKey.ready(new LocalKey.Facts(true, "current", "1700000000", STAMP, false), true, true, true), "a plugin without the hello: not ready");
        check(!LocalKey.ready(new LocalKey.Facts(true, "current", STAMP, STAMP, true), true, true, true), "an update or the installer running: not ready");
        check(!LocalKey.ready(ok, false, true, true), "scripts not copied: not ready");
        check(!LocalKey.ready(ok, true, false, true), "no verified request since: not ready");
        check(!LocalKey.ready(ok, true, true, false), "the cron ticker not heard running the new code: not ready");
        // the scripts line
        Object[][] lines = {
            {"HMPLUGIN SCRIPTS ok\nHMPLUGIN OK 1", Boolean.TRUE}, {"HMPLUGIN SCRIPTS fail copy\nHMPLUGIN OK 1", Boolean.FALSE},
            {"HMPLUGIN SCRIPTS fail\nHMPLUGIN OK 1", Boolean.FALSE}, {"HMPLUGIN OK 1", null}, {"", null}, {null, null},
            {"HMPLUGIN SCRIPTS ok\nHMPLUGIN SCRIPTS fail changed\nHMPLUGIN OK 1", Boolean.FALSE},
            {"HMPLUGIN SCRIPTS okay\nHMPLUGIN OK 1", null}, {"x HMPLUGIN SCRIPTS ok", null}, {"HMPLUGIN SCRIPTS failed", null},
        };
        for (Object[] l : lines) check(java.util.Objects.equals(LocalKey.scriptsLine((String) l[0]), l[1]), "scripts line " + String.valueOf(l[0]).replace("\n", " | ") + " -> " + l[1]);
        // a verified request counts only after the scripts line, and only under the current key
        Mem m = new Mem();
        LocalKey k = make(m, 3);
        String key = k.current();
        k.confirm(LocalAuth.kid(key));
        k.scriptsCopied(true);
        k.tickerSeen(true);
        Rec rec = new Rec();
        check(k.tick(ok, rec).rotated == null && rec.cmds.isEmpty(), "a verified request before the scripts line doesn't count: the window stays open");
        k.confirm(LocalAuth.kid(key));
        check(k.tick(new LocalKey.Facts(true, "current", STAMP, STAMP, true), rec).rotated == null, "busy: nothing happens");
        check("enforce".equals(k.tick(ok, rec).rotated), "after it, ready: step 1 runs");
        Mem f = new Mem();
        LocalKey kf = readyKey(f, 3);
        kf.scriptsCopied(false);
        kf.confirm(LocalAuth.kid(kf.current()));
        check(kf.tick(ok, rec).rotated == null, "scripts line fail: the window stays open");
    }

    static void switchSteps() throws Exception {
        LocalKey.Facts ok = ready();
        Mem m = new Mem();
        LocalKey k = readyKey(m, 3);
        String k0 = k.current();
        check(k.rawAccepted() && k.shareMode() == LocalKey.Mode.KEEP, "in the window: the raw key is accepted, a share writes the key only");
        Rec rec = new Rec();
        final String[] atShare = new String[3];
        rec.during = () -> { // what had reached the disk when the share was handed over
            atShare[0] = (String) m.disk.get("local_enforce_kid");
            atShare[1] = (String) m.disk.get("event_key");
            atShare[2] = String.valueOf(m.disk.get("local_enforced"));
        };
        LocalKey.Result r = k.tick(ok, rec);
        String k1 = k.current();
        check("enforce".equals(r.rotated) && r.shared && r.enforced == null, "ready: step 1 (rotate, why=enforce) and step 2 (share) in one look, not step 3");
        check(!k1.equals(k0) && k.accepted().equals(List.of(k1, k0)), "step 1: a new key, the previous one in its grace");
        check(LocalAuth.kid(k1).equals(atShare[0]) && k1.equals(atShare[1]) && "null".equals(atShare[2]),
                "order: the new key and local_enforce_kid were saved before the share was handed over, local_enforced not yet");
        check(rec.cmds.equals(List.of(LocalKey.shareCommand(k1, LocalKey.Mode.ENFORCED))), "step 2: the new key and the enforced file in one command");
        check(k.rawAccepted(), "until Termux uses the new key, the listener still accepts the raw key (its own helpers may not have it yet)");
        check(k.tick(ok, rec).rotated == null && rec.cmds.size() == 1, "the next look: no second rotation, no share within 10 minutes");
        check(!k.confirm(LocalAuth.kid(k0)) && k.rawAccepted(), "a request under the previous key: still not step 3");
        check(k.confirm(LocalAuth.kid(k1)) && !k.rawAccepted() && Boolean.TRUE.equals(m.disk.get("local_enforced")),
                "a request verified under the new key: step 3 saved, the raw key refused, the grace cut");
        check(k.shareMode() == LocalKey.Mode.ENFORCED && !k.scriptsOld(), "from then on every share carries the enforced file; no Setup row");
        int n = rec.cmds.size();
        LocalKey.Result after = k.tick(ok, rec);
        check(after.rotated == null && !after.shared && rec.cmds.size() == n, "after the switch a look does nothing more");
        check(k.rotateWait("enforce") == -1, "the switch runs once");

        // a crash after step 1 (before the share was handed over)
        Mem c1 = new Mem();
        LocalKey a1 = readyKey(c1, 3);
        Rec crash = new Rec();
        crash.during = () -> { throw new AssertionError("the process dies"); };
        boolean died = false;
        try { a1.tick(ok, crash); } catch (AssertionError x) { died = true; }
        Mem d1 = restart(c1);
        LocalKey b1 = make(d1, 3);
        String n1 = b1.current();
        Rec rec1 = new Rec();
        LocalKey.Result r1 = b1.tick(ok, rec1);
        check(died && b1.rawAccepted() && r1.rotated == null && r1.shared && rec1.cmds.equals(List.of(LocalKey.shareCommand(n1, LocalKey.Mode.ENFORCED))),
                "a crash after step 1: the next start doesn't rotate again and shares the same new key with the enforced file");
        check(b1.confirm(LocalAuth.kid(n1)) && !b1.rawAccepted(), "... and the first request under it is step 3");
        // a share that isn't handed over (no permission, Termux gone)
        Mem c2 = new Mem();
        LocalKey a2 = readyKey(c2, 3);
        Rec refuse = new Rec();
        refuse.fail = true;
        LocalKey.Result r2 = a2.tick(ok, refuse);
        check("enforce".equals(r2.rotated) && !r2.shared && a2.rawAccepted(), "a share not handed over: step 1 kept, nothing enforced");
        Rec later = new Rec();
        check(a2.tick(ok, later).shared && later.cmds.size() == 1, "... the next look shares again");
        now += LocalKey.RESHARE_MS - 1;
        check(!a2.tick(ok, later).shared, "... not again within 10 minutes");
        now += 1;
        check(a2.tick(ok, later).shared && later.cmds.size() == 2, "... again after 10 minutes while Termux hasn't used the new key");
        check(make(restart(c2), 3).rawAccepted(), "a new start before Termux used the key: the raw key is still accepted");
        // a crash after step 2 (handed over), before any request under the new key
        Mem d2 = restart(c2);
        LocalKey b2 = make(d2, 3);
        Rec rec2 = new Rec();
        check(b2.tick(ok, rec2).rotated == null && rec2.cmds.size() == 1, "a crash after step 2: the next start shares once more, no rotation");
        check(b2.confirm(LocalAuth.kid(b2.current())) && !make(restart(d2), 3).rawAccepted(), "step 3 survives a restart");
        // a key that can't be saved: step 1 doesn't happen, nothing is shared, a later look tries again
        Mem full = new Mem();
        LocalKey kf = readyKey(full, 3);
        String before = kf.current();
        full.failNext = 3; // the window's start, then the rotation and its retry
        Rec rf = new Rec();
        LocalKey.Result rr = kf.tick(ok, rf);
        check(rr.rotated == null && !rr.shared && rf.cmds.isEmpty() && rr.retryMs == 60_000L && kf.current().equals(before) && full.getString("local_enforce_kid") == null,
                "step 1 not saved: the old key stays, nothing shared, another look in a minute");
        check("enforce".equals(kf.tick(ok, rf).rotated), "... and the next look runs it");
        // a store that says it is enforced without step 1 (a hand edit): shares carry the enforced file
        Mem h = new Mem();
        h.m.put("local_enforced", true);
        check(make(h, 3).shareMode() == LocalKey.Mode.ENFORCED && !make(h, 3).rawAccepted(), "local_enforced alone: enforced, and shares carry the file");
    }

    static long up = 1_000_000L; // time since boot, ms: what the window counts (the wall clock `now` may be anything)
    static LocalKey makeUp(Mem m, long version) { return new LocalKey(m, () -> now, () -> up, version); }

    static void switchCap() {
        long day = 24 * 3_600_000L;
        check(LocalKey.CAP_MS == 14 * day, "the cap is 14 days");
        // window(): how long the window has lasted, in real time since boot
        // window(storedVersion, storedMs, storedSeen, storedBoot, version, up, boot) -> {version, ms, seen, boot}
        long C = LocalKey.CAP_MS;
        Object[][] w = {
            {0L, 0L, 0L, -1L, 5L, 500L, 7L, 5L, 0L, 500L, 7L, "never started: starts at 0 now"},
            {5L, 1000L, 200L, 7L, 5L, 700L, 7L, 5L, 1500L, 700L, 7L, "same boot count: the real time since the last look is added"},
            {5L, 1000L, 900L, 7L, 5L, 300L, 8L, 5L, 1300L, 300L, 8L, "another boot count: the time since this boot is added"},
            {5L, 1000L, 200L, 7L, 5L, 900L, 8L, 5L, 1700L, 900L, 8L, "another boot count with more time since boot than at the last look: only the difference (counts less, never more)"},
            {5L, 1000L, -5L, 7L, 5L, 900L, 7L, 5L, 1000L, 900L, 7L, "a stored time since boot below 0 (damaged): adds nothing, counts from now"},
            {5L, 1000L, -1L, 7L, 5L, 900L, 8L, 5L, 1000L, 900L, 8L, "a missing time since boot (read as -1): adds nothing, counts from now"},
            {5L, 1000L, 900L, -1L, 5L, 300L, -1L, 5L, 1300L, 300L, -1L, "no boot count: a time since boot below the last look is a reboot"},
            {5L, 1000L, 200L, -1L, 5L, 900L, -1L, 5L, 1700L, 900L, -1L, "no boot count, more time since boot: counted as the same boot (never more than real time)"},
            {5L, 1000L, 900L, 7L, 5L, 300L, -1L, 5L, 1300L, 300L, -1L, "the boot count stops being readable: the time-since-boot rule"},
            {5L, 1000L, 900L, 7L, 5L, 300L, 7L, 5L, 1000L, 300L, 7L, "the same boot count but less time since boot (a damaged value): adds nothing"},
            {5L, 1000L, 200L, 7L, 6L, 700L, 7L, 6L, 1500L, 700L, 7L, "a later version keeps counting (an update doesn't lengthen the window)"},
            {6L, 1000L, 200L, 7L, 5L, 700L, 7L, 5L, 0L, 700L, 7L, "an older version (a downgrade keeping data): starts again at 0"},
            {5L, 0L, 200L, 7L, 5L, 200L + 30 * day, 7L, 5L, C, 200L + 30 * day, 7L, "one look adds at most the cap, and the total stays at the cap"},
            {5L, -5L, 200L, 7L, 5L, 700L, 7L, 5L, 0L, 700L, 7L, "a damaged stored length below 0: starts again at 0"},
            {5L, C + 1, 200L, 7L, 5L, 700L, 7L, 5L, 0L, 700L, 7L, "a damaged stored length above the cap: starts again at 0 (never early)"},
            {5L, 1000L, 200L, 7L, 5L, -3L, 7L, 5L, 0L, 0L, 7L, "a time since boot below 0: starts again at 0"},
        };
        for (Object[] x : w) {
            long[] got = LocalKey.window((Long) x[0], (Long) x[1], (Long) x[2], (Long) x[3], (Long) x[4], (Long) x[5], (Long) x[6]);
            check(got[0] == (Long) x[7] && got[1] == (Long) x[8] && got[2] == (Long) x[9] && got[3] == (Long) x[10],
                    "window: " + x[11] + " " + java.util.Arrays.toString(got));
        }
        check(!LocalKey.capReached(0) && !LocalKey.capReached(LocalKey.CAP_MS - 1) && LocalKey.capReached(LocalKey.CAP_MS), "capReached: from 14 days of counted time on");
        LocalKey.Facts held = new LocalKey.Facts(true, "held", "1700000000", STAMP, false);
        Rec rec = new Rec();
        // a held plugin: the conditions never come; 14 days of real time after the window began the switch runs anyway
        Mem m = new Mem();
        LocalKey k = makeUp(m, 5);
        k.current();
        long u0 = up;
        LocalKey.Result r = k.tick(held, rec);
        check(r.rotated == null && m.getLong("local_window_ms") == 0 && m.getLong("local_window_seen") == u0 && m.getLong("local_window_version") == 5,
                "the first look once set up starts the window at 0, under this version");
        up = u0 + LocalKey.CAP_MS - 1;
        check(k.tick(held, rec).rotated == null && k.rawAccepted() && !k.scriptsOld(), "a millisecond before the cap: still open, no Setup row");
        up = u0 + LocalKey.CAP_MS;
        r = k.tick(held, rec);
        check("enforce".equals(r.rotated) && r.shared && "cap".equals(r.enforced) && !k.rawAccepted(),
                "at the cap: rotate, share, then the listener refuses the raw key, in one look");
        check(rec.cmds.get(rec.cmds.size() - 1).equals(LocalKey.shareCommand(k.current(), LocalKey.Mode.ENFORCED)), "... the share carries the enforced file");
        check(k.scriptsOld(), "... and the Setup row 'Phone scripts out of date' is on");
        k.scriptsCopied(false);
        check(k.scriptsOld(), "a later scripts line that failed keeps it on");
        k.scriptsCopied(true);
        check(!k.scriptsOld() && !k.rawAccepted(), "a later scripts line ok turns it off; the switch stays");
        // the wall clock can neither start nor end the window: in the past at boot, set forward, set back
        Mem c = new Mem();
        LocalKey kc = makeUp(c, 5);
        kc.current();
        long wall = now, u1 = up;
        now = wall - 400 * day; // the phone starts with its clock far in the past (no network time yet)
        kc.tick(held, rec);
        now = wall; // network time arrives
        up = u1 + 60_000;
        check(kc.tick(held, rec).rotated == null && kc.rawAccepted() && c.getLong("local_window_ms") == 60_000,
                "a clock in the past at boot, then right: the window has lasted a minute, no cap");
        now = wall + 30 * day; // the clock jumps forward
        up = u1 + 120_000;
        check(kc.tick(held, rec).rotated == null && kc.rawAccepted(), "a clock set a month forward: no cap");
        now = wall - day; // and back
        up = u1 + 180_000;
        check(kc.tick(held, rec).rotated == null && kc.rawAccepted() && c.getLong("local_window_ms") == 180_000, "a clock set back: counted the same");
        now = wall;
        // reboots: time since boot starts again; only real time is counted, never more
        long before = c.getLong("local_window_ms");
        up = 5_000; // a reboot: 5 s since this boot
        kc.tick(held, rec);
        check(c.getLong("local_window_ms") == before + 5_000, "a reboot: the time since this boot is added (time switched off is not)");
        for (int i = 0; i < 13; i++) { up += day; kc.tick(held, rec); up = 1_000; kc.tick(held, rec); }
        check(kc.rawAccepted(), "13 days of uptime across many reboots: still open");
        up += day;
        check("enforce".equals(kc.tick(held, rec).rotated) && !kc.rawAccepted(), "the 14th day of real time: the cap");
        // not set up: no window, no cap
        Mem n = new Mem();
        LocalKey kn = makeUp(n, 5);
        LocalKey.Facts notSet = new LocalKey.Facts(false, "unknown", "", STAMP, false);
        kn.tick(notSet, rec);
        up += 30 * day;
        check(kn.tick(notSet, rec).rotated == null && n.getLong("local_window_version") == 0 && kn.rawAccepted(), "a phone never set up: the window doesn't start, so no cap");
        // a version change keeps counting; an update rotation in that look comes first, the switch follows
        Mem v = new Mem();
        LocalKey kv = makeUp(v, 5);
        kv.current();
        long uv = up;
        kv.tick(held, rec);
        up = uv + LocalKey.CAP_MS - 3_600_000L; // an hour before the cap, so the update's grace still runs at the cap
        LocalKey kv6 = makeUp(v, 6);
        LocalKey.Result rv = kv6.tick(held, rec);
        check("update".equals(rv.rotated) && v.getLong("local_window_ms") == LocalKey.CAP_MS - 3_600_000L && v.getLong("local_window_version") == 6,
                "an update during the window: a rotation, the time counted so far kept");
        up = uv + LocalKey.CAP_MS;
        LocalKey.Result rc = kv6.tick(held, rec);
        check(rc.rotated == null && rc.retryMs > 0 && kv6.rawAccepted(), "at the cap with the update's key unconfirmed: wait (never drop a key Termux may still use)");
        kv6.confirm(LocalAuth.kid(kv6.current()));
        now += LocalKey.MIN_ROTATE_MS;
        rc = kv6.tick(held, rec);
        check("enforce".equals(rc.rotated) && "cap".equals(rc.enforced), "... once Termux holds it: the switch runs");
        // a downgrade that kept the app's data starts the window again
        Mem g = new Mem();
        LocalKey kg = makeUp(g, 6);
        kg.current();
        kg.tick(held, rec);
        up += 5 * day;
        kg.tick(held, rec);
        makeUp(g, 5).tick(held, rec);
        check(g.getLong("local_window_ms") == 0 && g.getLong("local_window_version") == 5, "an older version: the window starts again at 0");
        // the switch began by the conditions, but Termux never used the new key: the cap ends the wait
        Mem s = new Mem();
        LocalKey ks = makeUp(s, 5);
        ks.current();
        long us = up;
        ks.tick(held, rec); // the window starts
        ks.scriptsCopied(true);
        ks.tickerSeen(true);
        ks.confirm(LocalAuth.kid(ks.current()));
        now += LocalKey.MIN_ROTATE_MS;
        LocalKey.Result rs = ks.tick(ready(), rec);
        check("enforce".equals(rs.rotated) && rs.enforced == null && ks.rawAccepted() && !ks.scriptsOld(), "begun by the conditions: waiting for Termux, no Setup row");
        up = us + LocalKey.CAP_MS;
        rs = ks.tick(ready(), rec);
        check(rs.rotated == null && "cap".equals(rs.enforced) && !ks.rawAccepted() && !ks.scriptsOld(), "no request under the new key for 14 days: the cap does step 3 (no new rotation, no Setup row)");

        // the Setup row and its button
        check(LocalKey.scriptsRow(true, false) && !LocalKey.scriptsRow(true, true) && !LocalKey.scriptsRow(false, false) && !LocalKey.scriptsRow(false, true),
                "the row: only when the cap forced the switch and the last scripts line was not ok");
        Mem hm = new Mem();
        LocalKey kh = makeUp(hm, 5);
        kh.current();
        kh.scriptsCopied(true); // a hand-changed plugin whose scripts were copied before
        long uh = up;
        kh.tick(new LocalKey.Facts(true, "modified", STAMP, STAMP, false), rec);
        up = uh + LocalKey.CAP_MS;
        kh.tick(new LocalKey.Facts(true, "modified", STAMP, STAMP, false), rec);
        check(!kh.rawAccepted() && !kh.scriptsOld(), "a hand-changed plugin that speaks the hello, scripts copied: the cap closes the window, no row");
        check("force".equals(LocalKey.scriptsFix("modified")) && "none".equals(LocalKey.scriptsFix("held")) && "none".equals(LocalKey.scriptsFix("newer"))
                && "update".equals(LocalKey.scriptsFix("older")) && "update".equals(LocalKey.scriptsFix("failed")) && "update".equals(LocalKey.scriptsFix(null)),
                "the row's button: replace a hand-changed plugin, nothing for a held or newer one, else update");

        // a rollback build (ENFORCE false) forgets the switch, so a later build runs the conditions again
        Mem fb = new Mem();
        LocalKey kf = makeUp(fb, 5);
        kf.current();
        long uf = up;
        kf.tick(held, rec);
        up = uf + LocalKey.CAP_MS;
        kf.tick(held, rec);
        check(!kf.rawAccepted() && kf.scriptsOld(), "(before the rollback: enforced by the cap)");
        check(!kf.forgetSwitch(true), "a build with ENFORCE on forgets nothing");
        check(kf.forgetSwitch(false), "a build with ENFORCE off forgets the switch's saved steps");
        check(kf.rawAccepted() && !kf.scriptsOld() && fb.get("local_enforce_kid") == null && fb.get("local_window_ms") == null && kf.shareMode() == LocalKey.Mode.KEEP,
                "... the raw key is accepted, no row, the window gone, shares write the key only");
        check(!kf.forgetSwitch(false), "... and again forgets nothing");
        now += LocalKey.MIN_ROTATE_MS;
        LocalKey.Result rf = kf.tick(held, rec);
        check(rf.rotated == null && kf.rawAccepted() && fb.getLong("local_window_ms") == 0, "the next build with it on: no enforcing at once, a new window from 0");
    }

    static void legacyPause() {
        // a lasting raw-key sender with the cap's row on: three legacy_seen rotations in a row, then they stop
        Mem m = new Mem();
        LocalKey k = makeUp(m, 5);
        k.current();
        LocalKey.Facts held = new LocalKey.Facts(true, "held", "1700000000", STAMP, false);
        Rec rec = new Rec();
        long u = up;
        k.tick(held, rec);
        up = u + LocalKey.CAP_MS;
        k.tick(held, rec);
        check(!k.rawAccepted() && k.scriptsOld(), "(the cap closed the window with the row on)");
        int rotations = 0, pausedNotes = 0;
        for (int d = 0; d < 6; d++) {
            k.confirm(LocalAuth.kid(k.current()));
            now += LocalKey.LEGACY_EVERY_MS + 60_000;
            LocalKey.Result r = k.legacySeen(rec);
            if (r.rotated != null) rotations++;
            if (r.paused) pausedNotes++;
        }
        check(rotations == LocalKey.LEGACY_MAX_RUN && LocalKey.LEGACY_MAX_RUN == 3, "a raw key every day: three rotations, then none (" + rotations + ")");
        check(pausedNotes == 1, "... the pause is noted once (" + pausedNotes + ")");
        now += 2 * LocalKey.LEGACY_EVERY_MS + 60_000; // a whole day without a raw key
        check("legacy_seen".equals(k.legacySeen(rec).rotated), "after a day without a raw key the count starts again");
        // an app update starts the count again too
        for (int d = 0; d < 4; d++) { k.confirm(LocalAuth.kid(k.current())); now += LocalKey.LEGACY_EVERY_MS + 60_000; k.legacySeen(rec); }
        check(k.legacySeen(rec).rotated == null, "(paused again)");
        LocalKey k6 = makeUp(m, 6);
        k6.confirm(LocalAuth.kid(k6.current()));
        now += LocalKey.MIN_ROTATE_MS;
        check("update".equals(k6.tick(held, rec).rotated), "(an app update)");
        k6.confirm(LocalAuth.kid(k6.current()));
        now += LocalKey.LEGACY_EVERY_MS + 60_000;
        check("legacy_seen".equals(k6.legacySeen(rec).rotated), "after an app update the count starts again");
        // without the cap's row (the scripts were copied) rotations go on every day
        Mem n = new Mem();
        LocalKey kn = readyKey(n, 5);
        kn.tick(ready(), rec);
        kn.confirm(LocalAuth.kid(kn.current()));
        rotations = 0;
        for (int d = 0; d < 5; d++) {
            kn.confirm(LocalAuth.kid(kn.current()));
            now += LocalKey.LEGACY_EVERY_MS + 60_000;
            if (kn.legacySeen(rec).rotated != null) rotations++;
        }
        check(rotations == 5, "without the cap's row a raw key rotates the key every day (" + rotations + ")");
    }

    static void reshareOnlyWhenSeen() {
        Mem m = new Mem();
        LocalKey k = make(m, 5);
        String k0 = k.current();
        check(!k.reshareWanted(), "nothing seen: a bare nudge shares nothing");
        LocalServer.Keys sk = k.serverKeys();
        check(k0.equals(LocalServer.helloKey(sk, LocalAuth.kid(k0))) && !k.reshareWanted(), "a hello naming the current key: nothing wanted");
        check(k0.equals(LocalServer.helloKey(sk, null)) && LocalServer.helloKey(sk, "zz") != null && !k.reshareWanted(), "a hello without a hint, or a malformed one: nothing wanted");
        LocalServer.helloKey(sk, "0123abcd");
        check(k.reshareWanted(), "a hello naming a key id that isn't ours (Termux holds a stale key): a share is wanted");
        Rec rec = new Rec();
        check(k.share(rec) && !k.reshareWanted(), "a share clears it");
        LocalServer.helloKey(sk, "0123abcd");
        check(!k.reshareWanted(), "seen again within 10 minutes: not yet");
        now += LocalKey.RESHARE_MS;
        check(k.reshareWanted(), "... after them, wanted");
        k.share(rec);
        k.rotate("user");
        check(k.stale(LocalAuth.kid(k0)) && k.reshareWanted() == k.shareDue(), "a request under the previous key marks a share as wanted");
    }

    static void legacyAndUpdate() {
        // after an app update: one rotation, the key alone
        Mem m = new Mem();
        LocalKey k8 = make(m, 8);
        String a = k8.current();
        LocalKey k9 = make(m, 9);
        Rec rec = new Rec();
        LocalKey.Result r = k9.tick(new LocalKey.Facts(true, "older", "1700000000", STAMP, false), rec);
        check("update".equals(r.rotated) && r.shared && !k9.current().equals(a) && k9.version() == 9
                && rec.cmds.equals(List.of(LocalKey.shareCommand(k9.current(), LocalKey.Mode.KEEP))), "an app update: one rotation (why=update), the new key shared without the enforced file");
        check(k9.tick(new LocalKey.Facts(true, "older", "1700000000", STAMP, false), rec).rotated == null, "... once per version");
        Mem o = new Mem();
        o.m.put("event_key", "0123456789abcdef0123456789abcdef0123456789abcdef");
        check("update".equals(make(o, 9).tick(new LocalKey.Facts(true, "older", "", STAMP, false), new Rec()).rotated), "a key from an app that kept no version: rotated after the update");
        // a raw key after the switch
        Mem e = new Mem();
        LocalKey ke = readyKey(e, 3);
        Rec re = new Rec();
        check(ke.legacySeen(re).rotated == null && re.cmds.isEmpty(), "legacy_seen before the switch: nothing");
        ke.tick(ready(), re);
        ke.confirm(LocalAuth.kid(ke.current()));
        now += LocalKey.MIN_ROTATE_MS;
        String before = ke.current();
        LocalKey.Result l = ke.legacySeen(re);
        check("legacy_seen".equals(l.rotated) && l.shared && !ke.current().equals(before)
                && re.cmds.get(re.cmds.size() - 1).equals(LocalKey.shareCommand(ke.current(), LocalKey.Mode.ENFORCED)), "a raw key after the switch: one more rotation, shared with the enforced file");
        ke.confirm(LocalAuth.kid(ke.current()));
        now += 2 * LocalKey.MIN_ROTATE_MS;
        check(ke.legacySeen(re).rotated == null, "... at most once a day");
        now += LocalKey.LEGACY_EVERY_MS;
        check("legacy_seen".equals(ke.legacySeen(re).rotated), "... and again the next day");
        check(!ke.rawAccepted(), "a legacy rotation never reopens the window");
    }

    static void enforcedCommands() throws Exception {
        String key = "0123456789abcdef0123456789abcdef0123456789abcdef";
        String enf = LocalKey.shareCommand(key, LocalKey.Mode.ENFORCED);
        check(enf.equals("umask 077 && mkdir -p ~/.hermes-mobile && { printf %s " + key + " > ~/.hermes-mobile/key.$$.tmp && : > ~/.hermes-mobile/enforced.$$.tmp"
                        + " && mv -f ~/.hermes-mobile/enforced.$$.tmp ~/.hermes-mobile/enforced && mv -f ~/.hermes-mobile/key.$$.tmp ~/.hermes-mobile/key"
                        + " || { rm -f ~/.hermes-mobile/key.$$.tmp ~/.hermes-mobile/enforced.$$.tmp; exit 1; }; }"),
                "the switch's command: the key to a temporary file, the enforced file moved in place, then the key moved over the old one");
        check(enf.indexOf("~/.hermes-mobile/enforced &&") < enf.indexOf("mv -f ~/.hermes-mobile/key.$$.tmp"), "... the enforced file before the key, so a Termux with the new key has it");
        String open = LocalKey.shareCommand(key, LocalKey.Mode.OPEN);
        check(open.equals("umask 077 && mkdir -p ~/.hermes-mobile && { printf %s " + key + " > ~/.hermes-mobile/key.$$.tmp && mv -f ~/.hermes-mobile/key.$$.tmp ~/.hermes-mobile/key"
                + " && rm -f ~/.hermes-mobile/enforced || { rm -f ~/.hermes-mobile/key.$$.tmp; exit 1; }; }"), "a rollback build's command: the key, then the enforced file removed");
        check(LocalKey.shareCommand(key).equals(LocalKey.shareCommand(key, LocalKey.Mode.KEEP)), "the plain command is KEEP");
        boolean no = false;
        try { LocalKey.shareCommand(key, null); } catch (IllegalArgumentException x) { no = true; }
        check(no, "no command without a mode");
        File home = Files.createTempDirectory("lke").toFile();
        File dir = new File(home, ".hermes-mobile");
        int rc = run(home, enf);
        File k = new File(dir, "key"), e = new File(dir, "enforced");
        check(rc == 0 && new String(Files.readAllBytes(k.toPath()), StandardCharsets.US_ASCII).equals(key) && e.isFile() && e.length() == 0,
                "run by sh: the key file holds the key and the enforced file exists");
        check(Files.getPosixFilePermissions(e.toPath()).equals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
                && dir.list().length == 2, "... the enforced file private too, no temporary file left");
        rc = run(home, enf);
        check(rc == 0 && dir.list().length == 2 && e.isFile(), "run again: the same two files");
        // a link where the enforced file goes is replaced, never written through
        e.delete();
        File target = new File(home, "elsewhere");
        Files.write(target.toPath(), "keep".getBytes(StandardCharsets.US_ASCII));
        Files.createSymbolicLink(e.toPath(), target.toPath());
        rc = run(home, enf);
        check(rc == 0 && !Files.isSymbolicLink(e.toPath()) && e.isFile() && new String(Files.readAllBytes(target.toPath()), StandardCharsets.US_ASCII).equals("keep"),
                "a link at the enforced file: replaced by the file, its target untouched");
        rc = run(home, open);
        check(rc == 0 && !e.exists() && new String(Files.readAllBytes(k.toPath()), StandardCharsets.US_ASCII).equals(key) && dir.list().length == 1,
                "the rollback command removes the enforced file and keeps the key");
        rc = run(home, LocalKey.shareCommand(key));
        check(rc == 0 && !e.exists(), "the plain command doesn't make the enforced file");
        run(home, enf);
        rc = run(home, LocalKey.shareCommand(key));
        check(rc == 0 && e.isFile(), "... nor remove one that is there (a reinstalled app keeps Termux enforced)");
        if (!"root".equals(System.getProperty("user.name"))) {
            for (File f : dir.listFiles()) f.delete();
            k.mkdir(); // the key's place is a folder nobody may write: its move fails
            k.setWritable(false, false);
            rc = run(home, enf);
            String[] left = dir.list();
            java.util.Arrays.sort(left);
            check(rc != 0 && java.util.Arrays.equals(left, new String[] {"enforced", "key"}) && k.list().length == 0,
                    "a key move that fails: the command fails, no temporary file is left, the enforced file came first (" + java.util.Arrays.toString(left) + ")");
            k.setWritable(true, false);
            k.delete();
        }
        for (File f : dir.listFiles()) f.delete();
        dir.delete();
        target.delete();
        home.delete();
        // the share uses the mode the state says
        Mem m = new Mem();
        LocalKey lk = make(m, 1);
        Rec rec = new Rec();
        lk.share(rec);
        m.m.put("local_enforce_kid", "00000000");
        lk.share(rec);
        check(rec.cmds.equals(List.of(LocalKey.shareCommand(lk.current(), LocalKey.Mode.KEEP), LocalKey.shareCommand(lk.current(), LocalKey.Mode.ENFORCED))),
                "share: the key alone in the window, with the enforced file once step 1 ran");
    }


    static int bootNo = 40;
    static LocalKey makeBoot(Mem m, long version) { return new LocalKey(m, () -> now, () -> up, () -> bootNo, version); }

    static void bootLooks() {
        long day = 24 * 3_600_000L, hour = 3_600_000L;
        LocalKey.Facts held = new LocalKey.Facts(true, "held", "1700000000", STAMP, false);
        Rec rec = new Rec();
        // ... with the hourly look while the window is open: about an hour a day is lost, the cap after about 15 days
        Mem b = new Mem();
        LocalKey kb = makeBoot(b, 5);
        kb.current();
        bootNo = 100; up = 30_000;
        kb.tick(held, rec);
        check(kb.lookAgainMs(true) == LocalKey.LOOK_EVERY_MS && LocalKey.LOOK_EVERY_MS == hour, "while the window is open: look again within an hour");
        check(kb.lookAgainMs(false) == -1, "... but not while the phone isn't set up (no look counts then)");
        long real = 0;
        int boots = 0;
        while (kb.rawAccepted() && boots < 60) {
            for (int h = 1; h <= 23; h++) { up = 30_000 + h * hour; kb.tick(held, rec); } // the hourly looks of one day
            real += day;
            boots++; bootNo++; up = 30_000; // shut down 30 s after the last look... and the next boot
            kb.tick(held, rec);
        }
        check(!kb.rawAccepted() && boots >= 14 && boots <= 16, "nightly reboots with hourly looks: the cap after 14 to 16 days (" + boots + ")");
        check(kb.lookAgainMs(true) == -1, "... and no more looks once the window is closed");
        check(makeBoot(new Mem(), 5).lookAgainMs(true) == -1, "a window not started: no look kept");
        // never early: whatever the boot count and the time since boot say, nothing counts more than the real time
        Mem c = new Mem();
        LocalKey kc = makeBoot(c, 5);
        kc.current();
        bootNo = 7; up = 1_000;
        kc.tick(held, rec);
        long lastUp = up, counted = 0;
        java.util.Random rnd = new java.util.Random(7);
        long realSince = 0;
        for (int i = 0; i < 2000 && kc.rawAccepted(); i++) {
            long step = 1 + rnd.nextInt(3 * 3_600_000);
            realSince += step;
            if (rnd.nextInt(5) == 0) { bootNo += rnd.nextInt(3) == 0 ? 0 : 1; up = rnd.nextInt((int) Math.min(step, Integer.MAX_VALUE)); } // a reboot within the step (the count sometimes unreadable or stuck)
            else up = lastUp + step;
            lastUp = up;
            if (rnd.nextInt(7) == 0) now += (rnd.nextBoolean() ? 1 : -1) * rnd.nextInt(Integer.MAX_VALUE); // the wall clock jumps
            kc.tick(held, rec);
            counted = c.getLong("local_window_ms");
            if (counted > realSince) break;
        }
        check(counted <= realSince, "random reboots, stuck boot counts and wall-clock jumps: the count never passes the real time (" + counted + " <= " + realSince + ")");
        // the wall clock plays no part: in the past at boot, far forward, set back
        Mem d = new Mem();
        LocalKey kd = makeBoot(d, 5);
        kd.current();
        bootNo = 3; up = 10_000;
        long wall = now;
        now = wall - 3 * 365 * day; // the clock far in the past at boot
        kd.tick(held, rec);
        now = wall + 365 * day; // jumped far forward
        up = 20_000;
        kd.tick(held, rec);
        now = wall - day; // set back
        up = 30_000;
        kd.tick(held, rec);
        check(d.getLong("local_window_ms") == 20_000 && kd.rawAccepted(), "a clock in the past at boot, far forward, set back: only the 20 s of real time count");
        now = wall;
        // no boot count at all (unreadable): reboots are still seen by the time since boot
        Mem e = new Mem();
        LocalKey ke = makeBoot(e, 5);
        ke.current();
        bootNo = -1; up = 5 * hour;
        ke.tick(held, rec);
        up = 6 * hour;
        ke.tick(held, rec);
        up = 60_000; // a reboot
        ke.tick(held, rec);
        check(e.getLong("local_window_ms") == hour + 60_000 && e.getLong("local_window_boot") == -1, "no boot count: an hour, then a reboot's minute");
        // a damaged saved value never brings the cap early
        Mem f = new Mem();
        LocalKey kf = makeBoot(f, 5);
        kf.current();
        bootNo = 9; up = 1_000;
        kf.tick(held, rec);
        f.m.put("local_window_ms", LocalKey.CAP_MS * 3);
        up = 2_000;
        kf.tick(held, rec);
        check(kf.rawAccepted() && f.getLong("local_window_ms") == 0, "a damaged length above the cap: the window starts again, no switch");
        f.m.put("local_window_ms", "x");
        up = 3_000;
        kf.tick(held, rec);
        check(kf.rawAccepted() && f.getLong("local_window_ms") == 1_000, "a damaged length that isn't a number counts as 0");
        bootNo = 40;
    }

    static void legacySaves() {
        Mem m = new Mem();
        LocalKey k = makeUp(m, 5);
        k.current();
        LocalKey.Facts held = new LocalKey.Facts(true, "held", "1700000000", STAMP, false);
        Rec rec = new Rec();
        long u = up;
        k.tick(held, rec);
        up = u + LocalKey.CAP_MS;
        k.tick(held, rec);
        int before = m.saves;
        long t0 = now;
        for (int i = 0; i < 100; i++) { now += 1_000; k.legacySeen(rec); }
        int legacySaves = m.saves - before;
        check(legacySaves <= 2 + 2 + 3, "a raw key reported 100 times in 100 s: the last one is saved at most once a minute, plus the rotation (" + legacySaves + " saves)");
        check(m.getLong("local_legacy_seen_at") >= t0 + 1_000 && m.getLong("local_legacy_seen_at") <= now, "... what is on disk is one of them");
        now += 60_000;
        k.legacySeen(rec);
        check(m.getLong("local_legacy_seen_at") == now, "a minute later it is saved again");
    }


    static void tickerHeard() {
        LocalKey.Facts ok = ready();
        Mem m = new Mem();
        LocalKey k = make(m, 5);
        k.current();
        k.scriptsCopied(true);
        k.confirm(LocalAuth.kid(k.current()));
        Rec rec = new Rec();
        check(k.tick(ok, rec).rotated == null, "the cron ticker not heard since the plugin run: the window stays open");
        k.tickerSeen(false);
        check(k.tick(ok, rec).rotated == null, "a raw ticker event (an older ticker): still open");
        k.tickerSeen(true);
        k.tickerSeen(false);
        check(k.tick(ok, rec).rotated == null, "a signed ticker event, then a raw one (the old ticker still runs): still open");
        int saves = m.saves;
        k.tickerSeen(false);
        check(m.saves == saves, "the same again: nothing saved");
        k.tickerSeen(true);
        k.scriptsCopied(true);
        k.confirm(LocalAuth.kid(k.current()));
        check(k.tick(ok, rec).rotated == null, "a new plugin run clears it: the ticker must be heard again after it");
        k.tickerSeen(true);
        check("enforce".equals(k.tick(ok, rec).rotated), "a signed ticker event after it: step 1 runs");
    }


    static void damagedSeen() {
        LocalKey.Facts held = new LocalKey.Facts(true, "held", "1700000000", STAMP, false);
        Mem m = new Mem();
        LocalKey k = makeBoot(m, 5);
        k.current();
        bootNo = 3; up = 1_000;
        k.tick(held, new Rec());
        m.m.remove("local_window_seen");
        up = 10 * 24 * 3_600_000L;
        k.tick(held, new Rec());
        check(m.getLong("local_window_ms") == 0 && m.getLong("local_window_seen") == up, "a tick with local_window_seen missing: adds nothing (not 10 days), counts from now");
        up += 60_000;
        k.tick(held, new Rec());
        check(m.getLong("local_window_ms") == 60_000, "... then counts the real time again");
        bootNo = 40;
    }

    static int run(File home, String cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("sh", "-c", cmd);
        pb.environment().put("HOME", home.getAbsolutePath());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        p.getInputStream().readAllBytes();
        return p.waitFor();
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -Xmx96m -cp "$T/out" com.omarqaterge.hermesmobile.LocalKeyTest
