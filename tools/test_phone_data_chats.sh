#!/bin/bash
# Tests the app's record of chats that asked to read phone data (android/.../PhoneDataChats.java) with a plain JDK: ids only,
# bounded (the oldest dropped), kept across a re-created store, invalid entries ignored. Needs javac 11+. Also run by tools/java-check.sh.
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
        // no eviction under 30 days: a flood fills the record, the real chat stays and the overflow flag is set
        long[] now = {1_000_000_000_000L};
        Mem big = new Mem();
        PhoneDataChats e = new PhoneDataChats(big, () -> now[0]);
        e.record("real-chat", null);
        for (int i = 0; i < 400; i++) { now[0] += 1000; e.record("flood-" + i, Arrays.asList("fa-" + i, "fb-" + i, "fc-" + i, "fd-" + i, "fe-" + i, "ff-" + i, "fg-" + i, "fh-" + i)); }
        check(e.size() == PhoneDataChats.MAX, "no more than MAX ids are kept");
        check(e.overflowed(), "a flood past MAX sets the overflow flag");
        check(e.contains("real-chat") && e.contains("flood-0"), "no id younger than 30 days was evicted");
        check(e.contains("never-seen-chat"), "with the flag set every valid chat counts as tainted (fail closed)");
        check(!e.contains("") && !e.contains(null), "an invalid id is still never known");
        check(new PhoneDataChats(big, () -> now[0]).overflowed() && new PhoneDataChats(big, () -> now[0]).contains("another"), "the flag survives a restart");
        check(e.any(), "any() is true once something was recorded");
        e.forgetAll();
        check(!e.overflowed() && e.size() == 0 && !e.contains("real-chat") && !e.any(), "forgetAll clears the flag and the ids");
        check(!new PhoneDataChats(big, () -> now[0]).contains("real-chat") && !new PhoneDataChats(big, () -> now[0]).overflowed(), "and stays cleared after a restart");
        // eviction only of ids older than 30 days, oldest first
        long[] t2 = {2_000_000_000_000L};
        Mem m2 = new Mem();
        PhoneDataChats h = new PhoneDataChats(m2, () -> t2[0]);
        for (int i = 0; i < PhoneDataChats.MAX; i++) h.record("old-" + i, null);
        t2[0] += PhoneDataChats.KEEP_MS - 1000;
        h.record("old-0", null); // seen again: young
        h.record("new-a", null); // full and nothing older than 30 days yet
        check(h.overflowed() && h.contains("zzz-missing"), "full of recent ids: the new one sets overflow");
        h.forgetAll();
        for (int i = 0; i < PhoneDataChats.MAX; i++) h.record("old-" + i, null);
        t2[0] += PhoneDataChats.KEEP_MS + 1000;
        h.record("keep-me", null);
        check(!h.overflowed() && h.size() == PhoneDataChats.MAX && h.contains("keep-me") && !h.contains("old-0"), "past 30 days the oldest is evicted for a new id, no flag");
        // age refresh by the page asking
        long[] t3 = {3_000_000_000_000L};
        PhoneDataChats k = new PhoneDataChats(new Mem(), () -> t3[0]);
        for (int i = 0; i < PhoneDataChats.MAX; i++) k.record("c-" + i, null);
        t3[0] += PhoneDataChats.KEEP_MS - 1000;
        check(k.contains("c-0"), "c-0 is asked about at day 30 minus a second");
        t3[0] += 2000;
        k.record("fresh", null);
        check(k.contains("c-0") && !k.contains("c-1") && !k.overflowed(), "the id the page asked about is kept; the older untouched one is evicted");
        // a restart keeps the times: an old record without times loads as seen now
        Mem legacy = new Mem();
        legacy.text = "old-a\nold-b";
        PhoneDataChats lg = new PhoneDataChats(legacy);
        check(lg.contains("old-a") && lg.contains("old-b") && lg.size() == 2 && !lg.overflowed(), "a record from the first version (ids only) still loads");
        boolean idsOnly = true;
        for (String l : big.text.split("\n")) {
            if (l.startsWith("v2 ")) continue;
            String[] p = l.split("\t");
            if (p.length != 2 || !p[1].matches("[0-9]+") || p[0].isEmpty()) idsOnly = false;
        }
        check(idsOnly, "the stored text holds ids and times only");
        // a store that throws
        PhoneDataChats f = new PhoneDataChats(new PhoneDataChats.Store() {
            public String load() { throw new RuntimeException("x"); }
            public void save(String t) { throw new RuntimeException("y"); }
        });
        f.record("k", null);
        check(f.contains("k"), "a failing store still remembers in memory");
        // no repeated writes
        Mem q = new Mem();
        PhoneDataChats g = new PhoneDataChats(q);
        g.record("same", null); g.record("same", null); g.record("same", null);
        check(q.saves == 1, "the same newest id does not write again");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.PhoneDataChatsTest
