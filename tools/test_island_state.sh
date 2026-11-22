#!/bin/bash
# Tests what the island panel shows (android/.../IslandState.java) with a plain JDK: the state picked in the chip's
# order, the chat line above the headline, the question as shown (choices trimmed, five at most, kept whole), and the
# question's fate: sending until the service records the outcome of the panel's own answer, then sent or failed; open
# while the same question waits; closed when it vanished with no outcome of ours (answered elsewhere), when the chat
# asked a newer question, or for an outcome older than the answer. The on-screen words are pinned to design 5.2.
# The Permission state (design 5.1): a request as shown (capitalised words, no command for phone data, no Allow this
# session for phone data, the headline), which request the panel shows (the one tapped while it waits, else the
# oldest), how many more wait, the next one after an answer, the timer's seconds and when it speaks, and the
# request's fate: sending until the outcome for this very request, then allowed, denied or failed; open while it
# waits; expired at its deadline (or vanished within the slack); gone (answered elsewhere) earlier. The Progress and
# Done states (design 5.3, 5.4): a chat at work as shown, the other busy chats, the words and numbers, and the turn's
# and the stop's fates; what a request arriving, or the next one after an answer, changes the panel to. Needs javac 11+.
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
        IslandState gone = new IslandState(IslandState.NONE, null, null, new IslandState.Expired("A", "  Which folder? ", 7));
        check(IslandState.EXPIRED.equals(IslandState.askFate(a, false, 0, gone)), "ran out of time: expired (the reject buzz), not just closed");
        check(IslandState.CLOSED.equals(IslandState.askFate(a, false, 0, new IslandState(IslandState.NONE, null, null,
                new IslandState.Expired("A", "Which file?", 7)))), "another question of the chat expired: this one was answered elsewhere");
        check(IslandState.CLOSED.equals(IslandState.askFate(a, false, 0, new IslandState(IslandState.NONE, null, null,
                new IslandState.Expired("B", "Which folder?", 7)))), "another chat's question expired: closed, quietly");
        check(IslandState.OPEN.equals(IslandState.askFate(a, false, 0, new IslandState(IslandState.QUESTION, a, null,
                new IslandState.Expired("A", "Which folder?", 7)))), "an expiry record never closes a question that still waits");
        check(new IslandState.Expired("A", "", 1).is(ask("A", "")), "an empty question that expired is the one shown as Hermux has a question");
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
        // ── the Permission state (design 5.1) ──
        IslandState.Approval r1 = new IslandState.Approval("A", "r1", "Trip", "delete old files", "rm -rf /tmp/x", "", true, false, false, 60_000, 60_000);
        check("Delete old files".equals(r1.what) && "rm -rf /tmp/x".equals(r1.command), "the plain-words line has its first letter capitalised; the command as sent");
        check("Run a command?".equals(r1.headline()) && r1.allowable() && r1.allowSession, "a command: Run a command?, Allow and Allow this session");
        IslandState.Approval pd = new IslandState.Approval("A", "r2", "", "Read your contacts named Sam", "phone_data", "", true, true, false, 60_000, 60_000);
        check("Let Hermux read your phone?".equals(pd.headline()) && !pd.allowable() && !pd.allowSession && pd.command.isEmpty(),
                "a phone-data read: its own headline, no Allow from the panel, no Allow this session, no command block");
        IslandState.Approval un = new IslandState.Approval("A", "r3", "", "x", "", "", true, false, true, 60_000, 60_000);
        check("Unreadable phone data request".equals(un.headline()) && !un.allowable() && un.phoneData, "an unreadable request is phone data with no Allow");
        IslandState.Approval bare = new IslandState.Approval(null, null, null, "", "", "", false, false, false, 1, 0);
        check("A command".equals(bare.what) && "Hermux".equals(bare.chat) && bare.session.isEmpty() && bare.total >= 1000,
                "no words at all: A command, Hermux, never null, a total of at least a second");
        check("Ls".equals(new IslandState.Approval("A", "r", "", "", "", "ls", false, false, false, 1, 1).what), "no what and no command: the body, capitalised");
        IslandState.Approval r1b = new IslandState.Approval("A", "r1", "Trip", "other words", "", "", true, false, false, 9, 9);
        IslandState.Approval b1 = new IslandState.Approval("B", "r1", "", "w", "c", "", true, false, false, 60_000, 60_000);
        check(r1.same(r1b) && !r1.same(b1) && !r1.same(pd), "the same request is the same chat and request id");
        check(r1.left(30_000) == 0.5 && r1.left(70_000) == 0 && r1.left(-5) == 1, "the share of time left, from the real deadline, clamped");
        IslandState many = new IslandState(IslandState.PERMISSION, null, null, null, Arrays.asList(r1, pd, b1));
        check(many.approvalToShow("A", "r2") == pd, "the request tapped is shown while it waits");
        check(many.approvalToShow("A", "gone") == r1 && many.approvalToShow("", "") == r1, "otherwise the oldest");
        check(many.othersWaiting(r1) == 2 && many.othersWaiting(pd) == 2, "the others waiting are counted");
        check(many.next(r1) == pd && new IslandState(IslandState.PERMISSION, null, null, null, Arrays.asList(r1)).next(r1) == null,
                "after an answer: the next one waiting, or none");
        check("".equals(IslandState.moreWaiting(0)) && "1 more waiting".equals(IslandState.moreWaiting(1)) && "3 more waiting".equals(IslandState.moreWaiting(3)),
                "N more waiting, as in design 5.1");
        java.util.List<IslandState.Approval> lots = new java.util.ArrayList<>();
        for (int i = 0; i < 40; i++) lots.add(new IslandState.Approval("A", "x" + i, "", "w", "c", "", true, false, false, 1, 1));
        check(new IslandState(IslandState.PERMISSION, null, null, null, lots).approvals.size() == IslandState.MAX_APPROVALS, "a snapshot carries at most MAX_APPROVALS requests");
        check(IslandState.seconds(60_000) == 60 && IslandState.seconds(59_001) == 60 && IslandState.seconds(59_000) == 59
                && IslandState.seconds(1) == 1 && IslandState.seconds(0) == 0 && IslandState.seconds(-50) == 0, "the seconds shown: rounded up, 0 at the end");
        check(IslandState.speaks(31, 30) && IslandState.speaks(11, 10) && IslandState.speaks(6, 5) && !IslandState.speaks(30, 29)
                && !IslandState.speaks(20, 19) && IslandState.speaks(33, 29) && !IslandState.speaks(5, 6), "spoken at 30, 10 and 5 seconds left, once each");
        check("30 seconds left".equals(IslandState.secondsLeft(30)) && "1 second left".equals(IslandState.secondsLeft(1)), "the spoken words");
        IslandState waits = new IslandState(IslandState.PERMISSION, null, null, null, Arrays.asList(r1));
        IslandState none = new IslandState(IslandState.NONE, null, null, null, null);
        check(IslandState.OPEN.equals(IslandState.approvalFate(r1, false, 0, waits, 10_000)), "open while it waits and time is left");
        check(IslandState.EXPIRED.equals(IslandState.approvalFate(r1, false, 0, waits, 60_000)), "at its deadline: expired");
        check(IslandState.GONE.equals(IslandState.approvalFate(r1, false, 0, none, 10_000)), "vanished early with no answer of ours: answered elsewhere");
        check(IslandState.EXPIRED.equals(IslandState.approvalFate(r1, false, 0, none, 59_000)), "vanished within the slack of its deadline: expired");
        check(IslandState.GONE.equals(IslandState.approvalFate(null, false, 0, waits, 0)), "nothing shown: gone");
        IslandState.Outcome okA = new IslandState.Outcome("approval", "A", "r1", "allowed", "", 2000);
        check(IslandState.SENDING.equals(IslandState.approvalFate(r1, true, 1000, none, 1500)), "sent, no outcome yet: sending (not gone)");
        check(IslandState.Outcome.ALLOWED.equals(IslandState.approvalFate(r1, true, 1000, new IslandState(IslandState.NONE, null, okA, null, null), 2100)), "our Allow reached Hermes: allowed");
        check(IslandState.Outcome.DENIED.equals(IslandState.approvalFate(r1, true, 1000, new IslandState(IslandState.NONE, null,
                new IslandState.Outcome("approval", "A", "r1", "denied", "", 2000), null, null), 2100)), "our Deny reached Hermes: denied");
        check(IslandState.Outcome.FAILED.equals(IslandState.approvalFate(r1, true, 1000, new IslandState(IslandState.NONE, null,
                new IslandState.Outcome("approval", "A", "r1", "failed", "HTTP 500", 2000), null, null), 2100)), "it did not: failed");
        check(IslandState.SENDING.equals(IslandState.approvalFate(r1, true, 1000, new IslandState(IslandState.NONE, null,
                new IslandState.Outcome("approval", "A", "r9", "allowed", "", 2000), null, null), 2100)), "another request's outcome in the same chat is not ours");
        check(IslandState.SENDING.equals(IslandState.approvalFate(r1, true, 3000, new IslandState(IslandState.NONE, null, okA, null, null), 3100)), "an outcome older than our answer is not ours");
        check(IslandState.SENDING.equals(IslandState.approvalFate(r1, true, 1000, new IslandState(IslandState.NONE, null,
                new IslandState.Outcome("ask", "A", "r1", "sent", "", 2000), null, null), 2100)), "a question's outcome is not ours");
        check("Run a command?".equals(IslandState.RUN_COMMAND) && "Let Hermux read your phone?".equals(IslandState.READ_PHONE)
                && "Unreadable phone data request".equals(IslandState.UNREADABLE) && "Deny".equals(IslandState.DENY)
                && "Allow once".equals(IslandState.ALLOW_ONCE) && "Allow this session".equals(IslandState.ALLOW_SESSION)
                && "Review in Hermux".equals(IslandState.REVIEW) && "Sending\u2026".equals(IslandState.SENDING_LABEL)
                && "Allowed".equals(IslandState.ALLOWED) && "Allowed for this session".equals(IslandState.ALLOWED_SESSION)
                && "Denied".equals(IslandState.DENIED) && "This request expired".equals(IslandState.REQUEST_EXPIRED)
                && "Answered in the app".equals(IslandState.ANSWERED_ELSEWHERE), "the Permission words, as in design 5.1");
        check("Couldn't send your answer. Try again, or open the chat.".equals(IslandState.APPROVAL_FAILED), "the Permission failure line, as in design 5.1");

        // ── the Progress and Done states (design 5.3, 5.4) ──
        IslandState.Progress w1 = new IslandState.Progress("A", "Trip", "Trip", "Running `ls`", 1000, 7, "ddapp", "Draft it", 2, 5, false, "", 0);
        IslandState.Progress w2 = new IslandState.Progress("B", "Files", "Files", "Reading `notes.md`", 0, 0, "", "", 0, 0, false, "", 0);
        IslandState.Progress w3 = new IslandState.Progress("C", "", "", "", 0, 0, "", "", 0, 0, false, "", 0);
        IslandState.Progress w4 = new IslandState.Progress("D", "Mail", "Mail", "Thinking", 0, 0, "", "", 0, 0, false, "", 0);
        check(w1.hasTasks() && !w2.hasTasks() && "Hermux".equals(w3.chat) && "Working\u2026".equals(w3.headline),
                "a chat at work: the task list when there is one; Hermux and Working... when nothing was said");
        check(!new IslandState.Progress("A", "", "", "x", 0, 0, "ddp", "", 2, 0, false, "", 0).hasTasks()
                && "dap".equals(new IslandState.Progress("A", "", "", "x", 0, 0, "d?a!p", "", 1, 3, false, "", 0).states),
                "a list with no tasks counted is none; letters other than d, a, p, x are dropped");
        IslandState busy = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(w1, w2, w3, w4), 6, null);
        check(busy.progressFor("") == w1 && busy.progressFor("B") == w2 && busy.progressFor("Z") == null,
                "the chat shown: the one tapped, the chip's when none is named, none when it isn't at work");
        check(busy.atWork("C") && !busy.atWork("") && !busy.atWork(null) && !busy.atWork("Z"), "at work: exactly that chat, never an empty id");
        check(busy.otherLines(w1).equals(Arrays.asList("Files: Reading notes.md", "Another chat: Working\u2026")), "the other busy chats: two lines at most, backticks dropped, Another chat with no title");
        check(busy.moreChats(w1) == 3 && "+3 more chats".equals(IslandState.moreChats(3)) && "+1 more chat".equals(IslandState.moreChats(1))
                && "".equals(IslandState.moreChats(0)), "then +N more chats for the rest (the plugin counts those it doesn't name)");
        check(busy.otherLines(w2).get(0).startsWith("Trip: Running ls") && busy.moreChats(w2) == 3, "another chat shown: the chip's chat is one of the others");
        check("2 of 5 tasks".equals(IslandState.tasks(2, 5)) && "7 steps so far".equals(IslandState.stepsSoFar(7))
                && "1 step so far".equals(IslandState.stepsSoFar(1)) && "".equals(IslandState.stepsSoFar(0)), "the task count and the steps, as in design 5.3");
        check("0:07".equals(IslandState.clock(7)) && "1:24".equals(IslandState.clock(84)) && "12:05".equals(IslandState.clock(725))
                && "1:02:03".equals(IslandState.clock(3723)) && "0:00".equals(IslandState.clock(-4)), "the running time: m:ss, then h:mm:ss");
        check("9 steps \u00B7 1m 31s".equals(IslandState.doneStats(9, 91)) && "1 step".equals(IslandState.doneStats(1, 0))
                && "45s".equals(IslandState.doneStats(0, 45)) && "".equals(IslandState.doneStats(0, 0)), "the Done line: 9 steps · 1m 31s, a missing part left out");
        check("2m 14s".equals(IslandState.took(134)) && "1h 3m".equals(IslandState.took(3780)), "a turn's time, as the Done card says it");
        check("Using Maps".equals(IslandState.using("Maps")) && "Using an app".equals(IslandState.using(" ")), "the app in use: Using <app>");
        check("Stop".equals(IslandState.STOP) && "Stopping\u2026".equals(IslandState.STOPPING) && "Stopped".equals(IslandState.STOPPED)
                && "Couldn't stop Hermux. Open the chat to stop it.".equals(IslandState.STOP_FAILED) && "Watch".equals(IslandState.WATCH)
                && "Done".equals(IslandState.DONE_TITLE), "the Progress and Done words, as in design 5.3 and 5.4");
        IslandState.Done dA = new IslandState.Done("A", "Trip", " The plan is ready. ", 9, 91, 5000);
        IslandState ended = new IslandState(IslandState.DONE, null, null, null, null, null, 0, Arrays.asList(dA));
        check("The plan is ready.".equals(dA.reply) && ended.doneFor("A", 1000) == dA && ended.doneFor("A", 6000) == null && ended.doneFor("B", 0) == null,
                "a reply is this turn's when it came after the turn started, for this chat");
        IslandState.Done dB = new IslandState.Done("B", "Other chat", "B's reply.", 2, 10, 5200);
        IslandState.Done dA2 = new IslandState.Done("A", "Plan the trip", "Older.", 1, 5, 4000);
        IslandState twoChats = new IslandState(IslandState.DONE, null, null, null, null, null, 0, Arrays.asList(dB, dA, dA2));
        check(twoChats.doneFor("A", 1000) == dA && twoChats.doneFor("B", 5000) == dB && twoChats.done == dB
                && twoChats.dones.size() == 2 && twoChats.doneOf("") == dB && twoChats.doneOf("A") == dA && twoChats.doneFor("", 0) == null,
                "two chats finishing one after the other each keep their Done (one per chat, the newest first)");
        java.util.List<IslandState.Done> manyDone = new java.util.ArrayList<>();
        for (int k = 0; k < 12; k++) manyDone.add(new IslandState.Done("S" + k, "", "", 0, 0, 1000 + k));
        check(new IslandState(IslandState.NONE, null, null, null, null, null, 0, manyDone).dones.size() == IslandState.MAX_DONE,
                "at most MAX_DONE replies are kept");
        check(IslandState.WORKING.equals(IslandState.turnFate("A", 1000, 0, busy, 9000)), "the chat still at work: working");
        check(IslandState.DONE.equals(IslandState.turnFate("A", 1000, 0, ended, 9000)), "its reply came: done");
        IslandState withReplyStillBusy = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(w1), 1, Arrays.asList(dA));
        check(IslandState.DONE.equals(IslandState.turnFate("A", 1000, 0, withReplyStillBusy, 9000)), "the reply before the status says it ended: done all the same");
        check(IslandState.WORKING.equals(IslandState.turnFate("A", 6000, 0, withReplyStillBusy, 9000)), "an older turn's reply doesn't end this one");
        IslandState quiet = new IslandState(IslandState.NONE, null, null, null, null, null, 0, null);
        check(IslandState.ENDING.equals(IslandState.turnFate("A", 1000, 0, quiet, 9000))
                && IslandState.ENDING.equals(IslandState.turnFate("A", 1000, 9000, quiet, 9000 + IslandState.DONE_GRACE_MS - 1)),
                "it stopped with no reply yet: the panel waits a moment for it");
        check(IslandState.ENDED.equals(IslandState.turnFate("A", 1000, 9000, quiet, 9000 + IslandState.DONE_GRACE_MS)), "then nothing to show (stopped elsewhere, or failed): ended, it closes");
        check(IslandState.SENDING.equals(IslandState.stopFate("A", 1000, busy)), "a stop on its way while the chat works: Stopping");
        check(IslandState.Outcome.STOPPED.equals(IslandState.stopFate("A", 1000, quiet)), "the turn over after a stop: Stopped");
        IslandState stopBad = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "", "failed", "HTTP 500", 2000), null, null, Arrays.asList(w1), 1, null);
        check(IslandState.Outcome.FAILED.equals(IslandState.stopFate("A", 1000, stopBad)), "it couldn't be stopped: failed");
        IslandState stopBad2 = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "", "failed", "HTTP 500", 2000), null, null, Arrays.asList(w1, w2), 2, null);
        check(IslandState.SENDING.equals(IslandState.stopFate("A", 3000, stopBad)) && IslandState.SENDING.equals(IslandState.stopFate("B", 1000, stopBad2)),
                "an older stop's failure, or another chat's, is not this one's");
        IslandState stopOk = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "", "stopped", "", 2000), null, null, Arrays.asList(w1), 1, null);
        check(IslandState.SENDING.equals(IslandState.stopFate("A", 1000, stopOk)), "the stop was taken but the turn still runs: still Stopping");
        IslandState stop404AlreadyOver = new IslandState(IslandState.NONE, null, new IslandState.Outcome("stop", "A", "", "failed", "it isn't running in Hermux", 2000), null, null, Arrays.asList(w2), 1, null);
        check(IslandState.Outcome.STOPPED.equals(IslandState.stopFate("A", 1000, stop404AlreadyOver)), "an overlapping stop returning 404/FAILED after the turn is already over still reads Stopped, not FAILED");
        // The 15 s wait for a stop: the failure line only when nothing came of it (review of 78239d3: the card's Stop
        // sent at 1000 succeeded at 2000, the panel opened at 5000 and the turn takes over 15 s to wind down).
        IslandState.Progress wStop = new IslandState.Progress("A", "Trip", "Trip", "x", 500, 3, "", "", 0, 0, true, 1000, false, "", 0);
        IslandState.Progress wStopOk = new IslandState.Progress("A", "Trip", "Trip", "x", 500, 3, "", "", 0, 0, true, 1000, true, "", 0);
        IslandState otherStopped = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(w2, wStopOk), 2, null);
        check(!IslandState.stopUnheard("A", 1000, otherStopped) && !IslandState.newStop(otherStopped.progressFor("A"), 1000),
                "a stopped chat in lastOthers keeps its stopAt and stopOk, so it never trips the 15 s failure or re-enters Stopping");
        check(wStop.stopAt == 1000 && !wStop.stopOk && wStopOk.stopOk
                && new IslandState.Progress("A", "", "", "x", 0, 0, "", "", 0, 0, false, 1000, true, "", 0).stopAt == 0,
                "a chat at work carries when its stop was sent and whether it was accepted (nothing without a stop)");
        IslandState okBeforeOpen = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "", "stopped", "", 2000), null, null, Arrays.asList(wStop), 1, null);
        check(!IslandState.stopUnheard("A", 1000, okBeforeOpen) && IslandState.SENDING.equals(IslandState.stopFate("A", 1000, okBeforeOpen)),
                "a stop that succeeded before the panel opened, with the turn still winding down: Stopping, never the failure");
        IslandState okOverwritten = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("approval", "A", "r1", "allowed", "", 3000), null, null, Arrays.asList(wStopOk), 1, null);
        check(!IslandState.stopUnheard("A", 1000, okOverwritten), "accepted, its outcome since replaced by another answer's: still no failure");
        IslandState nothing = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(wStop), 1, null);
        IslandState olderOk = new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "", "stopped", "", 900), null, null, Arrays.asList(wStop), 1, null);
        check(IslandState.stopUnheard("A", 1000, nothing) && IslandState.stopUnheard("A", 1000, olderOk) && IslandState.stopUnheard("A", 1000, null),
                "nothing heard of this stop in 15 s (or only an older stop's outcome): the failure line");
        check(!IslandState.stopUnheard("A", 1000, quiet), "the turn is over: Stopped, not a failure");
        check(IslandState.newStop(wStop, 0) && IslandState.newStop(wStop, 999) && !IslandState.newStop(wStop, 1000) && !IslandState.newStop(w1, 0),
                "a stop the panel already took in (one that failed, still held by the service) doesn't start Stopping again");

        // ── Per-turn StopBook: event-order table covering all 8 security-review scenarios ──
        // Steps run in order on a fresh StopBook (timeout = 15_000 ms), asserting the exact state after each scenario.
        final class StopTable {
            void run(String name, Runnable body) {
                int before = fails;
                body.run();
                check(fails == before, "StopBook table [" + name + "]");
            }
            IslandState.LiveTurn lt(String s, String tid, long since) { return new IslandState.LiveTurn(s, tid, since); }
        }
        StopTable tbl = new StopTable();
        // 1. Two quick turns in one chat (lastSession): back-to-back turn clears stop; late 200 and failure ignored.
        tbl.run("quick_turns_lastSession", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100);
            check(t1 != null && b.view("A", "p1:1", 200).stopping(), "t1 starts SENDING");
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:2", 1000)), 300); // Turn 2 even in the same ms (only turn_id differs)
            check(!b.view("A", "p1:1", 300).stopping() && IslandState.StopView.IDLE.equals(b.view("A", "p1:2", 300).state),
                    "turn 2 in lastSession clears turn 1 stop even with equal since");
            check(!b.onStop200("A", "p1:1", "p1:1", t1.attempt, 350)
                    && !b.onStopFailed("A", "p1:1", t1.attempt, "HTTP 500", 1350, 350),
                    "late 200 and late failure from turn 1 are ignored");
            IslandState.StopTicket t2 = b.beginStop("A", "p1:2", 1400, 400);
            check(t2 != null && b.view("A", "p1:2", 400).stopping(), "Stop is immediately usable on turn 2");
        });
        // 2. Two quick turns in one chat (lastOthers): turn_id separates them; other chat unaffected.
        tbl.run("quick_turns_lastOthers", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("B", "p1:0", 900), tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100);
            check(t1 != null && b.view("A", "p1:1", 150).stopping() && !b.view("B", "p1:0", 150).stopping(),
                    "stopping chat A in others leaves chat B unaffected");
            b.onStatus("p1", true, Arrays.asList(tbl.lt("B", "p1:0", 900), tbl.lt("A", "p1:2", 1000)), 300);
            check(IslandState.StopView.IDLE.equals(b.view("A", "p1:2", 300).state),
                    "back-to-back turn 2 in lastOthers clears turn 1 stop even with equal since");
            check(!b.onStop200("A", "p1:1", "p1:1", t1.attempt, 350)
                    && !b.onStopFailed("A", "p1:1", t1.attempt, "HTTP 404", 1350, 350),
                    "late 200/failure from earlier turn in others ignored");
            IslandState.StopTicket t2 = b.beginStop("A", "p1:2", 1400, 400);
            check(t2 != null && b.onStop200("A", "p1:2", "p1:2", t2.attempt, 450) && b.view("A", "p1:2", 450).accepted(),
                    "turn 2 in others stops and accepts cleanly");
        });
        // 3. Late 200 and late failure from earlier turn while turn 2 is also being stopped.
        tbl.run("late_200_and_failure_from_earlier_turn", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100);
            check(b.onDoneFlash("p1", "A", "p1:1"), "done flash for turn 1 ends turn 1 stop");
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:2", 2000)), 200);
            IslandState.StopTicket t2 = b.beginStop("A", "p1:2", 2100, 250);
            check(!b.onStop200("A", "p1:1", "p1:1", t1.attempt, 300) && !b.view("A", "p1:2", 300).accepted(),
                    "turn 1 late 200 cannot mark turn 2 accepted");
            check(!b.onStopFailed("A", "p1:1", t1.attempt, "HTTP 500", 2300, 300) && b.view("A", "p1:2", 300).stopping(),
                    "turn 1 late failure cannot fail turn 2");
            check(b.onStop200("A", "p1:2", "p1:2", t2.attempt, 350) && b.view("A", "p1:2", 350).accepted(),
                    "turn 2 own 200 marks turn 2 accepted");
        });
        // 4. Overlapping stops, retry after failure, racing 200 on same turn, two chats stopping at once.
        tbl.run("overlapping_stops_and_retries", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000), tbl.lt("B", "p1:2", 1050)), 100);
            IslandState.StopTicket a1 = b.beginStop("A", "p1:1", 1000, 100);
            check(a1 != null && b.beginStop("A", "p1:1", 1100, 200) == null, "overlapping stop while SENDING is skipped");
            IslandState.StopTicket tb1 = b.beginStop("B", "p1:2", 1100, 200);
            check(tb1 != null && b.view("A", "p1:1", 200).stopping() && b.view("B", "p1:2", 200).stopping(),
                    "stopping chat B does not overwrite chat A's stop");
            check(b.onStopFailed("A", "p1:1", a1.attempt, "HTTP 500", 1200, 300) && b.view("A", "p1:1", 300).failed()
                    && !b.view("A", "p1:1", 300).stopping(), "real failure moves to FAILED and restores Stop");
            IslandState.StopTicket a2 = b.beginStop("A", "p1:1", 1300, 400);
            check(a2 != null && a2.attempt > a1.attempt && b.view("A", "p1:1", 400).stopping(), "retry after failure starts new attempt");
            check(!b.onStopFailed("A", "p1:1", a1.attempt, "stale", 1350, 450) && b.view("A", "p1:1", 450).stopping(),
                    "stale failure from attempt 1 cannot fail retry attempt 2");
            check(b.onStop200("A", "p1:1", "p1:1", a1.attempt, 500) && b.view("A", "p1:1", 500).accepted(),
                    "matching turn_id 200 from earlier attempt of the same turn is accepted");
            check(b.beginStop("A", "p1:1", 1500, 600) == null, "overlapping stop while ACCEPTED is skipped");
            check(!b.onStopFailed("A", "p1:1", a2.attempt, "HTTP 404", 1600, 650) && b.view("A", "p1:1", 650).accepted(),
                    "failure from racing attempt 2 after ACCEPTED is ignored");
        });
        // 5. Timeout then late failure with no retry: chip & panel both leave Stopping, reopened panel sees no phantom 15 s.
        tbl.run("timeout_then_late_failure_no_retry", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 1000);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 5000, 1000);
            IslandState.StopView mid = b.view("A", "p1:1", 6000);
            check(mid.stopping() && mid.remainingMs == 10_000 && b.nextTimeoutDelayMs(6000) == 10_000,
                    "panel reopened 5 s in sees only 10 s remaining, not a fresh 15 s");
            IslandState.StopView atLimit = b.view("A", "p1:1", 16_000);
            check(atLimit.failed() && !atLimit.stopping() && atLimit.remainingMs == 0,
                    "at 15 s view derives FAILED immediately (chip restores Stop, reopened panel sees no phantom wait)");
            java.util.List<IslandState.StopTimeout> tos = b.expireTimeouts(20_000, 16_000);
            check(tos.size() == 1 && "A".equals(tos.get(0).session) && "p1:1".equals(tos.get(0).turnId)
                    && b.nextTimeoutDelayMs(16_000) == -1, "expireTimeouts reports the timed-out turn once and stops timer");
            check(b.expireTimeouts(21_000, 17_000).isEmpty(), "expireTimeouts does not fire a second time");
            check(!b.onStopFailed("A", "p1:1", t1.attempt, "socket timeout", 22_000, 18_000)
                    && b.view("A", "p1:1", 18_000).failed() && !b.view("A", "p1:1", 18_000).stopping(),
                    "late failure after timeout with no retry is a no-op and leaves Stop usable");
            IslandState.StopTicket t2 = b.beginStop("A", "p1:1", 23_000, 19_000);
            check(t2 != null && b.view("A", "p1:1", 19_000).stopping() && b.view("A", "p1:1", 19_000).remainingMs == 15_000,
                    "after timeout, tapping Stop again always starts a fresh retry");
        });
        // 6. Stop tapped before a new turn's first throttled status (and stale tap arriving after new turn's status).
        tbl.run("stop_before_new_turn_first_status", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100); // tapped while turn 1 was still on screen
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:2", 1800)), 200); // turn 2's first throttled status
            check(IslandState.StopView.IDLE.equals(b.view("A", "p1:2", 200).state),
                    "turn 2's first status drops turn 1's stop instead of binding it to turn 2");
            check(!b.onStopFailed("A", "p1:1", t1.attempt, "HTTP 409", 1900, 250)
                    && !b.onStop200("A", "p1:1", "p1:1", t1.attempt, 250),
                    "turn 1's 409/200 after turn 2 starts is dropped");
            check(b.beginStop("A", "p1:1", 2000, 300) == null,
                    "a stale Stop intent carrying turn 1's turn_id is refused once turn 2 is live");
            b.onStatus("p1", false, null, 400);
            check(b.beginStop("A", "p1:2", 2100, 400) == null && b.beginStop("A", "", 2100, 400) == null,
                    "no stop is started when no turn is active");
        });
        // 7. Events from another chat or another Hermes process, and delayed done flashes without/wrong turn_id.
        tbl.run("other_chat_and_other_process", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100);
            b.onStatus("p2", false, null, 200); // second Hermes process goes idle
            b.onStatus("p2", true, Arrays.asList(tbl.lt("C", "p2:1", 1100)), 250); // second process works on chat C
            b.onStatus("p2", false, null, 300);
            check(b.view("A", "p1:1", 300).stopping(), "another process's working/idle status never ends p1's stop");
            check(!b.onDoneFlash("p2", "A", "p1:1"), "another process's done flash never ends p1's stop");
            check(!b.onDoneFlash("p1", "B", "p1:9"), "another chat's done flash never ends chat A's stop");
            check(!b.onDoneFlash("p1", "A", "p1:0"), "delayed done flash from an earlier turn never ends p1:1's stop");
            check(!b.onDoneFlash("p1", "A", ""), "delayed done flash with no turn_id never ends an identified turn's stop");
            check(b.view("A", "p1:1", 350).stopping() && b.onStop200("A", "p1:1", "p1:1", t1.attempt, 350)
                    && b.view("A", "p1:1", 350).accepted(), "stop survived all unrelated events and accepts matching 200");
            check(b.onDoneFlash("p1", "A", "p1:1") && IslandState.StopView.IDLE.equals(b.view("A", "p1:1", 400).state),
                    "matching process + chat + turn_id done flash ends the stop");
            // Expire-all drops everything.
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:2", 2000)), 500);
            b.beginStop("A", "p1:2", 2000, 500);
            b.onExpireAll();
            check(IslandState.StopView.IDLE.equals(b.view("A", "p1:2", 550).state), "onExpireAll clears all stop state");
        });
        // 8. Missing turn identity: never claim a stop succeeded when unsure.
        tbl.run("missing_turn_identity", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("p1", true, Arrays.asList(tbl.lt("A", "p1:1", 1000)), 100);
            IslandState.StopTicket t1 = b.beginStop("A", "p1:1", 1000, 100);
            check(!b.onStop200("A", "p1:1", "", t1.attempt, 200) && !b.view("A", "p1:1", 200).accepted(),
                    "identified turn rejects a 200 with missing response turn_id");
            check(!b.onStop200("A", "p1:1", "p1:99", t1.attempt, 250) && !b.view("A", "p1:1", 250).accepted(),
                    "identified turn rejects a 200 with mismatched response turn_id");
            check(b.view("A", "p1:1", 15_100).failed(), "unconfirmed stop still times out to FAILED at 15 s");
            // Missing both turn_id and since: never claims ACCEPTED, but still clears when turn ends or times out.
            IslandState.StopBook b2 = new IslandState.StopBook(15_000);
            b2.onStatus("p1", true, Arrays.asList(tbl.lt("A", "", 0)), 100);
            IslandState.StopTicket u1 = b2.beginStop("A", "", 1000, 100);
            check(u1 != null && !b2.onStop200("A", "", "", u1.attempt, 200) && !b2.view("A", "", 200).accepted(),
                    "turn with neither turn_id nor since never claims ACCEPTED on 200");
            check(b2.view("A", "", 15_100).failed(), "and falls back to FAILED at 15 s so Stop stays usable");
        });
        // 9. Older plugin (no proc, no turn_id on status/flash/stop): safe fallback.
        tbl.run("older_plugin_fallback", () -> {
            IslandState.StopBook b = new IslandState.StopBook(15_000);
            b.onStatus("", true, Arrays.asList(tbl.lt("A", "", 1000), tbl.lt("B", "", 0)), 100);
            IslandState.StopTicket tA = b.beginStop("A", "", 1000, 100);
            check(tA != null && b.onStop200("A", "", "", tA.attempt, 200) && b.view("A", "", 200).accepted(),
                    "older plugin lastSession (with since > 0) accepts its own in-flight 200 within timeout");
            b.onStatus("", true, Arrays.asList(tbl.lt("A", "", 2000)), 300); // strictly newer since = turn 2
            check(IslandState.StopView.IDLE.equals(b.view("A", "", 300).state),
                    "older plugin strictly newer since clears turn 1 stop");
            IslandState.StopTicket tA2 = b.beginStop("A", "", 2000, 300);
            check(!b.onStop200("A", "", "", tA.attempt, 350) && !b.view("A", "", 350).accepted(),
                    "older plugin rejects late 200 from earlier attempt");
            check(!b.onStop200("A", "", "", tA2.attempt, 15_300) && b.view("A", "", 15_300).failed(),
                    "older plugin rejects late 200 arriving after 15 s timeout");
            check(b.onDoneFlash("", "A", "") && IslandState.StopView.IDLE.equals(b.view("A", "", 15_400).state),
                    "older plugin done flash with empty turn_id clears legacy stop");
            // Older plugin others (since == 0): never falsely accepts 200 while since is unknown, adopts since on promotion.
            b.onStatus("", true, Arrays.asList(tbl.lt("X", "", 900), tbl.lt("B", "", 0)), 500);
            IslandState.StopTicket tB = b.beginStop("B", "", 3000, 500);
            check(tB != null && !b.onStop200("B", "", "", tB.attempt, 550) && !b.view("B", "", 550).accepted(),
                    "older plugin others (no since, no turn_id) never guesses ACCEPTED");
            b.onStatus("", true, Arrays.asList(tbl.lt("B", "", 950)), 600); // promoted to lastSession
            check(b.view("B", "", 600).stopping() && b.onStop200("B", "", "", tB.attempt, 650) && b.view("B", "", 650).accepted(),
                    "once promoted with since > 0, its in-flight 200 can be accepted");
        });
        // 10. Progress / Done / stopFate / turnFate with explicit turnId.
        IslandState.Progress pT1 = new IslandState.Progress("A", "p1:1", "Trip", "Trip", "Step 1", 1000, 1, "", "", 0, 0,
                new IslandState.StopView(IslandState.StopView.SENDING, 1500, 12_000, 0, ""), "", 0);
        IslandState.Progress pT2 = new IslandState.Progress("A", "p1:2", "Trip", "Trip", "Step 1", 2000, 0, "", "", 0, 0,
                IslandState.StopView.NONE, "", 0);
        IslandState.Progress pT1Fail = new IslandState.Progress("A", "p1:1", "Trip", "Trip", "Step 1", 1000, 1, "", "", 0, 0,
                new IslandState.StopView(IslandState.StopView.FAILED, 1500, 0, 2000, "timed out"), "", 0);
        check(IslandState.sameTurn("p1:1", 1000, pT1) && !IslandState.sameTurn("p1:1", 1000, pT2),
                "sameTurn distinguishes turn 1 from turn 2 by turnId");
        check(IslandState.Outcome.STOPPED.equals(IslandState.stopFate("A", "p1:1", 1000, 1500,
                new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(pT2), 1, null))),
                "stopFate reads STOPPED when turn 2 has already replaced turn 1 in working");
        check(IslandState.SENDING.equals(IslandState.stopFate("A", "p1:1", 1000, 1500,
                new IslandState(IslandState.PROGRESS, null, new IslandState.Outcome("stop", "A", "p1:1", "failed", "old", 1500),
                        null, null, Arrays.asList(pT1), 1, null))),
                "active stopping state on Progress beats a same-ms older FAILED outcome");
        check(IslandState.Outcome.FAILED.equals(IslandState.stopFate("A", "p1:1", 1000, 1500,
                new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(pT1Fail), 1, null))),
                "stopFailed on Progress reports FAILED even if st.outcome was overwritten");
        IslandState.Done dT1 = new IslandState.Done("A", "p1:1", "Trip", "Done 1", 1, 5, 2500);
        IslandState.Done dNoId = new IslandState.Done("A", "", "Trip", "Delayed", 1, 5, 2500);
        IslandState stDone1 = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(pT2), 1, Arrays.asList(dT1));
        IslandState stDoneNoId = new IslandState(IslandState.PROGRESS, null, null, null, null, Arrays.asList(pT2), 1, Arrays.asList(dNoId));
        check(stDone1.doneFor("A", "p1:2", 2000) == null && stDoneNoId.doneFor("A", "p1:2", 2000) == null
                && stDone1.doneFor("A", "p1:1", 1000) == dT1,
                "doneFor ignores an earlier turn's or unidentified done flash when the active turn has a turnId");
        IslandState.Ask qA = ask("A", "Which folder?", "Trips");
        IslandState both = new IslandState(IslandState.PERMISSION, qA, null, null, Arrays.asList(r1, pd));
        IslandState onlyQ = new IslandState(IslandState.QUESTION, qA, null, null, null);
        check(IslandState.PERMISSION.equals(both.arrived()) && IslandState.QUESTION.equals(onlyQ.arrived()) && IslandState.NONE.equals(quiet.arrived()),
                "arriving during Progress or Done: a permission request first, then a question");
        check(IslandState.NONE.equals(new IslandState(IslandState.QUESTION, new IslandState.Ask("A", "", "Q", null, false), null).arrived()),
                "a batch of questions doesn't change the panel");
        check(IslandState.PERMISSION.equals(both.nextAfter(r1, null)) && both.next(r1) == pd, "after an answer: another request waiting");
        check(IslandState.QUESTION.equals(new IslandState(IslandState.PERMISSION, qA, null, null, Arrays.asList(r1)).nextAfter(r1, null)),
                "no other request: the question waiting");
        check(IslandState.NONE.equals(onlyQ.nextAfter(null, qA)) && IslandState.NONE.equals(quiet.nextAfter(r1, qA)),
                "the question just answered, or nothing: it closes");
        check(new IslandState(IslandState.NONE, null, null, null, null).working.isEmpty()
                && new IslandState(IslandState.NONE, null, null, null, null).done == null, "the older snapshots carry no work and no reply");

        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -Xlint:unchecked -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.IslandStateTest

