#!/bin/bash
# Tests the Shizuku keeper's decisions (android/.../KeeperPlan.java) with a plain JDK: when the app may restart Shizuku
# by itself, what the notice says when it can't, the bounded attempt schedule, the NsdManager port choice and the
# Termux command. Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/KeeperPlan.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/KeeperPlanTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.*;
public class KeeperPlanTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static boolean eq(Object a, Object b) { return Objects.equals(a, b); }
    // installed, uninstalling, installing, sdk, wss, termuxOk, paired
    static String b(boolean in, boolean un, boolean ing, int sdk, boolean wss, boolean tok, boolean p) {
        return KeeperPlan.blocker(in, un, ing, sdk, wss, tok, p);
    }
    public static void main(String[] a) {
        // preconditions, in order
        check(b(true, false, false, 35, true, true, true) == null, "all set → the keeper may act");
        check(eq(b(false, false, false, 35, true, true, true), "not-installed"), "Shizuku not installed → not-installed");
        check(eq(b(true, true, false, 35, true, true, true), "uninstalling"), "Uninstall started → uninstalling");
        check(eq(b(true, false, true, 35, true, true, true), "installing"), "installer running → installing");
        check(eq(b(true, false, false, 29, true, true, true), "old-android"), "Android 10 (SDK 29) → old-android");
        check(b(true, false, false, 30, true, true, true) == null, "Android 11 (SDK 30) is enough");
        check(eq(b(true, false, false, 35, false, true, true), "no-permission"), "WRITE_SECURE_SETTINGS missing → no-permission");
        check(eq(b(true, false, false, 35, true, false, true), "no-termux"), "Termux never accepted a command → no-termux");
        check(eq(b(true, false, false, 35, true, true, false), "unpaired"), "Termux adb not paired → unpaired");
        check(eq(b(true, true, true, 29, false, false, false), "uninstalling"), "several fail → the first one is reported");

        // who gets a notice
        for (String r : new String[]{"old-android", "no-permission", "no-termux", "unpaired", "no-wifi", "untrusted-network", "failed", "too-many"})
            check(KeeperPlan.userMustAct(r), r + " → notice");
        for (String r : new String[]{"not-installed", "installing", "uninstalling", "starting", "ok", null, ""})
            check(!KeeperPlan.userMustAct(r), r + " → no notice");

        // notice text: the reason, in plain words, no vendor names
        check(KeeperPlan.noticeText("no-wifi").contains("Wi-Fi"), "no-wifi text mentions Wi-Fi");
        check(KeeperPlan.noticeText("untrusted-network").contains("Allow wireless debugging on this network"), "untrusted text says what to allow");
        check(KeeperPlan.noticeText("unpaired").contains("isn\u2019t set up to start by itself"), "unpaired text: not set up to start by itself");
        check(KeeperPlan.noticeText("no-permission").contains("isn\u2019t set up to start by itself"), "no-permission text: not set up to start by itself");
        check(KeeperPlan.noticeText("failed").contains("couldn\u2019t start"), "failed text: couldn't start");
        check(KeeperPlan.noticeText("old-android").contains("start Shizuku again"), "old Android keeps the old text");
        for (String r : new String[]{"no-wifi", "untrusted-network", "unpaired", "no-permission", "no-termux", "failed", "too-many", "old-android"}) {
            String t = KeeperPlan.noticeText(r).toLowerCase(Locale.ROOT);
            check(!t.isEmpty() && !t.contains("xiaomi") && !t.contains("hyperos") && !t.contains("miui") && !t.contains("samsung"), r + " text is vendor-neutral");
        }
        check(KeeperPlan.opensApp("unpaired") && KeeperPlan.opensApp("no-permission") && KeeperPlan.opensApp("no-termux"), "set-up problems open Hermes Mobile");
        check(!KeeperPlan.opensApp("failed") && !KeeperPlan.opensApp("old-android"), "failed / old Android open Shizuku");

        // bounded attempts: 0 s, 30 s, 120 s after the down event, then one final check, then nothing
        check(KeeperPlan.ATTEMPTS == 3, "3 attempts per down event");
        check(KeeperPlan.delayBefore(0) == 0 && KeeperPlan.delayBefore(1) == 30_000 && KeeperPlan.delayBefore(2) == 90_000,
                "attempt delays 0 / +30 s / +90 s (= 0, 30, 120 s)");
        check(KeeperPlan.delayBefore(3) == -1 && KeeperPlan.delayBefore(4) == -1 && KeeperPlan.delayBefore(-1) == -1, "no 4th attempt");
        check(KeeperPlan.FINAL_CHECK_MS > 0 && KeeperPlan.FINAL_CHECK_MS <= 120_000, "final check comes within 2 min of the last attempt");
        long total = 0; for (int i = 0; i < KeeperPlan.ATTEMPTS; i++) total += KeeperPlan.delayBefore(i);
        check(total + KeeperPlan.FINAL_CHECK_MS <= 5 * 60_000, "a whole down event is over within 5 min");

        // down events per hour are capped (Shizuku dying right after each start can't make the keeper loop)
        List<Long> starts = new ArrayList<>();
        long now = 10_000_000L;
        for (int i = 0; i < KeeperPlan.MAX_RUNS_PER_HOUR; i++) {
            check(KeeperPlan.runAllowed(starts, now + i * 60_000L), "run " + (i + 1) + " in an hour allowed");
            starts.add(now + i * 60_000L);
        }
        check(!KeeperPlan.runAllowed(starts, now + 10 * 60_000L), "one more run within the hour refused");
        check(KeeperPlan.runAllowed(starts, now + 61 * 60_000L + KeeperPlan.MAX_RUNS_PER_HOUR * 60_000L), "allowed again after an hour");

        // Wireless debugging read back after putInt: 0 = Android asked the user (untrusted network)
        check(KeeperPlan.untrusted(0) && !KeeperPlan.untrusted(1), "read-back 0 → untrusted, 1 → on");

        // NsdManager result → port: only a service on this phone; none → 0 (the script scans)
        Set<String> local = new HashSet<>(Arrays.asList("10.0.2.16", "127.0.0.1", "fe80::1"));
        check(KeeperPlan.pickPort(Arrays.asList(new String[]{"10.0.2.16", "37709"}), local) == 37709, "this phone's service → its port");
        check(KeeperPlan.pickPort(Arrays.asList(new String[]{"192.168.1.9", "40001"}, new String[]{"10.0.2.16", "37709"}), local) == 37709,
                "another phone's service on the Wi-Fi is skipped");
        check(KeeperPlan.pickPort(Arrays.asList(new String[]{"192.168.1.9", "40001"}), local) == 0, "only other phones → 0 (scan)");
        check(KeeperPlan.pickPort(Collections.emptyList(), local) == 0, "nothing found → 0 (scan)");
        check(KeeperPlan.pickPort(Arrays.asList(new String[]{"10.0.2.16", "99999"}, new String[]{"10.0.2.16", "x"}, new String[]{null, "5555"}), local) == 0,
                "bad ports / hosts ignored");
        check(KeeperPlan.pickPort(Arrays.asList(new String[]{"/10.0.2.16", "41000"}), local) == 41000, "InetAddress.toString() form (/ip) matches");

        // the Termux command: fixed text + a number, nothing else
        check(eq(KeeperPlan.startScript(37709), "[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku start 37709"), "start with the port");
        check(eq(KeeperPlan.startScript(0), "[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku start"), "no port → the script scans");
        check(eq(KeeperPlan.startScript(70000), KeeperPlan.startScript(0)) && eq(KeeperPlan.startScript(-3), KeeperPlan.startScript(0)), "out-of-range port dropped");
        check(eq(KeeperPlan.PAIR_SCRIPT, "[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku pair"), "pair command");

        // shizuku-auto event → stored last (only known words; anything else is kept short and safe)
        check(eq(KeeperPlan.eventLast("ok"), "ok") && eq(KeeperPlan.eventLast("no-wifi"), "no-wifi") && eq(KeeperPlan.eventLast("no-port"), "no-port")
                && eq(KeeperPlan.eventLast("failed"), "failed"), "event results kept as they are");
        check(eq(KeeperPlan.eventLast("<script>"), "failed") && eq(KeeperPlan.eventLast(""), "") && eq(KeeperPlan.eventLast(null), ""),
                "unknown result → failed, empty → nothing");

        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.KeeperPlanTest
