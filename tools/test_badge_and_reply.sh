#!/bin/bash
# Tests the notification badge-count plan (BadgePlan.java) and privacy rules (NotifyPrivacy.java) on a plain JDK,
# and the matching source rules in HermesService.java: per-card reply counts sum to unseen chats (never N × N),
# error cards keep their own tag out of the badge plan, non-badging channels and the group summary carry count 0
# with BADGE_ICON_NONE (cleared when > 0), phone-data chats never expose reply text or read aloud, reply/error/
# Done/cron notifications use VISIBILITY_PRIVATE + setPublicVersion, and RemoteInput dismissal guards active state
# and newer cards. Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile" "$T/classes"
cp android/src/com/omarqaterge/hermesmobile/BadgePlan.java "$T/src/com/omarqaterge/hermesmobile/"
cp android/src/com/omarqaterge/hermesmobile/NotifyPrivacy.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/BadgePlanTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.*;
public class BadgePlanTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static Set<String> set(String... ids) { return new LinkedHashSet<>(Arrays.asList(ids)); }
    static List<String> list(String... tags) { return Arrays.asList(tags); }
    static int sum(Map<String, Integer> m) { int s = 0; for (int v : m.values()) s += v; return s; }

    public static void main(String[] args) {
        check(BadgePlan.initialReplyCount("reply") == 1, "a fresh reply card starts at count 1 (not unseen.size())");
        check(BadgePlan.initialReplyCount("error") == 0, "a failed-turn error card starts at count 0");
        check(BadgePlan.isReplyTag("reply:s1") && !BadgePlan.isReplyTag("error:s1") && !BadgePlan.isReplyTag("cron:s1") && !BadgePlan.isReplyTag(null),
                "isReplyTag matches only reply:<chat> (never error:<chat>)");
        check("s1".equals(BadgePlan.sessionOfReplyTag("reply:s1")) && "".equals(BadgePlan.sessionOfReplyTag("error:s1")),
                "sessionOfReplyTag extracts the chat id only for reply:<chat>");

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

        BadgePlan.Plan errIgnored = BadgePlan.plan(1, set("b"), list("error:a", "reply:b"));
        check(errIgnored.cancelTags.isEmpty() && errIgnored.counts.size() == 1 && Integer.valueOf(1).equals(errIgnored.counts.get("reply:b")),
                "error:<chat> cards are kept out of the badge plan and never cancelled");

        BadgePlan.Plan cleared = BadgePlan.plan(0, set(), list("reply:a", "reply:b"));
        check(cleared.cancelTags.equals(list("reply:a", "reply:b")) && cleared.counts.isEmpty(),
                "0 unseen chats → every active reply card is cancelled");

        BadgePlan.Plan empty = BadgePlan.plan(2, set("a", "b"), list());
        check(empty.cancelTags.isEmpty() && empty.counts.isEmpty(), "no active reply cards → nothing to update");

        // NotifyPrivacy: phone-data redaction and lock-screen generic titles.
        check(NotifyPrivacy.REPLY_READY.equals(NotifyPrivacy.safeReply("Your OTP is 123456", true))
                && "Hello".equals(NotifyPrivacy.safeReply("Hello", false)),
                "safeReply replaces phone-data replies with generic words and leaves normal replies alone");
        check(NotifyPrivacy.REPLY_READY.equals(NotifyPrivacy.safeBody("reply", "Private SMS", true))
                && NotifyPrivacy.TURN_FAILED.equals(NotifyPrivacy.safeBody("error", "Secret detail", true))
                && NotifyPrivacy.JOB_FINISHED.equals(NotifyPrivacy.safeBody("cron", "Secret job", true))
                && "Normal body".equals(NotifyPrivacy.safeBody("reply", "Normal body", false)),
                "safeBody redacts reply, error and cron bodies for phone-data chats");
        check(!NotifyPrivacy.mayReadAloud("mobile", "Private SMS", true)
                && NotifyPrivacy.mayReadAloud("mobile", "Normal reply", false)
                && !NotifyPrivacy.mayReadAloud("tui", "Normal reply", false)
                && !NotifyPrivacy.mayReadAloud("mobile", "", false),
                "mayReadAloud blocks phone-data chats, non-mobile chats, and empty text");
        check("New reply".equals(NotifyPrivacy.publicTitle("reply"))
                && "Turn failed".equals(NotifyPrivacy.publicTitle("error"))
                && "Scheduled job".equals(NotifyPrivacy.publicTitle("cron"))
                && "Hermux".equals(NotifyPrivacy.publicTitle("done")),
                "publicTitle returns generic lock-screen titles with no chat or reply content");

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
check("hasReadPhoneData(session)" in fl_case and "NotifyPrivacy.safeReply(" in fl_case and "NotifyPrivacy.REPLY_READY" in fl_case,
      "flash redacts island Done state, doneInfo, and momentary flash for phone-data chats")

rep_case = ev[ev.find('case "reply":'):ev.find('case "learning":')]
check("BadgePlan.initialReplyCount(kind)" in rep_case and "unseen.size()" not in rep_case
      and 'tag("error".equals(kind) ? "error" : "reply", session)' in rep_case
      and "NotifyPrivacy.safeBody(" in rep_case and "makePrivate(" in rep_case,
      "reply/error posts use separate error:<chat> tag, BadgePlan.initialReplyCount, phone-data redaction, and makePrivate")

cron_case = case_block("cron")
check("NotifyPrivacy.safeBody(" in cron_case and "makePrivate(" in cron_case and "badged(cb, 0)" in cron_case,
      "cron posts use phone-data redaction, makePrivate, and badge count 0")

clr_case = case_block("clear")
check('tag("error", session)' in clr_case,
      "clear also cancels error:<chat> when clearing reply")

ms = body(svc, "synchronized void markSeen(")
check('tag("error", id)' in ms,
      "markSeen cancels error:<chat> alongside reply:<chat>")

ra = body(svc, "void readAloud(")
check("NotifyPrivacy.mayReadAloud(" in ra and "hasReadPhoneData(session)" in ra,
      "readAloud blocks phone-data chats via NotifyPrivacy.mayReadAloud")

dn = body(svc, "synchronized Notification doneNotification(")
check("NotifyPrivacy.safeReply(" in dn and "hasReadPhoneData(" in dn and "makePrivate(" in dn,
      "doneNotification redacts phone-data replies and sets VISIBILITY_PRIVATE via makePrivate")

mp = body(svc, "void makePrivate(")
check("VISIBILITY_PRIVATE" in mp and "setPublicVersion(" in mp,
      "makePrivate sets VISIBILITY_PRIVATE and a generic setPublicVersion")

hr = body(svc, "boolean hasReadPhoneData(")
check("PhoneDataRoute.chats(this)" in hr and "overflowed()" in hr and "lost()" in hr and "return true;" in hr,
      "hasReadPhoneData consults PhoneDataRoute.chats and fails closed")

ub = body(svc, "void updateBadge(")
check("BadgePlan.plan(" in ub and "badged(b, 0)" in ub and "EXTRA_DISMISSING" in ub,
      "updateBadge ignores EXTRA_DISMISSING cards, distributes counts with BadgePlan.plan, and zeroes stale summary")

ans = body(svc, "void answerFromNotification(")
check("fromRemoteInput" in ans and ans.count("dismissAnsweredCard(") >= 2 and "card_tag" in ans,
      "answerFromNotification uses card_tag and dismisses RemoteInput cards via dismissAnsweredCard")

dis = body(svc, "void dismissAnsweredCard(")
check("setTimeoutAfter(1)" in dis and "EXTRA_DISMISSING" in dis and "addRemoteInput" not in dis
      and "nm.notify(tag, 2," in dis and "if (!active)" in dis and "oursOrGone" in dis,
      "dismissAnsweredCard checks active state before posting placeholder and guards dropEmptySummary against newer cards")

total = fails + (0 if rc == 0 else 1)
print("ALL PASSED" if total == 0 else f"{total} FAILED")
sys.exit(0 if total == 0 else 1)
PY
