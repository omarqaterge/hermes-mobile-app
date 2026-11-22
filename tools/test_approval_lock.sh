#!/bin/bash
# Tests the confirmed live sessions of "Confirm approvals with fingerprint" (android/.../ApprovalLock.java) on a plain JDK:
# a confirmation is filed under one runtime id and covers only that one, '' and null never count, forget drops one,
# and at most ApprovalLock.MAX are kept (the oldest goes, a confirmed one seen again becomes the newest). The island
# panel's one-use grants: a grant allows one choice for one request of one chat, only once, only while fresh, and at
# most MAX_GRANTS are kept. The screen-lock screen's result counts only in the activity whose prompt is up and only
# with that prompt's own request code; a cancelled prompt's screen and a stale code answer nothing. The class names
# Android types, so Robolectric's android-all jar (the one tools/java-check.sh checks and caches; ANDROID_ALL_JAR names
# another copy) is on the classpath; nothing here calls into Android. Needs javac 11+. Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
JAR="${ANDROID_ALL_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/hermes-mobile/android-all-16.jar}"
[ -s "$JAR" ] || { echo "test_approval_lock: $JAR is missing: run tools/java-check.sh first" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile" "$T/classes"
cp android/src/com/omarqaterge/hermesmobile/ApprovalLock.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/ApprovalLockTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class ApprovalLockTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    /** Two distinct activities without running Activity's constructor (it needs a Looper): only their identity counts. */
    static android.app.Activity bare() {
        try {
            java.lang.reflect.Field f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
            f.setAccessible(true);
            return (android.app.Activity) ((sun.misc.Unsafe) f.get(null)).allocateInstance(android.app.Activity.class);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
    public static void main(String[] a) {
        check(!ApprovalLock.isConfirmed("rt-a"), "a live session starts unconfirmed");
        ApprovalLock.confirm("rt-a");
        check(ApprovalLock.isConfirmed("rt-a"), "a confirmation covers its live session");
        check(!ApprovalLock.isConfirmed("rt-b"), "and no other live session, even of the same chat");
        ApprovalLock.confirm("");
        ApprovalLock.confirm(null);
        check(!ApprovalLock.isConfirmed("") && !ApprovalLock.isConfirmed(null), "'' and null are never confirmed");
        ApprovalLock.forget("rt-a");
        check(!ApprovalLock.isConfirmed("rt-a"), "forget drops it");
        ApprovalLock.forget(null);
        ApprovalLock.confirm("rt-a"); // a late ok of a prompt opened for rt-a, after it closed: files only rt-a
        check(ApprovalLock.isConfirmed("rt-a") && !ApprovalLock.isConfirmed("rt-a2"), "a late ok files only the live session its prompt was for");
        for (int i = 0; i < ApprovalLock.MAX; i++) ApprovalLock.confirm("rt-" + i);
        check(!ApprovalLock.isConfirmed("rt-a"), "past MAX the oldest asks again");
        check(ApprovalLock.isConfirmed("rt-0") && ApprovalLock.isConfirmed("rt-" + (ApprovalLock.MAX - 1)), "the newest MAX are kept");
        ApprovalLock.confirm("rt-0"); // seen again: the newest
        ApprovalLock.confirm("rt-x");
        check(ApprovalLock.isConfirmed("rt-0") && !ApprovalLock.isConfirmed("rt-1"), "a confirmation seen again becomes the newest");
        String once = ApprovalLock.grantFor("A", "r1", "once");
        ApprovalLock.fileGrant("g1", once, 1000);
        check(!ApprovalLock.takeGrant("g1", ApprovalLock.grantFor("A", "r2", "once"), 1001), "a grant never allows another request");
        check(!ApprovalLock.takeGrant("g1", once, 1001), "and is gone after any try: one fingerprint, one answer");
        ApprovalLock.fileGrant("g2", once, 1000);
        check(!ApprovalLock.takeGrant("g2", ApprovalLock.grantFor("A", "r1", "session"), 1001), "a grant for Allow once never allows the session");
        ApprovalLock.fileGrant("g3", once, 1000);
        check(!ApprovalLock.takeGrant("g3", ApprovalLock.grantFor("B", "r1", "once"), 1001), "nor another chat's request with the same id");
        ApprovalLock.fileGrant("g4", once, 1000);
        check(ApprovalLock.takeGrant("g4", once, 1000 + ApprovalLock.GRANT_MS), "the right request and choice, in time: allowed");
        check(!ApprovalLock.takeGrant("g4", once, 1001), "once only");
        ApprovalLock.fileGrant("g5", once, 1000);
        check(!ApprovalLock.takeGrant("g5", once, 1001 + ApprovalLock.GRANT_MS), "a stale grant allows nothing");
        ApprovalLock.fileGrant("g6", once, 1000);
        check(!ApprovalLock.takeGrant("g6", once, 999), "nor one from the future (the clock went back)");
        check(!ApprovalLock.takeGrant("", once, 1000) && !ApprovalLock.takeGrant(null, once, 1000) && !ApprovalLock.takeGrant("nope", once, 1000),
                "no grant, an empty or an unknown id: nothing");
        ApprovalLock.fileGrant("", once, 1000);
        ApprovalLock.fileGrant(null, once, 1000);
        check(!ApprovalLock.takeGrant("", once, 1000), "an empty id is never filed");
        for (int i = 0; i <= ApprovalLock.MAX_GRANTS; i++) ApprovalLock.fileGrant("m" + i, once, 1000);
        check(!ApprovalLock.takeGrant("m0", once, 1000) && ApprovalLock.takeGrant("m" + ApprovalLock.MAX_GRANTS, once, 1000), "at most MAX_GRANTS are kept, the oldest goes");
        check(!ApprovalLock.isConfirmed("") && !ApprovalLock.isConfirmed("A"), "a grant confirms no live session");
        // The screen-lock screen's result (Android 8-9): only the activity whose prompt is up, with that prompt's code.
        android.app.Activity main = bare(), panel = bare();
        java.util.List<String> closed = new java.util.ArrayList<>();
        ApprovalLock.closeScreen = (act, c) -> closed.add((act == main ? "main:" : "panel:") + c);
        String[] got = {null};
        int code = ApprovalLock.testCredentialPrompt(panel, r -> got[0] = r);
        check(ApprovalLock.isOurs(code) && code < 65536, "each prompt's request code is ours and fits 16 bits");
        ApprovalLock.onResult(main, code, android.app.Activity.RESULT_OK);
        check(got[0] == null, "a result arriving in another activity answers nothing");
        ApprovalLock.onResult(panel, code + 1 < ApprovalLock.REQ_BASE + ApprovalLock.REQ_SPAN ? code + 1 : code - 1, android.app.Activity.RESULT_OK);
        check(got[0] == null, "a result with another prompt's code answers nothing");
        ApprovalLock.onResult(panel, code, android.app.Activity.RESULT_OK);
        check("ok".equals(got[0]), "the prompt's own activity and code: ok");
        check(closed.isEmpty(), "an answered screen is not closed again");
        got[0] = null;
        ApprovalLock.onResult(panel, code, android.app.Activity.RESULT_OK);
        check(got[0] == null, "a second result for it answers nothing");
        String[] older = {null}, newer = {null};
        int oldCode = ApprovalLock.testCredentialPrompt(main, r -> older[0] = r);
        ApprovalLock.testCancel();
        check("cancel".equals(older[0]), "a cancelled prompt reports cancel");
        check(closed.equals(java.util.List.of("main:" + oldCode)), "and its screen-lock screen is closed (finishActivity with its own code)");
        older[0] = null;
        ApprovalLock.onResult(main, oldCode, android.app.Activity.RESULT_OK);
        check(older[0] == null, "a PIN typed on a cancelled prompt's screen answers nothing");
        int newCode = ApprovalLock.testCredentialPrompt(panel, r -> newer[0] = r);
        check(newCode != oldCode, "the next prompt has another code");
        check(newCode == ApprovalLock.REQ_BASE + Math.floorMod(oldCode - ApprovalLock.REQ_BASE + 1, ApprovalLock.REQ_SPAN),
                "each screen takes the next code, so all REQ_SPAN codes are used before one comes back");
        ApprovalLock.onResult(main, oldCode, android.app.Activity.RESULT_OK);
        ApprovalLock.onResult(panel, oldCode, android.app.Activity.RESULT_OK);
        check(newer[0] == null && older[0] == null, "a stale code, from either activity, never answers the newer prompt");
        ApprovalLock.onResult(panel, newCode, android.app.Activity.RESULT_CANCELED);
        check("cancel".equals(newer[0]), "the newer prompt's own cancel reaches it");
        check(ApprovalLock.codeFor(-1) >= ApprovalLock.REQ_BASE && !ApprovalLock.isOurs(45) && !ApprovalLock.isOurs(ApprovalLock.REQ_BASE + ApprovalLock.REQ_SPAN),
                "codes stay in their range; the app's other request codes are not ours");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -nowarn -proc:none -classpath "$JAR" -d "$T/classes" "$T"/src/com/omarqaterge/hermesmobile/*.java 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
java -cp "$T/classes:$JAR" com.omarqaterge.hermesmobile.ApprovalLockTest 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS'
exit "${PIPESTATUS[0]}"
