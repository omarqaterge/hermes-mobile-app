#!/bin/bash
# Tests which approval / question the status chip waits on (android/.../PendingAsk.java) with a plain JDK: two chats
# waiting at once, a clear for one of them, an answer sent, the deadline. The "old rule" cases run a model of the
# previous single-slot, match-on-kind bookkeeping (HermesService used a bare field) and show its faults. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/PendingAsk.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/PendingAskTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class PendingAskTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    /** The rule before PendingAsk: one slot per kind; an arrival overwrites; a clear matches on the kind only. */
    static final class OldSlot {
        String approval;
        void arrived(String session) { approval = session; }
        void cleared(String kind, String session) { if ("approval".equals(kind) && approval != null) approval = null; }
    }
    static String who(PendingAsk<String> p, String kind) { PendingAsk.Entry<String> e = p.shown(kind); return e == null ? null : e.payload; }
    public static void main(String[] a) {
        // The faults, on the old rule.
        OldSlot o = new OldSlot();
        o.arrived("A"); o.arrived("B");
        check("B".equals(o.approval), "old rule: B's approval overwrote A's (A is no longer on the chip)");
        o.cleared("approval", "A");
        check(o.approval == null, "old rule: a clear for chat A also dropped chat B's pending approval");
        // The same, with PendingAsk.
        PendingAsk<String> p = new PendingAsk<>();
        p.arrived("approval", "A", "r1", "A1", 1000);
        p.arrived("approval", "B", "r2", "B2", 2000);
        check(p.count("approval") == 2 && "A1".equals(who(p, "approval")), "two chats waiting: both kept, the oldest is shown");
        check(p.cleared("approval", "A") && "B2".equals(who(p, "approval")) && p.count("approval") == 1, "a clear for A leaves B's approval pending and shown");
        check(!p.cleared("approval", "A"), "a second clear for A changes nothing");
        p.arrived("approval", "B", "r3", "B3", 3000);
        check(p.count("approval") == 2 && "B2".equals(who(p, "approval")), "a second approval from one chat is kept after the first");
        p.arrived("approval", "B", "r3", "B3x", 3500);
        check(p.count("approval") == 2, "the same chat and request id again replaces its entry");
        check(p.answered("approval", "B", "r2") && "B3x".equals(who(p, "approval")), "an answer for one request leaves the chat's other request");
        check(p.answered("approval", "B", "") && p.count("approval") == 0, "an answer with no request id drops the chat's approvals");
        // Questions.
        p.arrived("ask", "A", "", "qA", 5000);
        p.arrived("ask", "B", "", "qB", 5000);
        check(p.count("ask") == 2 && "qA".equals(who(p, "ask")), "two chats asking: both kept");
        p.arrived("ask", "A", "", "qA2", 6000);
        check(p.count("ask") == 2 && "qA2".equals(who(p, "ask")), "a chat's new question replaces its old one");
        check(p.cleared("ask", "A") && "qB".equals(who(p, "ask")), "a question clear for A leaves B's");
        check(p.answered("ask", "B", null) && p.shown("ask") == null, "answering B's question empties the list");
        // Kinds are separate; an old plugin's clear without a chat falls back to the whole kind.
        p.arrived("approval", "A", "r1", "A1", 1000);
        p.arrived("approval", "B", "r2", "B2", 1000);
        p.arrived("ask", "A", "", "qA", 1000);
        check(p.cleared("approval", "") && p.count("approval") == 0 && p.count("ask") == 1, "a clear naming no chat drops every approval and no question");
        check(p.cleared("ask", null) && p.count("ask") == 0, "same for a question, with null");
        // Deadlines.
        p.arrived("approval", "A", "r1", "A1", 1000);
        p.arrived("approval", "B", "r2", "B2", 9000);
        check(!p.expire(3999, 3000), "within the grace period nothing expires");
        check(p.expire(4001, 3000) && p.count("approval") == 1 && "B2".equals(who(p, "approval")), "past deadline + grace only the late one is dropped");
        p.arrived("ask", "C", "", "C1", 5000);
        p.arrived("ask", "D", "", "D1", 6000);
        java.util.List<PendingAsk.Entry<String>> gone = p.expired(5500, 0);
        check(gone.size() == 1 && "C1".equals(gone.get(0).payload) && "ask".equals(gone.get(0).kind) && "C".equals(gone.get(0).session)
                && p.count("ask") == 1 && "D1".equals(who(p, "ask")), "expired says which one it dropped (the island panel buzzes for that question)");
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -Xlint:unchecked -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.PendingAskTest
