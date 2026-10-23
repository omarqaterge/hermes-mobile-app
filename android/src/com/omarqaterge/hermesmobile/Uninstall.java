package com.omarqaterge.hermesmobile;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import org.json.JSONObject;

/**
 * Settings → Uninstall Hermes, native half. (1) The Termux-side cleanup: phone/uninstall.sh, shipped in the APK
 * (assets/phone/uninstall.sh, copied by android/build.sh), run through Termux's RUN_COMMAND with a result PendingIntent;
 * only fixed flags and a JSON object of the app's settings reach it, as argv (never as code). (2) The apps: Android's own
 * uninstall prompt (ACTION_DELETE, REQUEST_DELETE_PACKAGES), one fixed package per name. Once a cleanup has run,
 * Hermes is never started again by this app (startHermesNow, shareKeyWithTermux check started()).
 */
final class Uninstall {
    static final String ACTION = "com.omarqaterge.hermesmobile.UNINSTALL_RESULT";
    static final String PREFS = "hermes";
    static final String ASSET = "phone/uninstall.sh";
    static final String BASH = "/data/data/com.termux/files/usr/bin/bash";
    /** The cleanup may run for minutes (removing Debian); after this long without an answer it counts as lost. */
    static final long LOST_MS = 20 * 60_000L;
    static final int MAX_SETTINGS = 64_000;

    static volatile boolean running = false;
    static volatile long runningSince = 0;
    static boolean receiverOn = false;

    /** The apps the flow may remove, by fixed name (the page never passes a package name). */
    static String pkg(Context c, String which) {
        if (which == null) return null;
        switch (which) {
            case "termux-api": return "com.termux.api";
            case "termux-boot": return "com.termux.boot";
            case "shizuku": return "moe.shizuku.privileged.api";
            case "termux": return "com.termux";
            case "self": return c.getPackageName();
            default: return null;
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** A cleanup was started and may have removed something: don't start Hermes or write into Termux any more. */
    static boolean started(Context c) {
        return prefs(c).getBoolean("uninstall_started", false);
    }

    /** argv for `bash -c SCRIPT`: fixed flags, plus the settings JSON (an object, size-capped) as one argument.
     *  Null when the settings aren't a JSON object. */
    static String[] args(String script, boolean backup, boolean keys, String settings) {
        ArrayList<String> a = new ArrayList<>();
        a.add("-c");
        a.add(script);
        a.add("hm-uninstall");
        if (backup) {
            a.add("--backup");
            if (keys) a.add("--keys");
            if (settings != null && !settings.isEmpty()) {
                if (settings.length() > MAX_SETTINGS) return null;
                try {
                    new JSONObject(settings);
                } catch (Exception e) {
                    return null;
                }
                a.add("--settings");
                a.add(settings);
            }
        }
        return a.toArray(new String[0]);
    }

    static String script(Context c) {
        try (InputStream in = c.getAssets().open(ASSET)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    static boolean installed(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Start the Termux-side cleanup. "ok", or why not ("busy", "no-termux", "no-permission", "error: …"). */
    static synchronized String run(Context ctx, boolean backup, boolean keys, String settings) {
        final Context app = ctx.getApplicationContext();
        if (running && System.currentTimeMillis() - runningSince < LOST_MS) return "busy";
        if (!installed(app, "com.termux")) return "no-termux";
        if (app.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return "no-permission";
        String s = script(app);
        if (s == null) return "error: this app build has no uninstall script";
        String[] argv = args(s, backup, keys, settings);
        if (argv == null) return "error: bad settings";
        if (!receiverOn) {
            BroadcastReceiver rx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent in) {
                    done(c, in.getBundleExtra("result"));
                }
            };
            IntentFilter f = new IntentFilter(ACTION);
            // The application context: the answer still lands when the activity was recreated meanwhile.
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);
            else app.registerReceiver(rx, f);
            receiverOn = true;
        }
        try {
            PendingIntent pend = PendingIntent.getBroadcast(app, 4713, new Intent(ACTION).setPackage(app.getPackageName()),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", BASH);
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", argv);
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            i.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pend);
            // Before sending: from here on nothing restarts Hermes behind the cleanup's back.
            prefs(app).edit().putBoolean("uninstall_started", true).remove("uninstall_result").apply();
            running = true;
            runningSince = System.currentTimeMillis();
            app.startForegroundService(i);
            return "ok";
        } catch (Exception e) {
            running = false;
            prefs(app).edit().putBoolean("uninstall_started", prefs(app).getBoolean("uninstall_removed", false)).apply();
            return "error: " + e.getMessage();
        }
    }

    /** Termux's answer: {exit, stdout, stderr, err, errmsg}. Exit 3 (or Termux refusing) = nothing was removed. */
    static void done(Context c, Bundle b) {
        running = false;
        JSONObject o = new JSONObject();
        int exit = -1;
        try {
            int err = b == null ? 1 : b.getInt("err", -1);
            exit = b == null ? -1 : b.getInt("exitCode", -1);
            o.put("exit", err > 0 ? -1 : exit);
            o.put("stdout", tail(b == null ? "" : String.valueOf(b.getString("stdout", "")), 24_000));
            o.put("stderr", tail(b == null ? "" : String.valueOf(b.getString("stderr", "")), 4_000));
            o.put("err", err);
            o.put("errmsg", b == null ? "no answer" : String.valueOf(b.getString("errmsg", "")));
            if (err > 0) exit = -1;
        } catch (Exception ignored) {
        }
        SharedPreferences p = prefs(c);
        boolean removed = p.getBoolean("uninstall_removed", false) || exit == 0 || exit == 1;
        p.edit().putString("uninstall_result", o.toString()).putBoolean("uninstall_removed", removed)
                .putBoolean("uninstall_started", removed).apply();
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(() -> {
            if (a.web != null) a.web.evaluateJavascript("window.hermesUninstallDone && window.hermesUninstallDone()", null);
        });
    }

    static String tail(String s, int max) {
        return s.length() <= max ? s : s.substring(s.length() - max);
    }

    /** {"started":…, "running":…, "removed":…, "result":{…}|null} for the page. */
    static String state(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            boolean live = running && System.currentTimeMillis() - runningSince < LOST_MS;
            o.put("started", p.getBoolean("uninstall_started", false));
            o.put("running", live);
            o.put("removed", p.getBoolean("uninstall_removed", false));
            String r = p.getString("uninstall_result", null);
            o.put("result", r == null ? JSONObject.NULL : new JSONObject(r));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Android's uninstall prompt for one of the fixed apps. False = not one of them, or not installed. */
    static boolean uninstallApp(Activity a, String which) {
        String pkg = pkg(a, which);
        if (pkg == null || !installed(a, pkg)) return false;
        a.runOnUiThread(() -> {
            try {
                a.startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg)));
            } catch (Exception ignored) {
            }
        });
        return true;
    }
}
