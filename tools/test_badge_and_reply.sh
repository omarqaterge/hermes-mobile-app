#!/bin/bash
# Tests the notification badge-count plan (BadgePlan.java) and privacy rules (NotifyPrivacy.java + PhoneDataChats.java)
# on a plain JDK, and the matching source rules in HermesService.java: per-card reply counts sum to unseen chats
# (never N × N), error and answer_fail cards stay out of the badge plan, non-badging channels and the group summary
# carry count 0 with BADGE_ICON_NONE (cleared when > 0), phone-data chats never expose reply/error/working/ask/learning/
# cron text or read aloud (failing closed on null/empty/invalid ids), every user-content notification uses
# VISIBILITY_PRIVATE + generic setPublicVersion (never cloning into publicVersion), answerAction uses boolean error_card
# (never trusting raw card_tag), dismissAnsweredCard synchronizes and guards all notification calls, and API 26-30 empty
# inline answers keep the card when locked. Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile" "$T/classes"
cp android/src/com/omarqaterge/hermesmobile/BadgePlan.java "$T/src/com/omarqaterge/hermesmobile/"
cp android/src/com/omarqaterge/hermesmobile/NotifyPrivacy.java "$T/src/com/omarqaterge/hermesmobile/"
cp android/src/com/omarqaterge/hermesmobile/PhoneDataChats.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/BadgePlanTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.*;
public class BadgePlanTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static Set<String> set(String... ids) { return new LinkedHashSet<>(Arrays.asList(ids)); }
    static List<String> list(String... tags) { return Arrays.asList(tags); }
    static int sum(Map<String, Integer> m) { int s = 0; for (int v : m.values()) s += v; return s; }
    static String rep(String s, int n) { StringBuilder b = new StringBuilder(); for (int i = 0; i < n; i++) b.append(s); return b.toString(); }
    static class Mem implements PhoneDataChats.Store {
        String text;
        public String load() { return text; }
        public void save(String t) { text = t; }
    }

    public static void main(String[] args) {
        check(BadgePlan.initialReplyCount("reply") == 1, "a fresh reply card starts at count 1 (not unseen.size())");
        check(BadgePlan.initialReplyCount("error") == 0, "a failed-turn error card starts at count 0");
        check(BadgePlan.isReplyTag("reply:s1") && !BadgePlan.isReplyTag("error:s1") && !BadgePlan.isReplyTag("answer_fail:s1") && !BadgePlan.isReplyTag("cron:s1") && !BadgePlan.isReplyTag(null),
                "isReplyTag matches only reply:<chat> (never error:<chat> or answer_fail:<chat>)");
        check("s1".equals(BadgePlan.sessionOfReplyTag("reply:s1")) && "".equals(BadgePlan.sessionOfReplyTag("error:s1")),
                "sessionOfReplyTag extracts the chat id only for reply:<chat>");
        check("reply:c1".equals(BadgePlan.answerTag("reply", "c1", false))
                && "error:c1".equals(BadgePlan.answerTag("reply", "c1", true))
                && "ask:c1".equals(BadgePlan.answerTag("ask", "c1", true))
                && "reply:c1".equals(BadgePlan.answerTag("other", "c1", true)),
                "answerTag honours errorCard only when kind is reply");

        // BadgePlan.answerUri / parseAnswerUri: immutable data URI carried on RemoteInput PendingIntents.
        String uReply = BadgePlan.answerUri("reply", "chat:a/b?c=1&d=2#e", true);
        BadgePlan.AnswerTarget pReply = BadgePlan.parseAnswerUri(uReply);
        check(pReply != null && "reply".equals(pReply.kind) && "chat:a/b?c=1&d=2#e".equals(pReply.session) && pReply.errorCard,
                "answerUri / parseAnswerUri round-trips reply target with special characters and error_card=true");
        String uAsk = BadgePlan.answerUri("ask", "s-1", true);
        BadgePlan.AnswerTarget pAsk = BadgePlan.parseAnswerUri(uAsk);
        check(pAsk != null && "ask".equals(pAsk.kind) && "s-1".equals(pAsk.session) && !pAsk.errorCard,
                "answerUri / parseAnswerUri keeps errorCard false when kind is ask");
        check(BadgePlan.parseAnswerUri(null) == null
                && BadgePlan.parseAnswerUri("") == null
                && BadgePlan.parseAnswerUri("https://example.com/?kind=reply&session=s1&error_card=0") == null
                && BadgePlan.parseAnswerUri("hermux://answer?kind=evil&session=s1&error_card=0") == null
                && BadgePlan.parseAnswerUri("hermux://answer?kind=reply&session=s1&error_card=2") == null
                && BadgePlan.parseAnswerUri("hermux://answer?kind=reply&session=s1&panel=1") == null
                && BadgePlan.parseAnswerUri("hermux://answer?kind=reply&session=%ZZ&error_card=0") == null,
                "parseAnswerUri rejects null, wrong scheme/authority, unknown kind/params, bad error_card and invalid percent-encoding");

        BadgePlan.Plan two = BadgePlan.plan(2, set("a", "b"), list("reply:a", "reply:b"));
        check(two.cancelTags.isEmpty()
                && Integer.valueOf(1).equals(two.counts.get("reply:a"))
                && Integer.valueOf(1).equals(two.counts.get("reply:b"))
                && sum(two.counts) == 2,
                "2 unseen chats with 2 active reply cards → 1 + 1 = 2 (never 2 + 2 = 4)");

        BadgePlan.Plan three = BadgePlan.plan(3, set("a", "b", "c"), list("reply:a", "reply:b", "reply:c"));
        check(three.cancelTags.isEmpty() && sum(three.counts) == 3
                && Integer.valueOf(1).equals(three.counts.get("reply:a"))
                && Integer.valueOf(1).equals(three.counts.get("reply:b"))
                && Integer.valueOf(1).equals(three.counts.get("reply:c")),
                "3 unseen chats with 3 active reply cards → 1 + 1 + 1 = 3 (never 9)");

        BadgePlan.Plan swiped = BadgePlan.plan(3, set("a", "b", "c"), list("reply:a", "reply:c"));
        check(swiped.cancelTags.isEmpty()
                && Integer.valueOf(1).equals(swiped.counts.get("reply:a"))
                && Integer.valueOf(2).equals(swiped.counts.get("reply:c"))
                && sum(swiped.counts) == 3,
                "3 unseen chats with 1 card swiped away → remaining cards sum to 3 (1 + 2)");

        BadgePlan.Plan oneLeft = BadgePlan.plan(2, set("a", "b"), list("reply:b"));
        check(oneLeft.cancelTags.isEmpty() && Integer.valueOf(2).equals(oneLeft.counts.get("reply:b")) && sum(oneLeft.counts) == 2,
                "2 unseen chats with 1 active card → that card carries 2");

        BadgePlan.Plan mixed = BadgePlan.plan(1, set("b"), list("reply:a", "reply:b", "reply:old"));
        check(mixed.cancelTags.equals(list("reply:a", "reply:old"))
                && mixed.counts.size() == 1
                && Integer.valueOf(1).equals(mixed.counts.get("reply:b")),
                "active reply cards for already-seen chats are cancelled; unseen card gets 1");

        BadgePlan.Plan errIgnored = BadgePlan.plan(1, set("b"), list("error:a", "answer_fail:b", "reply:b"));
        check(errIgnored.cancelTags.isEmpty() && errIgnored.counts.size() == 1 && Integer.valueOf(1).equals(errIgnored.counts.get("reply:b")),
                "error:<chat> and answer_fail:<chat> cards are kept out of the badge plan and never cancelled");

        BadgePlan.Plan cleared = BadgePlan.plan(0, set(), list("reply:a", "reply:b"));
        check(cleared.cancelTags.equals(list("reply:a", "reply:b")) && cleared.counts.isEmpty(),
                "0 unseen chats → every active reply card is cancelled");

        BadgePlan.Plan empty = BadgePlan.plan(2, set("a", "b"), list());
        check(empty.cancelTags.isEmpty() && empty.counts.isEmpty(), "no active reply cards → nothing to update");

        // NotifyPrivacy: fail-closed hasReadPhoneData on null/empty/invalid ids and overflow/lost records.
        PhoneDataChats clean = new PhoneDataChats(new Mem());
        check(!NotifyPrivacy.hasReadPhoneData(clean, null)
                && !NotifyPrivacy.hasReadPhoneData(clean, "")
                && !NotifyPrivacy.hasReadPhoneData(clean, "bad\nid")
                && !NotifyPrivacy.hasReadPhoneData(clean, "chat-1"),
                "hasReadPhoneData is false while no chat has read phone data");
        check(NotifyPrivacy.hasReadPhoneData(null, "chat-1"), "hasReadPhoneData fails closed when chats is null");
        PhoneDataChats one = new PhoneDataChats(new Mem());
        one.record("tainted-1", null);
        check(NotifyPrivacy.hasReadPhoneData(one, "tainted-1")
                && !NotifyPrivacy.hasReadPhoneData(one, "clean-1")
                && NotifyPrivacy.hasReadPhoneData(one, null)
                && NotifyPrivacy.hasReadPhoneData(one, "")
                && NotifyPrivacy.hasReadPhoneData(one, "bad\nid")
                && NotifyPrivacy.hasReadPhoneData(one, "has space")
                && NotifyPrivacy.hasReadPhoneData(one, rep("x", 129)),
                "hasReadPhoneData fails closed on null, empty, and invalid session ids whenever any chat has read");
        Mem ovMem = new Mem();
        ovMem.text = "v3 overflow 2000\ntainted-1";
        PhoneDataChats ov = new PhoneDataChats(ovMem);
        check(NotifyPrivacy.hasReadPhoneData(ov, "clean-1") && NotifyPrivacy.hasReadPhoneData(ov, "bad\nid") && NotifyPrivacy.hasReadPhoneData(ov, null),
                "hasReadPhoneData returns true for valid and invalid ids when record overflowed");
        Mem lostMem = new Mem();
        lostMem.text = "v3 ok 2000 lost";
        PhoneDataChats lost = new PhoneDataChats(lostMem);
        check(NotifyPrivacy.hasReadPhoneData(lost, "clean-1") && NotifyPrivacy.hasReadPhoneData(lost, "bad\nid") && NotifyPrivacy.hasReadPhoneData(lost, ""),
                "hasReadPhoneData returns true for valid and invalid ids when record lost an id");

        // NotifyPrivacy: phone-data redaction and lock-screen generic titles.
        check(NotifyPrivacy.REPLY_READY.equals(NotifyPrivacy.safeReply("Your OTP is 123456", true))
                && "Hello".equals(NotifyPrivacy.safeReply("Hello", false)),
                "safeReply replaces phone-data replies with generic words and leaves normal replies alone");
        check(NotifyPrivacy.REPLY_READY.equals(NotifyPrivacy.safeBody("reply", "Private SMS", true))
                && NotifyPrivacy.TURN_FAILED.equals(NotifyPrivacy.safeBody("error", "Secret detail", true))
                && NotifyPrivacy.JOB_FINISHED.equals(NotifyPrivacy.safeBody("cron", "Secret job", true, false))
                && NotifyPrivacy.JOB_FAILED.equals(NotifyPrivacy.safeBody("cron", "Secret fail", true, true))
                && NotifyPrivacy.WORKING.equals(NotifyPrivacy.safeBody("working", "Reading secret.txt", true))
                && NotifyPrivacy.ASK_OPEN_APP.equals(NotifyPrivacy.safeBody("ask", "Send OTP to Bob?", true))
                && NotifyPrivacy.LEARNED.equals(NotifyPrivacy.safeBody("learning", "User SSN is ...", true))
                && "Normal body".equals(NotifyPrivacy.safeBody("reply", "Normal body", false)),
                "safeBody redacts reply, error, cron (finished/failed), working, ask and learning bodies for phone-data chats");
        check(!NotifyPrivacy.mayReadAloud("mobile", "Private SMS", true)
                && NotifyPrivacy.mayReadAloud("mobile", "Normal reply", false)
                && !NotifyPrivacy.mayReadAloud("tui", "Normal reply", false)
                && !NotifyPrivacy.mayReadAloud("mobile", "", false),
                "mayReadAloud blocks phone-data chats, non-mobile chats, and empty text");
        check("New reply".equals(NotifyPrivacy.publicTitle("reply"))
                && "Turn failed".equals(NotifyPrivacy.publicTitle("error"))
                && "Scheduled job".equals(NotifyPrivacy.publicTitle("cron"))
                && "Hermux has a question".equals(NotifyPrivacy.publicTitle("ask"))
                && "Hermux".equals(NotifyPrivacy.publicTitle("working"))
                && "Hermux".equals(NotifyPrivacy.publicTitle("learning"))
                && "Hermux".equals(NotifyPrivacy.publicTitle("done")),
                "publicTitle returns generic lock-screen titles with no chat or reply content");
        check(NotifyPrivacy.redactApproval(true, true)
                && !NotifyPrivacy.redactApproval(true, false)
                && !NotifyPrivacy.redactApproval(false, true)
                && !NotifyPrivacy.redactApproval(false, false)
                && "Hermux needs your approval".equals(NotifyPrivacy.APPROVAL_LOCKED),
                "redactApproval redacts phone-data approvals only while keyguard is locked, using generic APPROVAL_LOCKED wording");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -nowarn -proc:none -d "$T/classes" "$T"/src/com/omarqaterge/hermesmobile/*.java 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
set +e
java -cp "$T/classes" com.omarqaterge.hermesmobile.BadgePlanTest 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS'
rc=${PIPESTATUS[0]}
set -e
python3 - "$rc" <<'PY'
import sys
rc = int(sys.argv[1])
fails = 0
def check(ok, what):
    global fails
    print(("PASS  " if ok else "FAIL  ") + what)
    if not ok: fails += 1

svc = open("android/src/com/omarqaterge/hermesmobile/HermesService.java", encoding="utf-8").read()
def body(src, sig):
    i = src.find(sig)
    if i < 0: return ""
    j = src.find("{", i)
    depth, k = 0, j
    while k < len(src):
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        if depth == 0: return src[j + 1:k]
        k += 1
    return ""

badged = body(svc, "Notification badged(")
check("BADGE_ICON_NONE" in badged and "BADGE_ICON_LARGE" in badged and "setMessageCount" in badged and "Math.max(0, n)" in badged,
      "badged sets BADGE_ICON_NONE for 0, clears it with BADGE_ICON_LARGE above 0, and writes non-negative count")

alert_fn = body(svc, "Notification alert(")
check("CH_LEARN" in alert_fn and "CH_JOBS" in alert_fn and "badged(" in alert_fn and ", 0)" in alert_fn,
      "alert sets badge count 0 (and BADGE_ICON_NONE) on Learning and Scheduled jobs cards")

pg = body(svc, "void postGrouped(")
check("badged(sum, 0)" in pg and "unseen.size()" not in pg,
      "postGrouped keeps the group summary at badge count 0")

ev = body(svc, "synchronized void onEvent(JSONObject e)")
def case_block(kind):
    i = ev.find('case "' + kind + '":')
    j = ev.find('case "', i + 10)
    return ev[i:j if j > 0 else len(ev)]

fl_case = case_block("flash")
check("isPhoneData(e, session)" in fl_case and "NotifyPrivacy.safeReply(" in fl_case and "NotifyPrivacy.REPLY_READY" in fl_case,
      "flash redacts island Done state, doneInfo, and momentary flash for phone-data chats")

ask_case = case_block("ask")
check("isPhoneData(e, session)" in ask_case and "NotifyPrivacy.ASK_OPEN_APP" in ask_case
      and "NotifyPrivacy.safeBody(\"ask\"" in ask_case and "makePrivate(" in ask_case and "if (!phoneData)" in ask_case,
      "ask pop-up redacts phone-data questions, omits choices/RemoteInput for phone-data chats, and calls makePrivate")

rep_case = ev[ev.find('case "reply":'):ev.find('case "learning":')]
check("BadgePlan.initialReplyCount(kind)" in rep_case and "unseen.size()" not in rep_case
      and 'tag(isError ? "error" : "reply", session)' in rep_case
      and "NotifyPrivacy.safeBody(" in rep_case and "isPhoneData(e, session)" in rep_case and "makePrivate(" in rep_case,
      "reply/error posts use separate error:<chat> tag, BadgePlan.initialReplyCount, phone-data redaction, and makePrivate")

lrn_case = case_block("learning")
check("isPhoneData(e, session)" in lrn_case and 'NotifyPrivacy.safeBody("learning"' in lrn_case
      and "makePrivate(" in lrn_case and "badged(lb, 0)" in lrn_case,
      "learning card and flash redact phone-data text, call makePrivate, and set badge count 0")

cron_case = case_block("cron")
check('NotifyPrivacy.safeBody("cron", body, isPhoneData(e, session), cronFailed)' in cron_case
      and "makePrivate(" in cron_case and "badged(cb, 0)" in cron_case,
      "cron posts pass failure state to NotifyPrivacy.safeBody, call makePrivate, and set badge count 0")

clr_case = case_block("clear")
check('tag("error", session)' in clr_case,
      "clear also cancels error:<chat> when clearing reply")

ms = body(svc, "synchronized void markSeen(")
check('tag("error", id)' in ms and 'tag("answer_fail", id)' in ms,
      "markSeen cancels error:<chat> and answer_fail:<chat> alongside reply:<chat>")

ra = body(svc, "void readAloud(")
check("NotifyPrivacy.mayReadAloud(" in ra and "isPhoneData(e, session)" in ra,
      "readAloud blocks phone-data chats via NotifyPrivacy.mayReadAloud and isPhoneData")

wn = body(svc, "Notification workingNotification(")
check("NotifyPrivacy.WORKING" in wn and "isPhoneData(o," in wn and "makePrivate(" in wn
      and "setPublicVersion(b.build().clone())" not in wn and "!mainPhoneData && thumb != null" in wn,
      "workingNotification redacts main step, todo and lastOthers for phone-data chats, calls makePrivate, and never clones into publicVersion")

an = body(svc, "Notification askNotification(")
check("isPhoneData(a, session)" in an and "NotifyPrivacy.ASK_OPEN_APP" in an and "makePrivate(" in an,
      "askNotification redacts phone-data questions, hides choices/actions, and calls makePrivate")

ist = body(svc, "synchronized IslandState islandState(")
check("isPhoneData(q, session)" in ist and "NotifyPrivacy.ASK_OPEN_APP" in ist,
      "islandState redacts pendingAsk for phone-data chats")

dn = body(svc, "synchronized Notification doneNotification(")
check("NotifyPrivacy.safeReply(" in dn and "isPhoneData(info, latestId)" in dn and "makePrivate(" in dn,
      "doneNotification redacts phone-data replies and sets VISIBILITY_PRIVATE via makePrivate")

mp = body(svc, "void makePrivate(")
check("VISIBILITY_PRIVATE" in mp and "setPublicVersion(" in mp,
      "makePrivate sets VISIBILITY_PRIVATE and a generic setPublicVersion")

hr = body(svc, "boolean hasReadPhoneData(")
ip = body(svc, "boolean isPhoneData(")
check("NotifyPrivacy.hasReadPhoneData(PhoneDataRoute.chats(this), session)" in hr and "return true;" in hr
      and 'e.optBoolean("phone_data", false)' in ip and "hasReadPhoneData(session)" in ip,
      "hasReadPhoneData delegates to NotifyPrivacy.hasReadPhoneData (failing closed) and isPhoneData only tightens via phone_data")

ub = body(svc, "void updateBadge(")
check("BadgePlan.plan(" in ub and "badged(b, 0)" in ub and "EXTRA_DISMISSING" in ub,
      "updateBadge ignores EXTRA_DISMISSING cards, distributes counts with BadgePlan.plan, and zeroes stale summary")

aa = body(svc, "Notification.Action answerAction(String kind, String session, String label, java.util.List<CharSequence> choices, boolean errorCard)")
check("BadgePlan.answerUri(" in aa and ".setData(" in aa and ".putExtra(" not in aa
      and '"card_tag"' not in svc and "nothing else can fill it in" not in svc,
      "answerAction encodes kind/session/error_card in the Intent data URI (immune to FLAG_MUTABLE fillIn extras)")

ans = body(svc, "void answerFromNotification(")
check("BadgePlan.parseAnswerUri(" in ans and "fromRemoteInput" in ans and ans.count("dismissAnsweredCard(") >= 3
      and "BadgePlan.answerTag(" in ans
      and 'i.getStringExtra("text").trim()' not in ans
      and "remoteAction ? null : i.getStringExtra(\"text\")" in ans
      and "!remoteAction && !fromRemoteInput" in ans
      and "synchronized (HermesService.this)" in ans and "pending.answered(" in ans
      and ans.find("synchronized (HermesService.this)") < ans.find("pending.answered(")
      and "cancelCard(nm, t)" in ans and "nm.cancel(" not in ans and "dropEmptySummary(" not in ans
      and "try {" in ans and "postGrouped(" in ans
      and "MainActivity.keyguardLocked(this)" in ans
      and 'tag("answer_fail", session)' in ans and "makePrivate(b, CH_ALERT" in ans and "badged(b, 0)" in ans,
      "answerFromNotification reads RemoteInput target from data URI, null-checks text extra, locks pending.answered on HermesService.this, and guards all notification calls")

cc = body(svc, "void cancelCard(")
check("if (nm == null) return;" in cc and "nm.cancel(tag, 2)" in cc and "dropEmptySummary(nm, tag)" in cc and "catch (Exception ignored)" in cc,
      "cancelCard null-checks nm and guards nm.cancel and dropEmptySummary")

app_case = case_block("approval")
app_chip = body(svc, "Notification approvalNotification(")
app_card = body(svc, "Notification buildApprovalCard(")
app_re = body(svc, "void reAlertApproval()")
app_ref = body(svc, "void refreshApprovalPopups(")
app_tick = body(svc, "void tickApproval()")
app_ia = body(svc, "synchronized java.util.List<IslandState.Approval> islandApprovals()")
app_intent = body(svc, "PendingIntent approveIntent(")
app_refuse = body(svc, "private String panelRefusal(")
pd_ev = body(svc, "static JSONObject phoneDataEvent(")
main_src = open("android/src/com/omarqaterge/hermesmobile/MainActivity.java", encoding="utf-8").read()
kg_fn = body(main_src, "static boolean keyguardLocked(")
ask_un = body(main_src, "void askUnlock()")

# Finding 1: redacted approvals omit Allow once / Allow session (keeping Deny only) across popup, chip, and re-alert.
allow_in_card = app_card.find("if (!lockedPrivate)")
allow_once_card = app_card.find('"Allow once"')
allow_sess_card = app_card.find('"Allow session"')
deny_card = app_card.find('"Deny"')
allow_in_chip = app_chip.find("if (!lockedPrivate)")
allow_once_chip = app_chip.find('"Allow once"')
allow_sess_chip = app_chip.find('"Allow session"')
deny_chip = app_chip.find('"Deny"')
check("lockedPrivate ? NotifyPrivacy.APPROVAL_LOCKED" in app_card
      and 'lockedPrivate ? "" :' in app_card
      and "if (silent) b.setOnlyAlertOnce(true);" in app_card
      and "hideOnLockScreen(b, CH_ALERT, phoneData)" in app_card
      and 0 <= allow_in_card < allow_once_card < allow_sess_card < deny_card
      and "NotifyPrivacy.redactApproval(phoneData, lockedNow)" in app_case
      and "buildApprovalCard(ev, session, title, body, phoneData, lockedPrivate, false)" in app_case
      and "NotifyPrivacy.redactApproval(phoneData, MainActivity.keyguardLocked(this))" in app_chip
      and 'lockedPrivate ? "" : clip(a.optString("what"' in app_chip
      and 'lockedPrivate ? "" : clip(a.optString("command"' in app_chip
      and "lockedPrivate ? NotifyPrivacy.APPROVAL_LOCKED" in app_chip
      and 0 <= allow_in_chip < allow_once_chip < allow_sess_chip < deny_chip
      and "hideOnLockScreen(b, CH_STATUS, phoneData)" in app_chip
      and "NotifyPrivacy.redactApproval(phoneData, MainActivity.keyguardLocked(this))" in app_re
      and "buildApprovalCard(" in app_re,
      "all approval notification sites (popup, status chip, re-alert) redact text and omit Allow actions while keyguardLocked (keeping Deny only), and also call hideOnLockScreen")

# Finding 2: tickApproval tracks lock/unlock transitions to silently refresh every pending tainted popup, and cancels expired cards.
check("lastApprovalLocked" in app_case
      and "else if (lastApprovalLocked != null && lockedNow != lastApprovalLocked)" in app_case
      and "main.post(() -> refreshApprovalPopups(lockedNow))" in app_case
      and app_case.find("refreshApprovalPopups(lockedNow)") < app_case.find("pending.arrived(")
      and "lastApprovalLocked != null && lockedNow != lastApprovalLocked" in app_tick
      and "refreshApprovalPopups(lockedNow)" in app_tick
      and "pending.all(PendingAsk.APPROVAL)" in app_ref
      and "isPhoneData(en.payload, en.session)" in app_ref
      and "buildApprovalCard(" in app_ref and ", true)" in app_ref
      and "postGrouped(nm, cardTag, card)" in app_ref
      and "pending.expire(now, 3000)" in app_tick
      and 'cancelCard(nm, tag("approval", ses))' in app_tick
      and "if (!after.contains(ses))" in app_tick,
      "tickApproval (and a second approval arriving after a lock or unlock since the last tick) silently refreshes all pending tainted approval pop-ups on lock/unlock transitions and cancels expired approval cards when no newer approval waits for that session")

# Finding 3: MainActivity.keyguardLocked fails closed when KeyguardManager is null, and askUnlock guards null km.
check("km == null || km.isKeyguardLocked()" in kg_fn and "if (km == null) return;" in ask_un,
      "MainActivity.keyguardLocked fails closed when KeyguardManager is null and askUnlock null-checks km")
check('"phone_data_read"' in pd_ev and 'c.remove("phone_data_read")' in pd_ev and 'c.remove("phone_data_unreadable")' in pd_ev
      and 'a.optBoolean("phone_data_read", false)' in app_chip
      and 'a.optBoolean("phone_data_read", false)' in app_ia
      and 'e.optBoolean("phone_data_read", false)' in app_intent
      and 'live.optBoolean("phone_data_read", false)' in app_refuse,
      "phoneDataEvent distinguishes phone_data_read (phone_data tool reads) from phone_data (tainted-chat privacy) across chip title, island panel, approveIntent and panelRefusal")

dis = body(svc, "void dismissAnsweredCard(")
check("if (nm == null) return;" in dis and "setTimeoutAfter(1)" in dis and "EXTRA_DISMISSING" in dis and "addRemoteInput" not in dis
      and "nm.notify(tag, 2," in dis and "if (!active)" in dis and "oursOrGone" in dis
      and dis.count("synchronized (HermesService.this)") >= 2 and dis.count("catch (Exception ignored)") >= 4,
      "dismissAnsweredCard null-checks nm, synchronizes active-check+notify and 300 ms cleanup on HermesService.this and guards notification calls")

total = fails + (0 if rc == 0 else 1)
print("ALL PASSED" if total == 0 else f"{total} FAILED")
sys.exit(0 if total == 0 else 1)
PY
