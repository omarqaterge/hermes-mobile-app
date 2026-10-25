package com.omarqaterge.hermesmobile;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The dashboard's session token. phone/hermes-services mints it in Termux (~/.hermes-mobile/dash-token, 0600) and Hermes
 * keeps it out of its page (hermes/patches/0004): any app on the phone can open 127.0.0.1:9119, and the page used to
 * hand the token, and with it all of Hermes, to whoever asked. This app reads the file through Termux (RUN_COMMAND; the
 * answer comes back through a PendingIntent of ours) and keeps it in its own prefs. A Hermes that still puts the token
 * in its page (the patch not applied, an older hermes-services) is read from there as before.
 * Blocking (loopback HTTP, a Termux round trip of ~30-200 ms on a miss): never on the main thread.
 */
final class DashToken {
    static final String ACTION = "com.omarqaterge.hermesmobile.DASH_TOKEN";
    /** Fixed: nothing from the page reaches it. */
    static final String SCRIPT = "cat ~/.hermes-mobile/dash-token 2>/dev/null; true";
    static final Pattern HEX = Pattern.compile("[0-9a-f]{32,128}");
    /** Asking Termux spawns a shell: one ask in flight, and not again within this gap (an empty answer is kept). */
    static final long ASK_GAP_MS = 5000;
    static final long WAIT_MS = 6000;
    /** A token-checked route that only reads a small file. */
    static final String CHECK_PATH = "/api/plugins/hermes-mobile/activity";

    private static final Object LOCK = new Object();
    private static Handler handler;
    private static CountDownLatch answer;
    private static String nonce = "";
    private static String answered = "";
    private static long askedAt;

    private DashToken() {
    }

    /** The token, or "" while Hermes is down or Termux can't say. refresh: the caller's token may be stale (a 401, a
     *  reconnect): check the stored one and ask Termux again if it no longer works. */
    static String get(Context c, boolean refresh) {
        Context app = c.getApplicationContext();
        String html = MainActivity.httpGet(MainActivity.BASE_URL + "/");
        if (html == null) return stored(app); // Hermes is down: nothing to ask Termux about yet
        MainActivity.setTermuxOk(app); // the dashboard answers: Termux runs Hermes
        Matcher m = MainActivity.TOKEN.matcher(html);
        if (m.find()) return m.group(1); // a Hermes that still puts it in its page
        String t = stored(app);
        if (!t.isEmpty() && !(refresh && !works(t))) return t;
        String fresh = askTermux(app);
        if (fresh.isEmpty()) return t;
        app.getSharedPreferences("hermes", Context.MODE_PRIVATE).edit().putString("dash_token", fresh).apply();
        return fresh;
    }

    static String stored(Context app) {
        return app.getSharedPreferences("hermes", Context.MODE_PRIVATE).getString("dash_token", "");
    }

    /** False only when the dashboard refuses the token (no answer at all says nothing about it). */
    static boolean works(String t) {
        try {
            String code = MainActivity.rawHttp("GET", CHECK_PATH, t, null)[0];
            return !"401".equals(code) && !"403".equals(code);
        } catch (Exception e) {
            return true;
        }
    }

    /** cat the token file through Termux; "" when Termux doesn't answer in time or the file isn't there. */
    static String askTermux(Context app) {
        if (app.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return "";
        CountDownLatch wait;
        synchronized (LOCK) {
            long now = System.currentTimeMillis();
            if (answer != null && answer.getCount() > 0) {
                wait = answer; // one ask in flight: wait for its answer
            } else if (now - askedAt < ASK_GAP_MS) {
                return answered;
            } else {
                askedAt = now;
                answered = "";
                wait = answer = new CountDownLatch(1);
                byte[] r = new byte[16];
                new java.security.SecureRandom().nextBytes(r);
                StringBuilder n = new StringBuilder();
                for (byte x : r) n.append(String.format("%02x", x));
                nonce = n.toString();
                try {
                    listen(app);
                    // The nonce rides in the PendingIntent, which only this app and Termux see: before Android 13 a
                    // runtime receiver is exported, and a forged broadcast must not plant a token.
                    PendingIntent pend = PendingIntent.getBroadcast(app, 4712,
                            new Intent(ACTION).setPackage(app.getPackageName()).putExtra("nonce", nonce),
                            PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    Intent i = new Intent();
                    i.setClassName("com.termux", "com.termux.app.RunCommandService");
                    i.setAction("com.termux.RUN_COMMAND");
                    i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
                    i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", SCRIPT});
                    i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
                    i.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pend);
                    app.startForegroundService(i);
                } catch (Exception e) {
                    answer.countDown();
                    return "";
                }
            }
        }
        try {
            wait.await(WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        synchronized (LOCK) {
            return answered;
        }
    }

    /** The answer arrives on a thread of its own, so a caller blocked anywhere (even the main thread) can't stall it. */
    private static void listen(Context app) {
        if (handler != null) return;
        HandlerThread t = new HandlerThread("hm-dashtoken");
        t.start();
        handler = new Handler(t.getLooper());
        BroadcastReceiver rx = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent in) {
                Bundle b = in.getBundleExtra("result");
                String out = b == null ? "" : String.valueOf(b.getString("stdout", "")).trim();
                synchronized (LOCK) {
                    if (nonce.isEmpty() || !nonce.equals(in.getStringExtra("nonce"))) return;
                    nonce = "";
                    answered = HEX.matcher(out).matches() ? out : "";
                    if (answer != null) answer.countDown();
                }
            }
        };
        app.registerReceiver(rx, new IntentFilter(ACTION), null, handler, Build.VERSION.SDK_INT >= 33 ? Context.RECEIVER_NOT_EXPORTED : 0);
    }
}
