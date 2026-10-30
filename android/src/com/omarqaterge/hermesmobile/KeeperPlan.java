package com.omarqaterge.hermesmobile;

import java.util.List;
import java.util.Set;

/**
 * The Shizuku keeper's decisions as plain functions (no Android classes), so tools/test_shizuku_keeper.sh can test
 * them with a plain JDK. ShizukuKeeper does the Android side (settings, Wi-Fi callback, NsdManager, Termux).
 *
 * "last" words (stored in prefs, shown to the page as setupState.shizukuAuto.last): the first failing precondition
 * (not-installed, uninstalling, installing, old-android, no-permission, no-termux, unpaired), or what happened on the
 * last try: no-wifi, untrusted-network, starting, ok, failed, too-many, or the result word of the last shizuku-auto
 * event from Termux's hm-shizuku script (ok, no-wifi, no-port, failed…).
 */
final class KeeperPlan {
    private KeeperPlan() {
    }

    static final int ATTEMPTS = 3;
    /** The one check after the service starts (after a reboot Shizuku doesn't start by itself, so no binder arrives).
     *  Counted in real time (an alarm on the elapsed-realtime clock), not CPU-awake time: a phone left asleep after a
     *  reboot with Wi-Fi off would otherwise push the "Not on Wi-Fi" notice back by every minute it slept. */
    static final long CHECK_MS = 90_000;
    /** Attempt i runs this long after the previous one (the first at once): 0, 30, 120 s after the down event. */
    private static final long[] GAP_MS = {0, 30_000, 90_000};
    /** After the last attempt: still no Shizuku → "failed" and the notice. */
    static final long FINAL_CHECK_MS = 60_000;
    /** Wait this long after putInt(adb_wifi_enabled, 1) before reading it back. */
    static final long READBACK_MS = 2_000;
    /** NsdManager discovery + resolve, at most. */
    static final long NSD_MS = 10_000;
    /** Only stale ports so far: resolve the found services again after this long (inside NSD_MS). */
    static final long NSD_RETRY_MS = 1_000;
    /** Wi-Fi just came up: give Android a moment before asking for Wireless debugging. */
    static final long WIFI_SETTLE_MS = 3_000;
    /** Wireless debugging is turned off again this long after Shizuku is up (its start script may still be checking). */
    static final long WD_OFF_MS = 10_000;
    /** Down events handled per hour, at most: a Shizuku that dies right after each start can't make the keeper loop. */
    static final int MAX_RUNS_PER_HOUR = 5;

    /** What the user typed into the Pairing notification (AdbPairing). */
    static final class PairReply {
        final String code;
        final int port; // 0 = not typed

        PairReply(String code, int port) {
            this.code = code;
            this.port = port;
        }
    }

    /** The Termux command for one pairing; null unless port is 1-65535 and code is exactly 6 digits. */
    static String pairScript(int port, String code) {
        if (port < 1 || port > 65535 || code == null || !code.matches("[0-9]{6}")) return null;
        return "[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku pair " + port + " " + code;
    }

    /** What the user typed into the Pairing notification: the 6-digit code, optionally the port (the number after the
     *  colon under the code). A code typed with spaces ("123 456") counts. null = no code in it. */
    static PairReply parsePairReply(String text) {
        if (text == null) return null;
        String[] parts = text.trim().split("[^0-9]+");
        String code = null;
        for (String p : parts) if (p.length() == 6) { code = p; break; }
        if (code == null) {
            String all = text.replaceAll("[^0-9]", "");
            if (all.length() == 6) code = all; else return null;
        }
        int port = 0;
        for (String p : parts) {
            if (p.equals(code) || p.length() < 4 || p.length() > 5) continue;
            int v = Integer.parseInt(p);
            if (v >= 1024 && v <= 65535) port = v; // the last one wins (ip:port pasted)
        }
        return new PairReply(code, port);
    }

    /** A shizuku-auto event as the answer to a pairing: 1 paired, -1 failed, 0 not a pairing answer. */
    static int pairResult(String cmd, String result, boolean paired) {
        if (!"pair".equals(cmd)) return 0;
        return "ok".equals(result) && paired ? 1 : -1;
    }

