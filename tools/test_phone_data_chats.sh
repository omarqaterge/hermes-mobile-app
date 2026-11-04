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
        check(c.contains("good-1") && c.contains("chat-3") && c.size() == 6, "invalid entries are ignored; the valid one stays");
        check(!c.contains("") && !c.contains(null) && !c.contains(rep("x", 129)) && !c.contains("bad\nline"), "invalid ids are never known");
        c.record("", mixed); c.record(null, "not a list"); c.record(7, 8);
        check(c.size() == 6, "an invalid session or a non-list chats changes nothing and throws nothing");
        check(!m.text.contains("bad") && !m.text.contains("tab"), "nothing invalid reached the stored text");
        // up to 8 in the list
        PhoneDataChats d = new PhoneDataChats(new Mem());
        List<Object> ten = new ArrayList<>();
        for (int i = 0; i < 10; i++) ten.add("anc-" + i);
        d.record("s", ten);
        check(d.contains("anc-7") && !d.contains("anc-8") && !d.contains("anc-9"), "only the first 8 entries of the list count");
        d.record(rep("y", 128), null);
        check(d.contains(rep("y", 128)), "a 128-character id is accepted");
        // bound
        Mem big = new Mem();
        PhoneDataChats e = new PhoneDataChats(big);
        for (int i = 0; i < PhoneDataChats.MAX + 50; i++) e.record("id-" + i, null);
        check(e.size() == PhoneDataChats.MAX, "no more than MAX ids are kept");
        check(!e.contains("id-0") && !e.contains("id-49") && e.contains("id-50") && e.contains("id-" + (PhoneDataChats.MAX + 49)), "the oldest are dropped, the newest kept");
        check(new PhoneDataChats(big).size() == PhoneDataChats.MAX, "the bound holds after a restart");
        e.record("id-50", null);
        e.record("fresh", null);
        check(e.contains("id-50") && !e.contains("id-51"), "a chat that reads again counts as newest");
        boolean idsOnly = true;
        for (String l : big.text.split("\n")) if (!(l.startsWith("id-") || l.equals("fresh"))) idsOnly = false;
        check(idsOnly, "the stored text holds ids only");
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
