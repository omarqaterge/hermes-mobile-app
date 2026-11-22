#!/bin/bash
# Tests what the island panel shows (android/.../IslandState.java) with a plain JDK: the state picked in the chip's
# order, the chat line above the headline, the question as shown (choices trimmed, five at most, kept whole), and the
# question's fate: sending until the service records the outcome of the panel's own answer, then sent or failed; open
# while the same question waits; closed when it vanished with no outcome of ours (answered elsewhere), when the chat
# asked a newer question, or for an outcome older than the answer. The on-screen words are pinned to design 5.2.
# Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/IslandState.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/IslandStateTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.Arrays;
public class IslandStateTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static IslandState.Ask ask(String s, String q, String... c) { return new IslandState.Ask(s, "Chat", q, Arrays.asList(c), true); }
    static IslandState st(IslandState.Ask a, IslandState.Outcome o) { return new IslandState(a == null ? IslandState.NONE : IslandState.QUESTION, a, o); }
    public static void main(String[] x) {
        check(IslandState.PERMISSION.equals(IslandState.pick(true, true, true, true)), "a permission request comes first");
        check(IslandState.QUESTION.equals(IslandState.pick(false, true, true, true)), "then a question");
        check(IslandState.PROGRESS.equals(IslandState.pick(false, false, true, false)), "then progress");
        check(IslandState.DONE.equals(IslandState.pick(false, false, false, true)), "then done");
        check(IslandState.NONE.equals(IslandState.pick(false, false, false, false)), "nothing: none");

        check("Hermux".equals(IslandState.chatLine("", null)), "a chat with no title says Hermux");
        check("Trip".equals(IslandState.chatLine("Trip", "default")), "the default bot is not named");
        check("Trip · work".equals(IslandState.chatLine("Trip", "work")), "another bot is added as · name");

        IslandState.Ask q = new IslandState.Ask(null, "", "  ", Arrays.asList(" a ", "", null, "b", "c", "d", "e", "f"), true);
        check(q.session.isEmpty() && "Hermux".equals(q.chat), "no chat id and no title: empty id, Hermux");
        check("Hermux has a question".equals(q.question), "an empty question reads Hermux has a question");
        check(q.choices.equals(Arrays.asList("a", "b", "c", "d", "e")), "choices trimmed, empty ones dropped, five at most");
        String longChoice = "x".repeat(400);
        check(ask("A", "Q", longChoice).choices.get(0).length() == 400, "a long choice is kept whole (a tap answers with it)");
        try { q.choices.add("g"); check(false, "the choices can't change"); } catch (UnsupportedOperationException e) { check(true, "the choices can't change"); }

        IslandState.Ask a = ask("A", "Which folder?", "Trips", "2026");
        check(a.same(ask("A", "Which folder?", "Trips", "2026")), "the same question is the same");
        check(!a.same(ask("A", "Which file?", "Trips", "2026")), "a chat's newer question is another one");
        check(!a.same(ask("B", "Which folder?", "Trips", "2026")), "another chat's question is another one");
        check(new IslandState(IslandState.QUESTION, new IslandState.Ask("A", "", "Q", null, false), null).askToShow() == null,
                "a batch of questions is not shown in the panel");

        check(IslandState.OPEN.equals(IslandState.askFate(a, false, 0, st(a, null))), "open while the same question waits");
        check(IslandState.CLOSED.equals(IslandState.askFate(a, false, 0, st(null, null))), "gone with no answer of ours: closed (answered elsewhere)");
        check(IslandState.CLOSED.equals(IslandState.askFate(a, false, 0, st(ask("A", "Which file?"), null))), "replaced by a newer question: closed");
        check(IslandState.CLOSED.equals(IslandState.askFate(null, false, 0, st(a, null))), "nothing shown: closed");
        long sent = 1000;
        check(IslandState.SENDING.equals(IslandState.askFate(a, true, sent, st(null, null))), "our answer sent, no outcome yet: sending (not closed)");
        IslandState.Outcome old = new IslandState.Outcome("ask", "A", "", "sent", "", 999);
        check(IslandState.SENDING.equals(IslandState.askFate(a, true, sent, st(null, old))), "an outcome older than our answer is not ours");
        IslandState.Outcome other = new IslandState.Outcome("ask", "B", "", "sent", "", 1500);
        check(IslandState.SENDING.equals(IslandState.askFate(a, true, sent, st(null, other))), "another chat's outcome is not ours");
        IslandState.Outcome appr = new IslandState.Outcome("approval", "A", "r1", "allowed", "", 1500);
        check(IslandState.SENDING.equals(IslandState.askFate(a, true, sent, st(null, appr))), "an approval's outcome is not ours");
        IslandState.Outcome ok = new IslandState.Outcome("ask", "A", "", "sent", "", 1000);
        check(IslandState.Outcome.SENT.equals(IslandState.askFate(a, true, sent, st(null, ok))), "our answer reached Hermes: sent");
        IslandState.Outcome bad = new IslandState.Outcome("ask", "A", "", "failed", "page not ready", 1200);
        check(IslandState.Outcome.FAILED.equals(IslandState.askFate(a, true, sent, st(null, bad))), "our answer did not: failed");
        IslandState.Outcome nul = new IslandState.Outcome(null, null, null, null, null, 5);
        check(nul.kind.isEmpty() && nul.session.isEmpty() && nul.result.isEmpty(), "an outcome never holds null");

        check("Hermux asks".equals(IslandState.ASKS) && "This question is closed".equals(IslandState.ASK_CLOSED)
                && "Type your answer".equals(IslandState.TYPE_HINT) && "Open chat".equals(IslandState.OPEN_CHAT),
                "the Question words, as in design 5.2");
        check("Couldn't send your answer. Open the chat; your text is kept.".equals(IslandState.ASK_FAILED), "the failure line, as in design 5.2");
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -Xlint:unchecked -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.IslandStateTest