    /** Why the keeper can't restart Shizuku by itself, or null when it can (checked in this order). */
    static String blocker(boolean installed, boolean uninstalling, boolean installing, int sdk, boolean wss,
                          boolean termuxOk, boolean paired) {
        if (!installed) return "not-installed";
        if (uninstalling) return "uninstalling";
        if (installing) return "installing";
        if (sdk < 30) return "old-android"; // Wireless debugging is Android 11+
        if (!wss) return "no-permission";
        if (!termuxOk) return "no-termux";
        if (!paired) return "unpaired";
        return null;
    }

    /** True when this outcome means the user has to do something: show the Shizuku notice with the reason. */
    static boolean userMustAct(String last) {
        if (last == null) return false;
        switch (last) {
            case "old-android":
            case "no-permission":
            case "no-termux":
            case "unpaired":
            case "no-wifi":
            case "untrusted-network":
            case "failed":
            case "too-many":
                return true;
            default:
                return false;
        }
    }

    /** The notice's text for a reason (title stays "Shizuku stopped" / "Shizuku isn't running"). */
    static String noticeText(String last) {
        switch (last == null ? "" : last) {
            case "no-wifi":
                return "Not on Wi-Fi. It starts again by itself once the phone is on Wi-Fi.";
            case "untrusted-network":
                return "Allow wireless debugging on this network (tick Always allow), then Shizuku starts by itself next time.";
            case "no-permission":
            case "no-termux":
            case "unpaired":
                return "Shizuku isn\u2019t set up to start by itself. Open Hermes Mobile \u2192 Setup check \u2192 Start pairing.";
            case "failed":
                return "Hermes couldn\u2019t start it by itself. Tap to open Shizuku and start it.";
            case "too-many":
                return "It stopped again right after each start. Tap to open Shizuku and start it.";
            default:
                return "Hermes can\u2019t see or use the screen until you start Shizuku again.";
        }
    }

    /** The notice opens Hermes Mobile (to finish the set-up) instead of Shizuku. */
    static boolean opensApp(String last) {
        return "no-permission".equals(last) || "no-termux".equals(last) || "unpaired".equals(last);
    }

    /** Delay before attempt i (0-based) counted from the previous attempt; -1 = no such attempt. */
    static long delayBefore(int i) {
        return i < 0 || i >= ATTEMPTS ? -1 : GAP_MS[i];
    }

    /** Another down event may start attempts: fewer than MAX_RUNS_PER_HOUR started in the last hour. */
    static boolean runAllowed(List<Long> starts, long now) {
        int n = 0;
        for (Long t : starts) if (t != null && now - t < 3_600_000L) n++;
        return n < MAX_RUNS_PER_HOUR;
    }

    /** adb_wifi_enabled read back after we set it: 0 = Android asked the user first (a network not allowed yet). */
    static boolean untrusted(int readBack) {
        return readBack != 1;
    }

    /** The connect port of this phone's own Wireless debugging among NsdManager results {host, port}; 0 = none
     *  (another phone on the same Wi-Fi advertises the same service type; hm-shizuku then scans). */
    static int pickPort(List<String[]> services, Set<String> localHosts) {
        List<Integer> l = localPorts(services, localHosts);
        return l.isEmpty() ? 0 : l.get(0);
    }

    /** Every distinct port this phone advertises, newest result first: NsdManager can still hold the port of an earlier
     *  Wireless debugging session (seen on the emulator), so ShizukuKeeper checks each one on loopback. */
    static List<Integer> localPorts(List<String[]> services, Set<String> localHosts) {
        java.util.ArrayList<Integer> out = new java.util.ArrayList<>();
        for (int k = services.size() - 1; k >= 0; k--) {
            String[] s = services.get(k);
            if (s == null || s.length < 2 || s[0] == null || s[1] == null) continue;
            String host = s[0].startsWith("/") ? s[0].substring(1) : s[0];
            int pct = host.indexOf('%');
            if (pct > 0) host = host.substring(0, pct);
            int port;
            try {
                port = Integer.parseInt(s[1]);
            } catch (NumberFormatException e) {
                continue;
            }
            if (port < 1 || port > 65535 || !localHosts.contains(host) || out.contains(port)) continue;
            out.add(port);
        }
        return out;
    }

    /** The fixed command Termux runs; only a number from NsdManager is added. */
    static String startScript(int port) {
        String base = "[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku start";
        return port >= 1 && port <= 65535 ? base + " " + port : base;
    }

    /** The result word of a shizuku-auto event, kept as "last": a short lowercase word, else "failed". */
    static String eventLast(String result) {
        if (result == null || result.isEmpty()) return "";
        return result.matches("[a-z][a-z-]{0,23}") ? result : "failed";
    }
}
