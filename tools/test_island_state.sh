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
# waits; expired at its deadline (or vanished within the slack); gone (answered elsewhere) earlier. Needs javac 11+.
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
ok 'grep -q "return !blocked && super.dispatchTouchEvent" <<<"$FIT"' "blocked content passes every touch on"
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
[ "$fails" = 0 ] && echo "source rules: ALL PASSED" || { echo "source rules: $fails FAILED"; exit 1; }