# Two rules of IslandPanel that a plain JDK can't run, checked in its source: content on its way out (a change of
# state) takes no touch, so a tap there can't answer the new question with the old choice (IslandViews.Fit.block,
# swapTo); and a question that ran out of time buzzes "reject" while one answered elsewhere stays quiet.
fails=0
src(){ sed -n "/$1/,/^    }/p" android/src/com/omarqaterge/hermesmobile/$2.java; }
ok(){ if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }
SWAP=$(src 'void swapInner(' IslandPanel)
FIT=$(sed -n '/static final class Fit/,/^    }/p' android/src/com/omarqaterge/hermesmobile/IslandViews.java)
ok 'grep -q "old.block()" <<<"$SWAP"' "a change in place (swapInner) blocks the outgoing content's touches"
ok 'grep -q "if (blocked) return false;" <<<"$FIT" && grep -q "if (holding()) {" <<<"$FIT" && grep -q "SystemClock.uptimeMillis()" <<<"$FIT"' "blocked content, and content on its monotonic hold, pass every touch on"
ok 'grep -q "now.beginHold();" <<<"$SWAP" && grep -q "now.fadeDone();" <<<"$SWAP" && ! grep -q "holdTouches" <<<"$SWAP" && grep -q "FOCUS_BLOCK_DESCENDANTS" <<<"$(sed -n "/void beginHold()/,/^        }/p" <<<"$FIT")" && grep -q "FOCUS_AFTER_DESCENDANTS" <<<"$(sed -n "/void releaseIfDone()/,/^        }/p" <<<"$FIT")"' "a change in place starts a monotonic hold anchored to fade completion and keeps focus off new content until released"
ok 'grep -q "dispatchKeyEvent(KeyEvent e)" <<<"$FIT" && grep -q "consumeHeldKey(heldKeys, e, holding(), this::swallowed)" <<<"$FIT" && src "public boolean dispatchKeyEvent(" IslandPanel | grep -q "IslandViews.consumeHeldKey(heldKeys, e, inner != null && inner.holding()"' "Fit and IslandPanel filter activation keys through HeldKeys set during hold"
GTXT=$(sed -n "/static final class GuardedText/,/^    }/p" android/src/com/omarqaterge/hermesmobile/IslandViews.java)
PILLD=$(sed -n "/static final class Pill/,/void setText/p" android/src/com/omarqaterge/hermesmobile/IslandViews.java)
ok 'grep -q "consumeHeldKey(heldKeys, e, h != null && h.getAsBoolean(), onSwallow)" <<<"$GTXT" && grep -q "consumeHeldKey(heldKeys, e, h != null && h.getAsBoolean(), onSwallow)" <<<"$PILLD" && grep -q "static boolean consumeHeldKey(" android/src/com/omarqaterge/hermesmobile/IslandViews.java && grep -q "isActivationKey(code)" <<<"$(sed -n "/static boolean consumeHeldKey(/,/^    }/p" android/src/com/omarqaterge/hermesmobile/IslandViews.java)"' "Pill and GuardedText filter activation keys through HeldKeys set during Allow hold"
ok 'src "void tap(String c" IslandPermission | grep -q "if (!auto && allowIt)" && src "void tap(String c" IslandPermission | grep -q "holdingAllow()" && src "void choose(" IslandPanel | grep -q "inner.holding()" && src "void sendTyped()" IslandPanel | grep -q "inner.holding()" && src "void tapStop()" IslandProgress | grep -q "p.inner.holding()"' "Allow, Question choices/send and Progress Stop check the hold (blocks TalkBack/accessibility click); Deny and automatic card Allow are not held"
ok 'grep -q "allow.hold = () ->" android/src/com/omarqaterge/hermesmobile/IslandPermission.java && grep -q "textBtn.hold = () ->" android/src/com/omarqaterge/hermesmobile/IslandPermission.java && grep -q "allow.onSwallow =" android/src/com/omarqaterge/hermesmobile/IslandPermission.java && grep -q "textBtn.onSwallow =" android/src/com/omarqaterge/hermesmobile/IslandPermission.java' "Allow once and Allow this session hold touches until the post-fade pause ends and extend when swallowed"
ok 'src "void showFailed()" IslandPermission | grep -q "if (isDeny)" && src "void showFailed()" IslandPermission | grep -q "allowReturning = true;" && src "void showFailed()" IslandPermission | grep -q "other.setEnabled(false);" && src "void showFailed()" IslandPermission | grep -q "other.setEnabled(true);"' "when Deny fails to send, Allow once stays held and disabled until it has faded back in"
ok 'grep -q "leavingDy.put(old, innerDy)" <<<"$SWAP" && src "void applyGeo()" IslandPanel | grep -q "leavingDy.get(c)"' "content leaving mid-way through its fade-in keeps its offset (no 6 dp jump)"
ok 'f=android/src/com/omarqaterge/hermesmobile/IslandPanel.java; [ "$(grep -c "Puts {@code now} in place of the content on screen" $f)" = 1 ] && [ "$(sed -n "/Puts {@code now} in place/,/void swapInner/p" $f | grep -c "/\*\*")" = 1 ]' "swapInner's comment sits on swapInner, once (no comment block above it left over)"
ok 'grep -q "ACTION_CANCEL" <<<"$FIT" && grep -q "FOCUS_BLOCK_DESCENDANTS" <<<"$FIT"' "blocking cancels a touch already on it and takes its focus away"
APPLY=$(src 'void apply(IslandState' IslandPanel)
ok 'grep -q "EXPIRED.equals(fate)) closedElsewhere(true)" <<<"$APPLY" && grep -q "CLOSED.equals(fate)) closedElsewhere(false)" <<<"$APPLY"' "expired closes with the buzz, answered elsewhere without"
ok 'src "void closedElsewhere(boolean" IslandPanel | grep -q "if (expired) haptic(.*REJECT"' "the buzz is the reject pattern"
# The Permission state's rules (IslandPermission): Allow goes only through the fingerprint while it is needed, the
# service checks the grant, a phone-data read is never allowed, Deny never asks, the answer buttons ignore touches
# under another app's window, and the panel stays behind our own prompt (onStop) and forwards its result.
PERM=android/src/com/omarqaterge/hermesmobile/IslandPermission.java
SVC=android/src/com/omarqaterge/hermesmobile/HermesService.java
TAP=$(src 'void tap(String c' IslandPermission)
ok 'grep -q "ApprovalLock.needed(p)" <<<"$TAP" && grep -q "ApprovalLock.askOnce(" <<<"$TAP"' "Allow asks through ApprovalLock.askOnce while the fingerprint is needed"
ok 'grep -q "allowIt && ApprovalLock.needed" <<<"$TAP"' "Deny never asks"
ok 'grep -q "shown.allowable()" <<<"$TAP"' "the panel never offers Allow for phone data"
FROM=$(sed -n '/String approveFromPanel(/,/^    }/p;/private String panelRefusal(/,/^    }/p' "$SVC")
ok 'grep -q "ApprovalLock.takeGrant(grant, ApprovalLock.grantFor(session, request, choice)" <<<"$FROM"' "the service takes the one-use grant for this very request and choice"
ok 'grep -q "phone_data" <<<"$FROM" && grep -q "keyguardLocked" <<<"$FROM" && grep -q "pending.find(" <<<"$FROM"' "the service refuses phone data and a locked phone, and answers only a request still waiting"
ok '[ "$(grep -c "setFilterTouchesWhenObscured(true)" "$PERM")" -ge 2 ]' "the answer buttons ignore touches under another app's window"
STOP=$(src 'protected void onStop()' IslandPanel)
ok 'grep -q "perm.confirming" <<<"$STOP"' "the panel stays behind our own fingerprint or PIN screen"
ok 'src "protected void onActivityResult" IslandPanel | grep -q "ApprovalLock.onResult"' "the screen-lock result reaches ApprovalLock"
ok 'src "protected void onDestroy()" IslandPanel | grep -q "ApprovalLock.activityGone(this)"' "a panel that goes ends its prompt as a cancel"
ok 'src "protected void onDestroy()" IslandPanel | sed -n 2p | grep -q "ApprovalLock.activityGone(this)"' "it ends its prompt before the system's teardown, as MainActivity does"
ok 'grep -q "postDelayed(deadlineRun" <<<"$TAP" && grep -q "asked.deadline <= System.currentTimeMillis()" <<<"$TAP"' "a request runs out while our prompt is up, and a prompt answered after the deadline sends nothing"
ok 'src "void ended()" IslandPermission | grep -q "removeCallbacks(deadlineRun)" && src "void stop()" IslandPermission | grep -q "removeCallbacks(deadlineRun)"' "the deadline check goes with the request"
ok 'src "void openPanelToConfirm(" HermesService | grep -q "SDK_INT < 31) sendBroadcast(new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))"' "before Android 12 the card's Allow closes the shade so the panel and its PIN screen are in front"
ok 'src "protected void onActivityResult" IslandPanel | grep -q "hideSoftInputFromWindow"' "the PIN screen's keyboard does not stay up over the panel"
ok 'src "public void onWindowFocusChanged" IslandPanel | grep -q "perm != null && root != null) root.post(this::hideKeyboard)"' "back from the PIN screen the keyboard is put away again once the panel has its focus (the result comes before the focus)"
ok 'src "void resolve(String c)" IslandPermission | grep -q "errLine" && src "void elsewhere()" IslandPermission | grep -q "errLine.setVisibility(View.GONE)"' "a failure line goes when the answer is sent again or the request is answered elsewhere"
ok 'src "protected void onActivityResult" IslandPanel | grep -q "ApprovalLock.onResult(this, req, result)" && grep -q "ApprovalLock.onResult(this, req, result)" android/src/com/omarqaterge/hermesmobile/MainActivity.java' "both activities hand the screen-lock result over with themselves and its request code"
ok '! grep -rq "ApprovalLock.REQ\b" android/src' "no fixed screen-lock request code is left"
ok '[ "$(grep -c "approvalCode(\"approve\", session, e.optString(\"request_id\"" "$SVC")" = 1 ] && grep -q "approvalCode(\"island:approval\", session, request, choice)" "$SVC" && grep -q "approvalCode(\"phonedata\", session, e.optString(\"request_id\"" "$SVC"' "every approval PendingIntent's code names the request, so two requests of one chat never share one"
ok 'src "void startOpen()" IslandPanel | sed -n "/if (reduced)/,/return;/p" | grep -q "perm.start()"' "with animations off the Permission state still starts (the timer, the card's Allow)"
ok 'grep -q "if (deadline <= System.currentTimeMillis()) return \"expired\"" <<<"$FROM"' "the service refuses every Allow past the request's deadline, fingerprint or not"
ok 'grep -q "allowIt && shown.deadline <= System.currentTimeMillis()" <<<"$TAP"' "the panel offers no Allow past the deadline either"
ok 'src "static String choiceFor(" IslandPanel | grep -q "in.removeExtra(EXTRA_CHOICE)" && src "protected void onNewIntent(" IslandPanel | grep -q "intent.removeExtra(EXTRA_CHOICE)"' "the card's choice is used once: a panel made again doesn't ask by itself"
VIEWS=android/src/com/omarqaterge/hermesmobile/IslandViews.java
PILLF=$(sed -n "/static final class Pill/,/void setText/p" "$VIEWS")
ok 'grep -q "FLAG_WINDOW_IS_PARTIALLY_OBSCURED" "$VIEWS" && grep -q "SDK_INT >= 29" <<<"$(sed -n "/static boolean partlyCovered/,/^    }/p" "$VIEWS")"' "on Android 10+ a guarded button can refuse touches while another app covers part of the window"
ok 'grep -q "s != null && s.getAsBoolean() && partlyCovered(this, e)" <<<"$PILLF" && grep -q "strict.getAsBoolean() && partlyCovered(this, e)" "$VIEWS"' "a button refuses a partly covered window only while its condition holds"
ok 'grep -q "allow.strict = () -> !allowOpensChat && shown != null && shown.allowable() && !ApprovalLock.needed(p);" "$PERM" && grep -q "() -> !textOpensChat && shown != null && shown.allowSession && !ApprovalLock.needed(p))" "$PERM"' "the partly-covered rule holds only on Allow once and Allow this session, and only while the fingerprint is not asked"
ok '! grep -q "deny.strict" "$PERM" && [ "$(grep -c "\.strict = " "$PERM")" = 1 ] && [ "$(grep -c "guardedText(" "$PERM")" = 1 ]' "Deny, Review in Hermux and Open chat never have the partly-covered rule"
ok 'src "IslandViews.Pill pill(" IslandPermission | grep -q "setFilterTouchesWhenObscured(true)" && grep -q "textBtn.setFilterTouchesWhenObscured(true)" "$PERM"' "every answer button still refuses a touch through another app's window"
SEND=$(src 'void send(String c, String grant)' IslandPermission)
ok '[ "$(grep -n "approveFromPanel" <<<"$SEND" | cut -d: -f1)" -lt "$(grep -n "resolve(c)" <<<"$SEND" | cut -d: -f1)" ]' "a request that ran out or went is found before the row turns into Sending"
ok 'src "void startOpen()" IslandPanel | grep -q "withPrevious.contains(row)" && grep -q "p.withPrevious.add(textBtn)" "$PERM" && grep -q "p.rows.add(more)" "$PERM"' "N more waiting is in the opening stagger, and Allow this session arrives with the buttons"
ok 'src "void expire()" IslandPermission | grep -q "fade(row, 1, IslandMotion.EXPIRED_ROW_MS, IslandMotion.OUT"' "the run-out Open chat fades in on out"
ok 'src "void expire()" IslandPermission | grep -q "stopFade(allow)"' "a fade still running from an answer can't hide the run-out Open chat"
ok 'src "void ringTo(" IslandPermission | grep -q "pulseRun.cancel()" && src "void ringTo(" IslandPermission | grep -q "ringRun.cancel()" && src "void pulse()" IslandPermission | grep -q "if (ringRun != null) return"' "the ring's fades replace its pulse and each other"
ok 'sed -n "/void fade(View v, float to, long ms, IslandMotion.Curve curve/,/^    }/p" "$PERM" | grep -q "stopFade(v)"' "a new fade of a view replaces the one still running"
ok 'grep -q "perm.autoChoice = state == null ? choiceFor(in, a) : null;" android/src/com/omarqaterge/hermesmobile/IslandPanel.java' "a panel Android recreated with a saved state never asks for the card's choice again"
ok 'grep -q "\"session\".equals(c), r -> {" <<<"$TAP" && grep -q "session ? ASK_SESSION_TITLE : ASK_ONCE_TITLE" android/src/com/omarqaterge/hermesmobile/ApprovalLock.java && grep -q "ASK_SESSION_TITLE = \"Allow Hermux to run this for this session?\"" android/src/com/omarqaterge/hermesmobile/ApprovalLock.java' "Allow this session's prompt says it is for the whole session"
ok '[ "$(grep -c "credentialCode = codeFor(++codes);" android/src/com/omarqaterge/hermesmobile/ApprovalLock.java)" = 2 ] && ! grep -q "codeFor(g)" android/src/com/omarqaterge/hermesmobile/ApprovalLock.java' "screen-lock codes are counted apart from the prompt number"
ok 'src "void stopFade(View v)" IslandPermission | grep -q "p.stopArriving(v)" && src "void dim(View v)" IslandPanel | grep -q "stopArriving(v)" && src "void stopArriving(View v)" IslandPanel | grep -q "rowIn.remove(v)"' "a fade or a dim stops the row's opening entrance, so the stagger can't undo it"
ok 'src "protected void onStop()" IslandPanel | grep -q "if (behindOurPrompt) ticker.finishAll();"' "behind its own prompt every motion ends where it was going, not halfway"
ok 'sed -n "/void finishAll()/,/^        }/p" "$VIEWS" | grep -q "if (h.dead || !h.ends) continue;" && [ "$(grep -c "h.ends = true;" "$VIEWS")" = 2 ]' "only tweens and springs are ended; the timer and spinners just stop"
ok 'src "void paused()" IslandPermission | grep -q "pulseRun = ringRun = null;" && src "void paused()" IslandPermission | grep -q "fades.clear()"' "a pause keeps no motion handle, so the pulse and later fades play again"
ok 'src "void showFailed()" IslandPermission | grep -q "if (shown.allowable())"' "a failed answer adds Open chat only where the row has no way into the chat"
ok 'src "IslandViews.Fit build(" IslandPermission | grep -q "if (!a.what.isEmpty() || a.command.isEmpty())"' "an empty plain-words line is left out"
ok 'sed -n "/private int\[\] span(Pill p/,/^        }/p" android/src/com/omarqaterge/hermesmobile/IslandViews.java | grep -q "bounceRoom()"' "a growing button's bounce stays inside the card"
ok '! src "synchronized IslandState islandState()" HermesService | grep -q "needsMe"' "the panel's state follows every waiting request, whatever When Hermux needs me says"
# The Progress and Done states (IslandProgress) and the links between states: the working card opens the panel but the
# live viewer while Hermux uses an app for that chat; Stop is the card's Stop (ACTION_STOP) and ignores touches through
# another app's window; nothing runs once the panel is hidden; Progress closes after 90 s without a touch; Done's Open
# chat clears the Done chip; the Done record leaves the Done chip's rules as they were; the panel is never over the
# lock screen; a card answer is confirmed on the chip, a panel answer is not.
PROG=android/src/com/omarqaterge/hermesmobile/IslandProgress.java
PANEL=android/src/com/omarqaterge/hermesmobile/IslandPanel.java
ok 'src "Notification workingNotification(" HermesService | grep -q "setContentIntent(bgForChip(bg) ? openApp(lastSession, false, true) : islandIntent(lastSession, IslandState.PROGRESS))"' "the working card opens the panel, or the live viewer while Hermux uses an app for that chat"
ok 'src "void tapStop()" IslandProgress | grep -q "setAction(HermesService.ACTION_STOP)" && src "void tapStop()" IslandProgress | grep -q "putExtra(\"session\", session)" && src "void tapStop()" IslandProgress | grep -q "putExtra(\"turn_id\", turnId)"' "the panel's Stop is the card's Stop and passes the on-screen turn_id"
ok 'src "IslandViews.Pill pill(" IslandProgress | grep -q "setFilterTouchesWhenObscured(true)"' "Stop, Open chat and Watch ignore a touch through another app's window"
ok 'src "void stop()" IslandProgress | grep -q "removeCallbacks(clockRun)" && src "void stop()" IslandProgress | grep -q "arcRun, shimRun, sweepRun"' "the clock's handler and every loop stop with the state"
ok 'src "void finishNow()" IslandPanel | grep -q "prog.stop()" && src "void close()" IslandPanel | grep -q "prog.stop()" && src "protected void onDestroy()" IslandPanel | grep -q "prog.stop()"' "the Progress state stops when the panel closes, goes or is destroyed"
ok 'src "void finishNow()" IslandPanel | grep -q "removeCallbacks(idleRun)" && src "void touched()" IslandPanel | grep -q "postDelayed(idleRun, IslandMotion.PROGRESS_IDLE_MS)"' "Progress closes after 90 s without a touch, and no timer is left once the panel goes"
ok 'grep -q "if (e.getActionMasked() == MotionEvent.ACTION_DOWN) touched();" "$PANEL"' "every touch starts the 90 s again"
ok 'grep -q "p.MAIN.removeCallbacks(p.idleRun); // Done doesn" "$PROG"' "Done doesn't close by itself"
ok 'grep -q "p.openChat(session, null, true, false)" "$PROG" && src "void openChat(String chat, String draft, boolean clearDone" IslandPanel | grep -q "putExtra(\"clearDone\", true)"' "Done's Open chat clears the Done chip, as the chip's own tap does"
ok 'grep -q "p.openChat(session, null, false, true)" "$PROG" && src "void openChat(String chat, String draft, boolean clearDone" IslandPanel | grep -q "MainActivity.EXTRA_BG_VIEW"' "Watch opens the live viewer"
FLASH=$(sed -n '/case "flash": {/,/^            }/p' "$SVC")
ok '[ "$(grep -n "lastDone.put(session, new IslandState.Done" <<<"$FLASH" | cut -d: -f1)" -lt "$(grep -n "if (MainActivity.visible) return;" <<<"$FLASH" | head -1 | cut -d: -f1)" ] && grep -q "if (!NotifyChoice.finishes(this)) return;" <<<"$FLASH" && grep -q "unseen.put(session" <<<"$FLASH"' "the Done record is taken before the Done chip's rules, which stay as they were"
ok '! grep -q "setShowWhenLocked\|FLAG_SHOW_WHEN_LOCKED\|setTurnScreenOn" "$PANEL" "$PROG" && ! sed -n "/android:name=\".IslandPanel\"/,/\/>/p" android/AndroidManifest.xml | grep -q showWhenLocked' "the panel (and the app-in-use picture in it) is never over the lock screen"
ok 'src "void apply(IslandState st)" IslandProgress | grep -q "st.arrived()" && src "void apply(IslandState st)" IslandProgress | grep -q "p.swapToPermission(" && src "void apply(IslandState st)" IslandProgress | grep -q "p.swapTo(st.askToShow())"' "a request or question arriving during Progress or Done changes the panel in place"
ok 'src "void leaveProgress()" IslandPanel | grep -q "prog.stop()" && src "void swapTo(IslandState.Ask a)" IslandPanel | grep -q "leaveProgress()" && src "void swapToPermission(" IslandPanel | grep -q "leaveProgress()"' "the Progress state's loops stop when a request or question takes its place"
ok 'src "void succeeded()" IslandPanel | grep -q "postDelayed(nextRun" && src "void afterResult()" IslandPermission | grep -q "p.nextOrClose(shown, null)"' "after an answer from the panel, the next request or question waiting takes its place"
ok 'src "void answerApproval(" HermesService | grep -q "choice, true);" && grep -q "choice, false);" <<<"$FROM" && src "void sendApproval(" HermesService | grep -q "if (card) confirmChip("' "only a card button's answer is confirmed on the chip"
ok 'src "void sendAnswer(String text)" IslandPanel | grep -q "putExtra(\"panel\", true)" && src "void answerFromNotification(" HermesService | grep -q "!fromPanel) confirmChip(CONFIRM_SENT, true)"' "a card's answer to a question says Sent on the chip; the panel's doesn't"
ok 'src "Notification statusNotification(" HermesService | sed -n 2p | grep -q "confirmUntil > System.currentTimeMillis()) return confirmNotification()" && grep -q "CONFIRM_MS = 2000" "$SVC"' "the confirmation shows for two seconds"
# Review fixes: the task bar's motions write only to their own list and a newer list cancels them; Progress and Done
# scroll their body; every way into Stopping is one path with its timeout; the chip's confirmation has a drawn check or
# cross; Watch wraps its text; back-to-back changes of state cancel the earlier fade-in; the Done badge is the green
# wash; swapping to Progress is spoken; a question with no choices opens the keyboard when swapped to in place; one Done
# per chat; a failed stop ends Stopping in the same post; no pop-up over a panel that shows the request itself.
TASKSET=$(sed -n '/void set(String now, Ticker t, boolean reduced, boolean animate)/,/^        }/p' "$VIEWS")
ok 'grep -q "for (Ticker.Handle m : moving) m.cancel();" <<<"$TASKSET" && grep -q "g\[k\] = v" <<<"$TASKSET" && grep -q "h\[k\] = IslandMotion.swell(v)" <<<"$TASKSET" && grep -q "au\[k\] = v" <<<"$TASKSET" && ! grep -q "green\[k\]\|height\[k\]\|gold\[k\]" <<<"$TASKSET"' "a new task list cancels the running motions, and each writes only to its own list (no index past a shorter list)"
ok 'src "IslandViews.Fit build(" IslandProgress | grep -q "col.flex.add(scroll);" && src "IslandViews.Fit buildDone(" IslandProgress | grep -q "col.flex.add(bodyScroll);"' "Progress and Done scroll their body when the panel can't fit it"
ok '[ "$(grep -c "enterStopping(" "$PROG")" -ge 5 ] && src "IslandViews.Fit build(" IslandProgress | grep -q "if (a.stopping) enterStopping(false, a.stopAt, a.stopOk ? 0 : a.stopRemainingMs);" && src "void update(" IslandProgress | grep -q "enterStopping(true, a.stopAt, a.stopOk ? 0 : a.stopRemainingMs)" && src "void enterStopping(" IslandProgress | grep -q "phase = IslandState.SENDING;" && src "void enterStopping(" IslandProgress | grep -q "if (timeoutMs > 0) p.MAIN.postDelayed(stopTimeoutRun, timeoutMs);"' "the panel's Stop, the card's Stop seen while open and the card's Stop already on its way all enter Stopping the same way with remaining timeout"
ok 'src "Notification confirmNotification()" HermesService | grep -q "R.drawable.ic_stat_check : R.drawable.ic_stat_cross" && [ -f android/res/drawable/ic_stat_check.xml ] && [ -f android/res/drawable/ic_stat_cross.xml ]' "the chip's confirmation has a drawn check or cross beside the word"
ok 'grep -q "watch.setMinimumWidth(Math.round(dp(92)))" "$PROG" && grep -q "appRow.addView(watch, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT" "$PROG" && grep -q "protected void onMeasure(int ws, int hs)" "$VIEWS"' "Watch wraps its text, 92 dp at least"
ok 'src "void swapInner(IslandViews.Fit now)" IslandPanel | grep -q "if (swapIn != null) swapIn.cancel();"' "a change of state right after another cancels the earlier fade-in"
ok 'grep -q "b.fill.setColor(GREEN_WASH)" "$VIEWS" && ! grep -q "GREEN_SOFT" "$VIEWS"' "the Done badge is the design's green wash"
ok 'src "void swapToProgress(" IslandPanel | grep -q "announceForAccessibility" && src "void swapTo(IslandState.Ask a)" IslandPanel | grep -q "keyboardIfTyped"' "swapping to Progress is spoken; a typed question swapped in place opens the keyboard"
ok 'grep -q "line.setClipChildren(false); // the task count" "$PROG"' "the rolling task count is not clipped"
ok 'sed -n "/static final class MaxScroll/,/^    }/p" "$VIEWS" | tr -d "\n" | grep -q "protected void dispatchDraw(Canvas c) {            if (!scrolls()) {.*c.clipRect(getScrollX(), getScrollY(), getScrollX() + getWidth(), getScrollY() + getHeight());"' "a scrolling part cuts its content at its edges while it scrolls, so it can't draw over the buttons (landscape, largest text)"
ok 'src "IslandViews.Fit build(" IslandProgress | grep -q "scrolled.addView(errLine" && ! src "IslandViews.Fit build(" IslandProgress | grep -q "col.addView(errLine"' "the stop failure line is in the scrolled part, so Stop and Open chat stay on the panel"
STOPFAIL=$(src "void stopFailed()" IslandProgress)
ok 'grep -q "OnLayoutChangeListener" <<<"$STOPFAIL" && grep -q "removeOnLayoutChangeListener(this)" <<<"$STOPFAIL" && grep -q "scroll.smoothScrollTo(0, scrolled.getHeight())" <<<"$STOPFAIL" && ! grep -q "fullScroll" <<<"$STOPFAIL"' "stopFailed scrolls the failure line into view after layout with a one-shot OnLayoutChangeListener and smoothScrollTo (no fullScroll focus jump)"
ok 'src "IslandViews.Fit build(" IslandProgress | grep -q "enterStopping(false, a.stopAt, a.stopOk ? 0 : a.stopRemainingMs)" && src "void update(" IslandProgress | grep -q "IslandState.newStop(a, stopSeen))" && grep -q "s.expireStopTimeouts();" "$PROG" && src "void stopTurn(String session, String turnId)" HermesService | grep -q "stops.onStop200("' "panel and chip share StopBook timeout and acceptance rules"
STOPTURN=$(src "void stopTurn(String session, String turnId)" HermesService)
ok 'grep -q "stops.beginStop(session, turnId," <<<"$STOPTURN" && grep -q "stops.onStop200(ticket.session, ticket.turnId, gotTurnId, ticket.attempt" <<<"$STOPTURN" && grep -q "stops.onStopFailed(ticket.session, ticket.turnId, ticket.attempt, failed" <<<"$STOPTURN" && grep -q "req.put(\"turn_id\", ticket.turnId)" <<<"$STOPTURN" && ! grep -q "stopEpisode\|stopAttempt\|stopInFlight\|stopTurnSince\|clearStopInFlight\|endStopEpisode" "$SVC" "$PROG" android/src/com/omarqaterge/hermesmobile/IslandState.java' "stopTurn uses StopBook with turn_id and all old ad-hoc stop flags/counters are deleted"
ok 'src "synchronized void expireWorking()" HermesService | grep -q "stops.onExpireAll();" && src "void expireStopTimeouts()" HermesService | grep -q "stops.expireTimeouts("' "expireWorking and expireStopTimeouts drive StopBook cleanly"
ok 'src "synchronized java.util.List<IslandState.Progress> islandWorking()" HermesService | grep -q "stops.view(lastSession, lastTurnId, nowMono)" && src "synchronized java.util.List<IslandState.Progress> islandWorking()" HermesService | grep -q "stops.view(ses, oTurnId, nowMono)" && src "Notification workingNotification(" HermesService | grep -q "stops.view(lastSession, lastTurnId," && src "Notification workingNotification(" HermesService | grep -q "putExtra(\"turn_id\", lastTurnId)"' "chip and panel (including lastOthers) derive Stop state from one StopBook.view and pass turn_id"
STATUS=$(sed -n '/case "status": {/,/^            }/p' "$SVC")
ok 'grep -q "stops.onStatus(proc, working, liveTurns," <<<"$STATUS" && grep -q "!working && lastWorking && !lastProc.isEmpty() && !proc.isEmpty() && !proc.equals(lastProc)" <<<"$STATUS" && grep -q "stops.onDoneFlash(proc, session, turnId)" <<<"$FLASH"' "status (with proc + others turn_id/since) and done flash (with proc + turn_id) update StopBook and ignore other processes going idle"
# The pop-up and the 20 s / 40 s reminders don't ask the panel (review of 78239d3: a request could run out unheard
# behind a panel nobody looks at, or behind our own PIN screen); whether the pop-up may cover the panel is the owner's.
APPROVAL=$(sed -n '/case "approval": {/,/^            }/p' "$SVC"); ASK=$(sed -n '/case "ask": {/,/^            }/p' "$SVC")
ok '[ -n "$APPROVAL" ] && [ -n "$ASK" ] && ! grep -q "IslandPanel" <<<"$APPROVAL" && ! grep -q "IslandPanel" <<<"$ASK" && ! src "void tickApproval()" HermesService | grep -q "IslandPanel" && ! grep -q "static boolean showsRequests\|static boolean takesArrivals" "$PANEL"' "the pop-up and its reminders come whatever the panel shows, as on redesign"
[ "$fails" = 0 ] && echo "source rules: ALL PASSED" || { echo "source rules: $fails FAILED"; exit 1; }
