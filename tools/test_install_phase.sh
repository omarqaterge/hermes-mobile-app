#!/bin/bash
# Tests the install phases (android/.../InstallPhase.java) with a plain JDK: a second tap while Android's prompt waits
# must open that prompt again instead of starting a second session; an answer, a failure or a vanished session frees the
# next install. The first checks run a model of the old rule (a flag cleared when the commit call returns) and show its
# fault. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/InstallPhase.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/InstallPhaseTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import com.omarqaterge.hermesmobile.InstallPhase.Event;
import com.omarqaterge.hermesmobile.InstallPhase.Phase;
import com.omarqaterge.hermesmobile.InstallPhase.Retry;
public class InstallPhaseTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static Phase run(Phase p, Event... es) { for (Event e : es) p = InstallPhase.next(p, e); return p; }
    public static void main(String[] a) {
        // The old rule: "updating" is cleared when commit returns, so a tap while the prompt waits starts a session.
        boolean updating = true; int sessions = 1;
        updating = false; // commit returned, Android's prompt is still waiting
        if (!updating) sessions++; // second tap
        check(sessions == 2, "old rule: a second tap while the prompt waited started a second session");
        // The phases.
        Phase p = Phase.IDLE;
        check(InstallPhase.canStart(p) && InstallPhase.retry(p) == Retry.START, "idle: a new install may start");
        p = run(p, Event.REQUEST);
        check(p == Phase.DOWNLOADING && !InstallPhase.canStart(p) && InstallPhase.retry(p) == Retry.WAIT, "downloading: a tap waits");
        check(run(p, Event.REQUEST) == Phase.DOWNLOADING, "a second request while downloading changes nothing");
        p = run(p, Event.COMMIT_RETURNED);
        check(p == Phase.COMMITTED && InstallPhase.retry(p) == Retry.WAIT && InstallPhase.hasSession(p), "committed: a tap waits; Android holds a session");
        p = run(p, Event.PROMPT_ARRIVED);
        check(p == Phase.PROMPT_WAITING && !InstallPhase.canStart(p) && InstallPhase.retry(p) == Retry.SHOW_PROMPT, "prompt waiting: a tap opens that prompt, no second session");
        p = run(p, Event.PROMPT_OPENED);
        check(p == Phase.PROMPT_SHOWN && InstallPhase.retry(p) == Retry.SHOW_PROMPT, "prompt shown: a tap opens it again");
        check(run(p, Event.PROMPT_ARRIVED) == Phase.PROMPT_WAITING, "a repeated prompt re-arms it");
        check(run(p, Event.ANSWERED) == Phase.IDLE, "Android's answer (success, failure or cancel) frees the next install");
        check(run(p, Event.SESSION_GONE) == Phase.IDLE, "a session Android dropped with no answer frees it too");
        // The prompt arriving before commit() returns, then the commit returning.
        check(run(Phase.IDLE, Event.REQUEST, Event.PROMPT_ARRIVED, Event.COMMIT_RETURNED) == Phase.PROMPT_WAITING, "prompt before commit returned stays waiting");
        check(run(Phase.IDLE, Event.REQUEST, Event.COMMIT_RETURNED, Event.ANSWERED, Event.REQUEST) == Phase.DOWNLOADING, "after an answer a new request starts");
        check(run(Phase.DOWNLOADING, Event.FAILED) == Phase.IDLE, "a failed download frees it");
        check(run(Phase.IDLE, Event.PROMPT_ARRIVED) == Phase.IDLE, "a prompt nobody asked for (stale broadcast) starts nothing");
        check(run(Phase.IDLE, Event.PROMPT_OPENED, Event.COMMIT_RETURNED) == Phase.IDLE, "stray events leave idle alone");
        check(!InstallPhase.hasSession(Phase.IDLE) && !InstallPhase.hasSession(Phase.DOWNLOADING), "no session held while idle or downloading");
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.InstallPhaseTest
