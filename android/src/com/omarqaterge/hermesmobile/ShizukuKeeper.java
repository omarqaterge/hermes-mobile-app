package com.omarqaterge.hermesmobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Restarts Shizuku by itself (no root) after it stopped: on a Wi-Fi network, turn Wireless debugging on (this app holds
 * WRITE_SECURE_SETTINGS, granted by the installer), find its connect port with NsdManager, and ask Termux to run
 * ~/bin/hm-shizuku start PORT, which connects Termux's own paired adb and runs Shizuku's starter. Once Shizuku is up,
 * Wireless debugging is turned off again if we turned it on.
 *
 * Battery: nothing polls. Entered only from a down event (Shizuku's binder died) or the one 90 s check after the service
 * starts; at most KeeperPlan.ATTEMPTS Handler.postDelayed attempts per event (0, 30, 120 s) and MAX_RUNS_PER_HOUR events
 * per hour; one Wi-Fi NetworkCallback only while waiting for Wi-Fi; NsdManager discovery for at most 10 s. Everything is
 * removed when Shizuku is up or the service is destroyed. Decisions live in KeeperPlan (tested on a plain JVM).
 * All state is touched on the main thread only.
 */
final class ShizukuKeeper {
    private ShizukuKeeper() {
    }

    static final String TAG = "HMKeeper";
    static final String P_PAIRED = "shizuku_paired", P_LAST = "shizuku_last", P_DETAIL = "shizuku_detail",
            P_WD_OURS = "shizuku_wd_ours";
    static final String WSS = "android.permission.WRITE_SECURE_SETTINGS";
    static final String ADB_WIFI = "adb_wifi_enabled";
    static final String SERVICE_TYPE = "_adb-tls-connect._tcp";

    private static final Handler H = new Handler(Looper.getMainLooper());
    private static Context app;
    /** Next attempt (0-based) while a run is under way; -1 = idle. */
    private static int next = -1;
    /** Bumped whenever a run stops: late callbacks of an older attempt see a different number and do nothing. */
    private static int gen = 0;
    private static boolean fromCheck = false;
    private static final ArrayList<Long> runs = new ArrayList<>();
    private static ConnectivityManager.NetworkCallback wifiCb;
    private static NsdManager.DiscoveryListener nsdListener;
    private static ContentObserver allowObserver;

    private static final Runnable attemptTask = ShizukuKeeper::attempt;
    private static final Runnable finalCheck = ShizukuKeeper::finalCheck;
    private static final Runnable wdOffTask = ShizukuKeeper::wirelessDebuggingOff;
    private static final Runnable allowTimeout = ShizukuKeeper::stopAllowObserver;
    private static Runnable readbackTask, nsdTimeout;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("hermes", Context.MODE_PRIVATE);
    }

    // ── entry points (any thread) ──

    /** Shizuku is down: its binder died (check=false) or it isn't up 90 s after the service started (check=true). */
    static void onDown(Context ctx, boolean check) {
        Context a = ctx.getApplicationContext();
        H.post(() -> down(a, check));
    }

    /** Shizuku runs (again): stop everything, turn Wireless debugging off again if we turned it on. */
    static void onUp(Context ctx) {
        Context a = ctx.getApplicationContext();
        H.post(() -> up(a));
    }

    /** The service is going away: nothing of ours may keep running. */
    static void stop() {
        H.post(() -> {
            stopRun();
            H.removeCallbacks(wdOffTask);
        });
    }

    /** Event kind "shizuku-auto" from Termux's hm-shizuku: {paired, result, detail}. */
    static void onEvent(Context ctx, JSONObject e) {
        SharedPreferences.Editor ed = prefs(ctx).edit();
        if (e.has("paired")) ed.putBoolean(P_PAIRED, e.optBoolean("paired", false));
        String last = KeeperPlan.eventLast(e.optString("result", ""));
        if (!last.isEmpty()) ed.putString(P_LAST, last);
        String detail = e.optString("detail", "");
        ed.putString(P_DETAIL, detail.length() > 200 ? detail.substring(0, 200) : detail);
        ed.apply();
        Log.i(TAG, "shizuku-auto paired=" + e.opt("paired") + " result=" + last);
    }

    /** setupState.shizukuAuto: {sdk (Android 11+), wss, paired, last}. */
    static JSONObject state(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences p = prefs(ctx);
            o.put("sdk", Build.VERSION.SDK_INT >= 30);
            o.put("wss", wss(ctx));
            o.put("paired", p.getBoolean(P_PAIRED, false));
            o.put("last", p.getString(P_LAST, ""));
        } catch (Exception ignored) {
        }
        return o;
    }

    static boolean wss(Context ctx) {
        return ctx.checkSelfPermission(WSS) == PackageManager.PERMISSION_GRANTED;
    }

    // ── main thread ──

    private static void down(Context a, boolean check) {
        app = a;
        if (ShizukuProvider.running()) return;
        if (next >= 0 || wifiCb != null || allowObserver != null) return; // a run is already under way
        fromCheck = check;
        String why = KeeperPlan.blocker(HermesService.shizukuInstalled(a), Uninstall.started(a),
                HermesService.setup(a).installing(), Build.VERSION.SDK_INT, wss(a), MainActivity.termuxOk(a),
                prefs(a).getBoolean(P_PAIRED, false));
        if (why != null) {
            Log.i(TAG, "down (" + (check ? "90 s check" : "binder died") + "): can't act: " + why);
            setLast(why);
            if (KeeperPlan.userMustAct(why)) notice(why);
            return;
        }
        long now = System.currentTimeMillis();
        if (!KeeperPlan.runAllowed(runs, now)) {
            setLast("too-many");
            notice("too-many");
            return;
        }
        runs.add(now);
        while (runs.size() > KeeperPlan.MAX_RUNS_PER_HOUR) runs.remove(0);
        cancelNotice();
        Log.i(TAG, "down (" + (check ? "90 s check" : "binder died") + "): restarting Shizuku");
        if (!onWifi()) {
            waitForWifi();
            return;
        }
        begin(0);
    }

    private static void begin(long delay) {
        gen++;
        next = 0;
        H.postDelayed(attemptTask, delay);
    }

    private static void up(Context a) {
        app = a;
        boolean active = next >= 0 || wifiCb != null || allowObserver != null;
        stopRun();
        cancelNotice();
        String last = prefs(a).getString(P_LAST, "");
        if (active || "starting".equals(last)) setLast("ok");
        if (prefs(a).getBoolean(P_WD_OURS, false)) {
            H.removeCallbacks(wdOffTask);
            H.postDelayed(wdOffTask, KeeperPlan.WD_OFF_MS);
        }
    }

    private static void stopRun() {
        H.removeCallbacks(attemptTask);
        H.removeCallbacks(finalCheck);
        if (readbackTask != null) H.removeCallbacks(readbackTask);
        if (nsdTimeout != null) H.removeCallbacks(nsdTimeout);
        unregisterWifi();
        stopNsd();
        stopAllowObserver();
        next = -1;
        gen++;
    }

    // ── Wi-Fi ──

    private static boolean onWifi() {
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities c = cm.getNetworkCapabilities(n);
                if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return true;
            }
        } catch (Exception e) {
            Log.w(TAG, "Wi-Fi check failed: " + e);
        }
        return false;
    }

    /** No Wi-Fi: one callback until the first Wi-Fi network is available, then the attempts start. */
    private static void waitForWifi() {
        setLast("no-wifi");
        notice("no-wifi");
        if (wifiCb != null) return;
        wifiCb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                H.post(() -> {
                    if (wifiCb != this) return;
                    unregisterWifi();
                    if (ShizukuProvider.running()) return;
                    Log.i(TAG, "Wi-Fi available: starting attempts");
                    cancelNotice();
                    begin(KeeperPlan.WIFI_SETTLE_MS);
                });
            }
        };
        try {
            NetworkRequest req = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) // a Wi-Fi without internet is fine
                    .build();
            app.getSystemService(ConnectivityManager.class).registerNetworkCallback(req, wifiCb);
            Log.i(TAG, "not on Wi-Fi: waiting for it");
        } catch (Exception e) {
            Log.w(TAG, "Wi-Fi callback failed: " + e);
            wifiCb = null;
        }
    }

    private static void unregisterWifi() {
        if (wifiCb == null) return;
        try {
            app.getSystemService(ConnectivityManager.class).unregisterNetworkCallback(wifiCb);
        } catch (Exception ignored) {
        }
        wifiCb = null;
    }

    // ── one attempt: Wireless debugging on → read back → NsdManager → Termux ──

    private static void attempt() {
        if (ShizukuProvider.running()) {
            up(app);
            return;
        }
        final int i = next, g = gen;
        next = i + 1;
        long gap = KeeperPlan.delayBefore(i + 1);
        if (gap >= 0) H.postDelayed(attemptTask, gap);
        else H.postDelayed(finalCheck, KeeperPlan.FINAL_CHECK_MS);
        if (!onWifi()) { // Wi-Fi dropped between attempts: wait for it again
            stopRun();
            waitForWifi();
            return;
        }
        setLast("starting");
        Log.i(TAG, "attempt " + (i + 1) + "/" + KeeperPlan.ATTEMPTS);
        try {
            if (Settings.Global.getInt(app.getContentResolver(), ADB_WIFI, 0) != 1) {
                prefs(app).edit().putBoolean(P_WD_OURS, true).apply();
                Settings.Global.putInt(app.getContentResolver(), ADB_WIFI, 1);
                Log.i(TAG, "Wireless debugging turned on");
            }
        } catch (Exception e) { // permission taken back
            Log.w(TAG, "can't turn Wireless debugging on: " + e);
            stopRun();
            setLast("no-permission");
            notice("no-permission");
            return;
        }
        if (readbackTask != null) H.removeCallbacks(readbackTask);
        readbackTask = () -> {
            if (g != gen) return;
            int v = Settings.Global.getInt(app.getContentResolver(), ADB_WIFI, 0);
            if (KeeperPlan.untrusted(v)) {
                // Android asks "Allow wireless debugging on this network?" itself; we can't answer it. No retries: the
                // attempts stop, the notice says what to allow, and if the user allows it now this attempt carries on.
                Log.i(TAG, "Wireless debugging stays off: network not allowed yet");
                stopRun();
                setLast("untrusted-network");
                notice("untrusted-network");
                watchAllow();
                return;
            }
            discover(g);
        };
        H.postDelayed(readbackTask, KeeperPlan.READBACK_MS);
    }

    /** The user may tap Allow on Android's dialog right away: carry on once (observer gone after 2 min or on success). */
    private static void watchAllow() {
        stopAllowObserver();
        allowObserver = new ContentObserver(H) {
            @Override
            public void onChange(boolean selfChange) {
                if (Settings.Global.getInt(app.getContentResolver(), ADB_WIFI, 0) != 1) return;
                stopAllowObserver();
                if (ShizukuProvider.running()) return;
                Log.i(TAG, "network allowed: starting");
                cancelNotice();
                setLast("starting");
                gen++;
                next = KeeperPlan.ATTEMPTS; // this is the last try of the run
                H.postDelayed(finalCheck, KeeperPlan.FINAL_CHECK_MS);
                discover(gen);
            }
        };
        try {
            app.getContentResolver().registerContentObserver(Settings.Global.getUriFor(ADB_WIFI), false, allowObserver);
            H.postDelayed(allowTimeout, 120_000);
        } catch (Exception e) {
            allowObserver = null;
        }
    }

    private static void stopAllowObserver() {
        H.removeCallbacks(allowTimeout);
        if (allowObserver == null) return;
        try {
            app.getContentResolver().unregisterContentObserver(allowObserver);
        } catch (Exception ignored) {
        }
        allowObserver = null;
    }

    /** Find this phone's Wireless debugging port (bounded by NSD_MS), then start; no port → the script scans for it.
     *  Each candidate is checked on loopback first: NsdManager may still hold an earlier session's port. */
    private static void discover(final int g) {
        stopNsd();
        new Discovery(g).start();
    }

    private static final class Discovery {
        final int g;
        final NsdManager nsd = app.getSystemService(NsdManager.class);
        final long t0 = android.os.SystemClock.uptimeMillis();
        final Set<String> local = localHosts();
        final ArrayList<NsdServiceInfo> seen = new ArrayList<>();
        final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
        final ArrayList<String[]> found = new ArrayList<>();
        final Set<Integer> dead = new HashSet<>();
        boolean resolving = false, checking = false, done = false;
        final Runnable finish = () -> finish(0);
        final Runnable again = () -> {
            for (NsdServiceInfo s : seen) if (!queue.contains(s)) queue.add(s);
            resolveNext();
        };

        Discovery(int g) {
            this.g = g;
        }

        void start() {
            nsdTimeout = finish;
            nsdListener = new NsdManager.DiscoveryListener() {
                @Override
                public void onStartDiscoveryFailed(String type, int err) {
                    H.post(finish);
                }

                @Override
                public void onStopDiscoveryFailed(String type, int err) {
                }

                @Override
                public void onDiscoveryStarted(String type) {
                }

                @Override
                public void onDiscoveryStopped(String type) {
                }

                @Override
                public void onServiceFound(NsdServiceInfo s) {
                    H.post(() -> {
                        seen.add(s);
                        queue.add(s);
                        resolveNext();
                    });
                }

                @Override
                public void onServiceLost(NsdServiceInfo s) {
                }
            };
            try {
                nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, nsdListener);
            } catch (Exception e) {
                nsdListener = null;
                H.post(finish);
                return;
            }
            H.postDelayed(finish, KeeperPlan.NSD_MS);
        }

        void resolveNext() {
            if (done || resolving || queue.isEmpty()) return;
            resolving = true;
            NsdServiceInfo s = queue.poll();
            try {
                nsd.resolveService(s, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo si, int err) {
                        H.post(() -> {
                            resolving = false;
                            resolveNext();
                        });
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo si) {
                        H.post(() -> {
                            resolving = false;
                            InetAddress h = si.getHost();
                            found.add(new String[]{h == null ? null : h.getHostAddress(), String.valueOf(si.getPort())});
                            check();
                            resolveNext();
                        });
                    }
                });
            } catch (Exception e) {
                resolving = false;
            }
        }

        /** Try each untested local port on loopback (off the main thread); the first that accepts wins. */
        void check() {
            if (done || checking) return;
            final ArrayList<Integer> todo = new ArrayList<>();
            for (Integer p : KeeperPlan.localPorts(found, local)) if (!dead.contains(p)) todo.add(p);
            if (todo.isEmpty()) return;
            checking = true;
            new Thread(() -> {
                int open = 0;
                ArrayList<Integer> closed = new ArrayList<>();
                for (int p : todo) {
                    try (java.net.Socket so = new java.net.Socket()) {
                        so.connect(new java.net.InetSocketAddress("127.0.0.1", p), 500);
                        open = p;
                        break;
                    } catch (Exception e) {
                        closed.add(p);
                    }
                }
                final int port = open;
                H.post(() -> {
                    checking = false;
                    dead.addAll(closed);
                    if (!closed.isEmpty()) Log.i(TAG, "NsdManager port(s) " + closed + " not open (an earlier session)");
                    if (port > 0) {
                        finish(port);
                        return;
                    }
                    check(); // results that came in meanwhile
                    H.removeCallbacks(again);
                    if (!done) H.postDelayed(again, KeeperPlan.NSD_RETRY_MS); // resolve again: the record may update
                });
            }, "hermes-keeper-port").start();
        }

        void finish(int port) {
            if (done) return;
            done = true;
            H.removeCallbacks(finish);
            H.removeCallbacks(again);
            stopNsd();
            if (g != gen) return;
            Log.i(TAG, "NsdManager: " + found.size() + " resolved, port " + (port > 0 ? port : "none (script scans)")
                    + " after " + (android.os.SystemClock.uptimeMillis() - t0) + " ms");
            startInTermux(port);
        }
    }

    private static void stopNsd() {
        if (nsdListener == null) return;
        try {
            app.getSystemService(NsdManager.class).stopServiceDiscovery(nsdListener);
        } catch (Exception ignored) {
        }
        nsdListener = null;
    }

    /** This phone's own addresses (to tell its Wireless debugging from another phone's on the same Wi-Fi). */
    static Set<String> localHosts() {
        Set<String> s = new HashSet<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces()))
                for (InetAddress ad : Collections.list(ni.getInetAddresses())) {
                    String h = ad.getHostAddress();
                    if (h == null) continue;
                    int pct = h.indexOf('%');
                    s.add(pct > 0 ? h.substring(0, pct) : h);
                }
        } catch (Exception ignored) {
        }
        return s;
    }

    /** RUN_COMMAND, in the background, like HermesService.shareKeyWithTermux. Only a number is added to a fixed command. */
    private static void startInTermux(int port) {
        runInTermux(app, KeeperPlan.startScript(port), "hm-shizuku start " + (port > 0 ? port : ""));
    }

    /** Run a fixed KeeperPlan command in Termux (background RUN_COMMAND); false = not sent (Uninstall started, Termux
     *  never accepted a command, no RUN_COMMAND permission, or Android refused the intent). Also used by AdbPairing. */
    static boolean runInTermux(Context c, String script, String what) {
        if (c == null || script == null) return false;
        if (Uninstall.started(c) || !MainActivity.termuxOk(c)) return false;
        if (c.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return false;
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            c.startForegroundService(i);
            Log.i(TAG, "asked Termux: " + what);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "RUN_COMMAND failed: " + e);
            return false;
        }
    }

    private static void finalCheck() {
        if (ShizukuProvider.running()) {
            up(app);
            return;
        }
        Log.i(TAG, "Shizuku still not running after the last attempt");
        stopRun();
        setLast("failed");
        notice("failed");
        restoreWirelessDebugging(); // no reason to leave it on (Shizuku's own Start turns it on again when used)
    }

    /** Shizuku is up again: Wireless debugging goes back off if the keeper turned it on (owner decision D2). */
    private static void wirelessDebuggingOff() {
        if (app == null || !ShizukuProvider.running()) return;
        restoreWirelessDebugging();
    }

    private static void restoreWirelessDebugging() {
        if (app == null || !prefs(app).getBoolean(P_WD_OURS, false)) return;
        try {
            Settings.Global.putInt(app.getContentResolver(), ADB_WIFI, 0);
            Log.i(TAG, "Wireless debugging turned off again");
        } catch (Exception ignored) {
        }
        prefs(app).edit().remove(P_WD_OURS).apply();
    }

    // ── state + notice ──

    private static void setLast(String last) {
        prefs(app).edit().putString(P_LAST, last).apply();
    }

    private static void notice(String why) {
        HermesService.shizukuNotice(app, fromCheck ? "Shizuku isn\u2019t running" : "Shizuku stopped",
                KeeperPlan.noticeText(why), KeeperPlan.opensApp(why));
    }

    private static void cancelNotice() {
        try {
            app.getSystemService(android.app.NotificationManager.class).cancel(HermesService.SHIZUKU_ID);
        } catch (Exception ignored) {
        }
    }
}
