#!/bin/bash
# Tests the app's record of chats that asked to read phone data (android/.../PhoneDataChats.java) with a plain JDK: ids only,
# never evicted (at the cap the overflow flag is set), "Allow more chats" and Forget, the plugin's taint op (adds ids only),
# kept across a re-created store, invalid entries ignored. Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/PhoneDataChats.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/PhoneDataChatsTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.*;
public class PhoneDataChatsTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static String rep(String s, int n) { StringBuilder b = new StringBuilder(); for (int i = 0; i < n; i++) b.append(s); return b.toString(); }
    static class Mem implements PhoneDataChats.Store {
        String text; int saves;
        public String load() { return text; }
        public void save(String t) { text = t; saves++; }
    }
    static void fill(PhoneDataChats c, int n, String prefix) { for (int i = 0; i < n; i++) c.record(prefix + i, null); }
    public static void main(String[] a) {
        Mem m = new Mem();
        PhoneDataChats c = new PhoneDataChats(m);
        check(!c.contains("chat-1") && c.size() == 0, "empty at first");
        c.record("chat-1", null);
        check(c.contains("chat-1") && !c.contains("chat-2"), "a recorded session is known, another is not");
        c.record("chat-2", Arrays.asList("parent-a", "grand-b"));
        check(c.contains("parent-a") && c.contains("grand-b") && c.contains("chat-2"), "the chats list is recorded with the session");
        PhoneDataChats again = new PhoneDataChats(m);
        check(again.contains("chat-1") && again.contains("grand-b"), "survives re-creation (a restart)");
        // invalid entries are ignored, valid ones in the same list still count
        List<Object> mixed = new ArrayList<>(Arrays.asList(null, 5, "", rep("x", 129), "bad\nline", "tab\tid", "good-1", true, new ArrayList<>(), "ninth"));
        c.record("chat-3", mixed);
        check(c.contains("good-1") && c.contains("chat-3") && c.contains("ninth") && c.size() == 7, "invalid entries are ignored; the valid ones stay");
        check(!c.contains("") && !c.contains(null) && !c.contains(rep("x", 129)) && !c.contains("bad\nline"), "invalid ids are never known");
        c.record("", mixed); c.record(null, "not a list"); c.record(7, 8);
        check(c.size() == 7, "an invalid session or a non-list chats changes nothing and throws nothing");
        check(!m.text.contains("bad") && !m.text.contains("tab"), "nothing invalid reached the stored text");
        // up to 16 in the list, and at most 17 new ids per request
        PhoneDataChats d = new PhoneDataChats(new Mem());
        List<Object> twenty = new ArrayList<>();
        for (int i = 0; i < 20; i++) twenty.add("anc-" + i);
        d.record("s", twenty);
        check(d.contains("anc-15") && !d.contains("anc-16") && !d.contains("anc-19") && d.size() == 17, "only the first 16 entries of the list count (17 new ids with the session)");
        d.record(rep("y", 128), null);
        check(d.contains(rep("y", 128)), "a 128-character id is accepted");

        // ── never evicted: at the cap the flag is set and every id stays ──
        check(PhoneDataChats.START_CAP == 2000 && PhoneDataChats.STEP == 2000 && PhoneDataChats.MAX_CAP == 20000, "the cap starts at 2000, grows by 2000 and stops at 20000");
        Mem big = new Mem();
        PhoneDataChats e = new PhoneDataChats(big);
        e.record("real-chat", null);
        check(e.cap() == 2000, "a fresh record has the start cap");
        fill(e, 1999, "flood-");
        check(e.size() == 2000 && !e.overflowed(), "exactly at the cap: not flagged yet");
        e.record("one-more", null);
        check(e.overflowed(), "the first id past the cap sets the overflow flag");
        check(e.contains("real-chat") && e.contains("flood-0") && e.contains("flood-1998"), "no id was evicted");
        check(e.size() == 2001 && e.contains("one-more"), "the id that came after the cap is kept too");
        check(e.contains("never-seen-chat"), "with the flag set every valid chat counts as tainted (fail closed)");
        check(!e.contains("") && !e.contains(null), "an invalid id is still never known");
        PhoneDataChats e2 = new PhoneDataChats(big);
        check(e2.overflowed() && e2.contains("another") && e2.cap() == 2000 && e2.size() == 2001, "the flag, the cap and the ids survive a restart");
        check(e.any(), "any() is true once something was recorded");
        // a flood of reads with fake ids (each 17 new) never costs a real chat
        for (int i = 0; i < 50; i++) { List<Object> l = new ArrayList<>(); for (int k = 0; k < 16; k++) l.add("fk-" + i + "-" + k); e.record("fs-" + i, l); }
        check(e.contains("real-chat") && e.contains("flood-0") && e.size() == 2001 + 50 * 17, "a flood only adds ids; the real chats are still there");

        // ── Allow more chats ──
        int before = e.size();
        check(e.allowMore() && e.cap() == 4000, "Allow more chats raises the cap by 2000");
        check(!e.overflowed() && e.size() == before && e.contains("real-chat") && e.contains("flood-0") && e.contains("fk-49-15"), "the flag clears and nothing is lost");
        check(!e.contains("never-seen-chat"), "an unknown chat is not tainted any more");
        check(!new PhoneDataChats(big).overflowed() && new PhoneDataChats(big).cap() == 4000 && new PhoneDataChats(big).size() == before, "and that survives a restart");
        // the record is still over the new cap: the flag stays on
        PhoneDataChats h = new PhoneDataChats(new Mem());
        for (int i = 0; i < 2100; i++) h.record("h-" + i, null);
        check(h.overflowed() && h.size() == 2100, "2100 ids: flagged");
        for (int i = 2100; i < 4100; i++) h.record("h-" + i, null);
        check(h.size() == 4100 && h.allowMore() && h.cap() == 4000 && h.overflowed(), "raised to 4000 but 4100 ids are kept: the flag stays until the cap covers them");
        check(h.allowMore() && h.cap() == 6000 && !h.overflowed() && h.size() == 4100, "raised again: the flag clears, all 4100 ids stay");
        // the maximum
        PhoneDataChats mx = new PhoneDataChats(new Mem());
        int n = 0;
        while (mx.cap() < PhoneDataChats.MAX_CAP) { check(mx.allowMore(), "allowMore step " + (++n)); }
        check(mx.cap() == 20000 && !mx.allowMore() && mx.cap() == 20000, "the cap stops at 20000");
        PhoneDataChats hard = new PhoneDataChats(new Mem());
        for (int i = 0; i < 20010; i++) hard.record("z-" + i, null);
        check(hard.size() == 20000 && hard.overflowed() && hard.contains("z-0") && hard.contains("z-19999") && hard.contains("anything"), "past 20000 ids no more are kept and the flag stays on");
        check(hard.cap() == 2000, "(the cap itself only moves when the user allows more)");
        // an old stored cap above the maximum, or junk, is clamped
        Mem junk = new Mem();
        junk.text = "v3 ok 99999999\nj-1";
        check(new PhoneDataChats(junk).cap() == 20000 && new PhoneDataChats(junk).contains("j-1"), "a stored cap is clamped to the maximum");
        junk.text = "v3 ok banana\nj-1";
        check(new PhoneDataChats(junk).cap() == 2000, "a stored cap that is not a number falls back to the start cap");
        StringBuilder many = new StringBuilder("v3 ok 2000");
        for (int i = 0; i < 2500; i++) many.append("\nq-").append(i);
        junk.text = many.toString();
        PhoneDataChats lo = new PhoneDataChats(junk);
        check(lo.overflowed() && lo.size() == 2500 && lo.contains("q-0"), "a record bigger than its cap loads flagged with every id kept");

        // ── Forget ──
        e.forgetAll();
        check(!e.overflowed() && e.size() == 0 && !e.contains("real-chat") && !e.any(), "Forget clears the flag and the ids");
        check(!new PhoneDataChats(big).contains("real-chat") && !new PhoneDataChats(big).overflowed(), "and stays cleared after a restart");

        // ── the plugin's taint op: ids only, only adds ──
        PhoneDataChats t = new PhoneDataChats(new Mem());
        t.record("keep-1", Arrays.asList("keep-2"));
        check(t.taint(Arrays.asList("new-a", "new-b")) && t.contains("new-a") && t.contains("new-b"), "taint adds the ids");
        check(t.contains("keep-1") && t.contains("keep-2") && t.size() == 4, "and removes nothing");
        check(t.taint(Arrays.asList("new-a")) && t.size() == 4, "a known id again changes nothing");
        check(!t.overflowed() && t.cap() == 2000, "it changes no other state");
        check(!t.taint(null) && !t.taint("a string") && !t.taint(5) && !t.taint(new ArrayList<>()), "a body that is not a list, or an empty list, is refused");
        check(!t.taint(Arrays.asList(null, 5, "", rep("x", 129), "bad\nline", true)) && t.size() == 4, "a list with no valid id is refused and adds nothing");
        check(t.taint(Arrays.asList(5, "ok-after-junk")) && t.contains("ok-after-junk"), "junk entries are skipped, a valid one counts");
        List<Object> thirtyTwo = new ArrayList<>();
        for (int i = 0; i < 32; i++) thirtyTwo.add("tt-" + i);
        check(t.taint(thirtyTwo) && t.contains("tt-15") && !t.contains("tt-16") && !t.contains("tt-31"), "only the first 16 entries count");
        check(t.taint(Arrays.asList(rep("w", 128))) && t.contains(rep("w", 128)) && !t.taint(Arrays.asList(rep("w", 129))), "128 characters is the longest id");
        Mem tm = new Mem();
        PhoneDataChats t2 = new PhoneDataChats(tm);
        check(t2.taint(Arrays.asList("t-1")) && new PhoneDataChats(tm).contains("t-1"), "a tainted id survives a restart");
        PhoneDataChats t3 = new PhoneDataChats(new Mem());
        fill(t3, 2000, "tf-");
        check(t3.taint(Arrays.asList("over")) && t3.overflowed() && t3.contains("tf-0") && t3.contains("over"), "taint at the cap sets the flag like a read and evicts nothing");

        // ── what is stored: ids only ──
        Mem store = new Mem();
        PhoneDataChats s = new PhoneDataChats(store);
        s.record("id-1", Arrays.asList("id-2"));
        String[] lines = store.text.split("\n");
        boolean idsOnly = lines[0].matches("v3 (ok|overflow) [0-9]+") && lines.length == 3 && lines[1].equals("id-1") && lines[2].equals("id-2");
        check(idsOnly, "the stored text holds a header and ids only (no times, no data)");
        // an older record (ids and times, v2) still loads
        Mem old = new Mem();
        old.text = "v2 ok\nold-a\t12345\nold-b\t99";
        PhoneDataChats lg = new PhoneDataChats(old);
        check(lg.contains("old-a") && lg.contains("old-b") && lg.size() == 2 && !lg.overflowed() && lg.cap() == 2000, "a v2 record (ids with times) still loads");
        old.text = "v2 overflow\nold-a";
        check(new PhoneDataChats(old).overflowed(), "a v2 overflow flag still loads");
        old.text = "old-a\nold-b";
        check(new PhoneDataChats(old).contains("old-b"), "a record from the first version (ids only) still loads");
        // a store that throws
        PhoneDataChats f = new PhoneDataChats(new PhoneDataChats.Store() {
            public String load() { throw new RuntimeException("x"); }
            public void save(String t) { throw new RuntimeException("y"); }
        });
        f.record("k", null);
        check(f.contains("k"), "a failing store still remembers in memory");
        // writes stay cheap: a known id, a read or a page question never writes
        Mem q = new Mem();
        PhoneDataChats g = new PhoneDataChats(q);
        g.record("same", null); g.record("same", null); g.record("same", null);
        g.contains("same"); g.contains("same"); g.taint(Arrays.asList("same"));
        check(q.saves == 1, "a known id and the page's questions do not write again");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.PhoneDataChatsTest
