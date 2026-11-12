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
  "$T/src/com/omarqaterge/hermesmobile/"
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

        // the raw key while ENFORCE is false
        check(!LocalKey.ENFORCE, "ENFORCE is false in this version");
        Mem e = new Mem();
        e.m.put("local_enforced", true);
        check(make(e, 1).rawAccepted() && make(new Mem(), 1).rawAccepted(), "while ENFORCE is false the raw key is accepted, local_enforced or not");

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
        String hintWhy = "";
        Mem h = new Mem();
        h.failNext = 2;
        try { make(h, 1).hint(); } catch (LocalKey.NotSaved x) { hintWhy = "not saved"; }
        check("not saved".equals(hintWhy), "the hello hint of an unsaved key: NotSaved too (a client then sends nothing)");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
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
