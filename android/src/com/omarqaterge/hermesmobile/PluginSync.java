package com.omarqaterge.hermesmobile;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import org.json.JSONObject;

/**
 * Keeps the Hermux plugin in Debian at the version shipped inside this APK (assets/phone/plugin.tgz, plugin.txt and
 * plugin-update.sh, packed by android/build.sh). The script runs in Termux through RUN_COMMAND with a result
 * PendingIntent; it fetches the bundle from HermesService's loopback port with a one-time token and checks it against
 * the checksum in plugin.txt, so only what this APK holds is installed. Checked once per service start (at most every
 * 6 h, or at once after an app update); the update itself runs only when Hermes reports no work, no approval or
 * question is open, and the app isn't on screen (or the user tapped Update in Settings → About). A failed attempt
 * leaves the old plugin in place; after MAX_TRIES failures for one version only the user's tap tries again. No timer:
 * each attempt is started by an event (service start, a turn ending, leaving the app, a tap).
 */
final class PluginSync {
    static final String ACTION = "com.omarqaterge.hermesmobile.PLUGIN_RESULT";
    static final String SCRIPT = "phone/plugin-update.sh", BUNDLE = "phone/plugin.tgz", INFO = "phone/plugin.txt";
    static final String BASH = "/data/data/com.termux/files/usr/bin/bash";
    /** An apply waits up to ~5 minutes for Hermes to come back; after this long without an answer it counts as lost. */
    static final long LOST_MS = 12 * 60_000L;
    static final long CHECK_EVERY_MS = 6 * 3600_000L;
    /** After "Hermes is working" from the script: the next try waits at least this long. */
    static final long BUSY_GAP_MS = 2 * 60_000L;
    static final int MAX_TRIES = 3;

    static volatile boolean running = false;
    static volatile long runningSince = 0;
    static volatile String runningMode = "";
    /** The one-time token for GET /plugin-bundle/<token>; null when no apply is running or it was used. */
    static volatile String token = null;
    static boolean receiverOn = false;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("hermes", Context.MODE_PRIVATE);
    }

    /** {stamp, hash, sha} of the APK's plugin, or null in a build without one. */
    static String[] apk(Context c) {
        String s = asset(c, INFO);
        if (s == null) return null;
        String[] p = s.trim().split("\\s+");
        if (p.length < 3 || !p[0].matches("\\d{1,12}") || !p[1].matches("[0-9a-f]{64}") || !p[2].matches("[0-9a-f]{64}")) return null;
        return p;
    }

    static String asset(Context c, String name) {
        byte[] b = assetBytes(c, name);
        return b == null ? null : new String(b, StandardCharsets.UTF_8);
    }

    static byte[] assetBytes(Context c, String name) {
        try (InputStream in = c.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    static long versionCode(Context c) {
        try {
            android.content.pm.PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Termux may run our commands and nothing stands in the way (setup running, Uninstall started). */
    static boolean canRun(Context c) {
        if (Uninstall.started(c) || !MainActivity.termuxOk(c)) return false;
        if (HermesService.setup(c).installing()) return false;
        return c.checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED;
    }

    static boolean busyRunning() {
        return running && System.currentTimeMillis() - runningSince < LOST_MS;
    }

    /** The service started: compare the installed plugin with the APK's, once per app version and at most every 6 h. */
    static void onServiceStart(Context c) {
        SharedPreferences p = prefs(c);
        long v = versionCode(c);
        boolean newApp = p.getLong("plugin_checked_version", -1) != v;
        if (!newApp && System.currentTimeMillis() - p.getLong("plugin_checked_at", 0) < CHECK_EVERY_MS) {
            maybeApply(c); // a version found older before (or a try that was busy) may go now
            return;
        }
        run(c, "check", false);
    }

    /** True when the last check said the installed plugin is older than the APK's and the automatic tries are not used up. */
    static boolean wanted(Context c) {
        SharedPreferences p = prefs(c);
        String s = p.getString("plugin_state", "");
        String[] a = apk(c);
        if (a == null) return false;
        if (!("older".equals(s) || "busy".equals(s) || "failed".equals(s))) return false;
        return p.getInt("plugin_tries_" + a[0], 0) < MAX_TRIES;
    }

    /** An event that may make now a good moment (a turn ended, the app left the screen): update when everything is quiet. */
    static void maybeApply(Context c) {
        if (!wanted(c) || busyRunning()) return;
        if (System.currentTimeMillis() - prefs(c).getLong("plugin_try_at", 0) < BUSY_GAP_MS) return;
        HermesService s = HermesService.instance;
        if (s == null || !s.hermesIdle()) return;
        MainActivity a = MainActivity.current;
        if (a != null && a.foreground) return; // not under the user's hands: a restart drops the connection for a while
        run(c, "apply", false);
    }

    /** Settings → About → Update now / Replace anyway. "ok", or why not. */
    static String userUpdate(Context c, boolean force) {
        if (apk(c) == null) return "error: this app build has no plugin";
        if (busyRunning()) return "busy";
        if (!canRun(c)) return "not-ready";
        HermesService s = HermesService.instance;
        if (s == null) return "not-ready"; // without the service nothing knows whether Hermes works
        if (!s.hermesIdle()) return "working";
        return run(c, "apply", force);
    }

    static synchronized String run(Context ctx, String mode, boolean force) {
        final Context app = ctx.getApplicationContext();
        if (busyRunning()) return "busy";
        if (!canRun(app)) return "not-ready";
        String script = asset(app, SCRIPT);
        String[] a = apk(app);
        if (script == null || a == null) return "error: this app build has no plugin";
        String[] argv;
        if ("apply".equals(mode)) {
            byte[] t = new byte[24];
            new SecureRandom().nextBytes(t);
            StringBuilder sb = new StringBuilder();
            for (byte b : t) sb.append(String.format("%02x", b));
            token = sb.toString();
            argv = force ? new String[]{"-c", script, "hm-plugin", "apply", a[0], a[1], a[2], token, "--force"}
                    : new String[]{"-c", script, "hm-plugin", "apply", a[0], a[1], a[2], token};
        } else {
            argv = new String[]{"-c", script, "hm-plugin", "check", a[0], a[1]};
        }
        if (!receiverOn) {
            BroadcastReceiver rx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent in) {
                    done(c, in.getBundleExtra("result"));
                }
            };
            IntentFilter f = new IntentFilter(ACTION);
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);
            else app.registerReceiver(rx, f);
            receiverOn = true;
        }
        try {
            PendingIntent pend = PendingIntent.getBroadcast(app, 4714, new Intent(ACTION).setPackage(app.getPackageName()),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", BASH);
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", argv);
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            i.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pend);
            running = true;
            runningSince = System.currentTimeMillis();
            runningMode = mode;
            SharedPreferences.Editor e = prefs(app).edit();
            if ("apply".equals(mode)) e.putLong("plugin_try_at", runningSince);
            else e.putLong("plugin_checked_at", runningSince).putLong("plugin_checked_version", versionCode(app));
            e.apply();
            app.startForegroundService(i);
            pageUpdate();
            return "ok";
        } catch (Exception e) {
            running = false;
            token = null;
            HermuxApp.log(app).event("plugin", "update_failed", "error", e.getClass().getSimpleName());
            return "error: " + e.getMessage();
        }
    }

    /** The last HMPLUGIN line of the script's output, split: {word, arg1, arg2…}; null = none. */
    static String[] lastLine(String out) {
        String last = null;
        for (String l : out.split("\n")) if (l.startsWith("HMPLUGIN ")) last = l.trim();
        return last == null ? null : last.substring(9).split(" ");
    }

    /** What the script said, as the state the page shows: current, older, newer, modified, held, not-ready, busy,
     *  failed (detail = the step and why). */
    static void done(Context c, Bundle b) {
        String mode = runningMode;
        running = false;
        token = null;
        String out = b == null ? "" : String.valueOf(b.getString("stdout", ""));
        int err = b == null ? 1 : b.getInt("err", -1);
        String[] l = err > 0 ? null : lastLine(out);
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit().putLong("plugin_at", System.currentTimeMillis());
        String[] a = apk(c);
        String stamp = a == null ? "0" : a[0];
        String state, detail = "", installed = p.getString("plugin_installed", "");
        if (l == null) {
            state = "failed";
            detail = b == null ? "no answer from Termux" : "Termux: " + String.valueOf(b.getString("errmsg", "no answer"));
        } else if ("STATE".equals(l[0]) && l.length >= 3) {
            state = "adopted".equals(l[1]) ? "current" : l[1];
            installed = l[2];
        } else if ("OK".equals(l[0])) {
            state = "current";
            installed = l.length > 1 ? l[1] : stamp;
            if (l.length > 2) detail = l[2]; // "unverified": Hermes didn't load the plugin before either
        } else if ("BUSY".equals(l[0])) {
            state = "busy";
            detail = l.length > 1 ? l[1] : "";
        } else {
            state = "failed";
            detail = String.join(" ", java.util.Arrays.copyOfRange(l, 1, l.length));
        }
        // A check that only met another run, or a busy Hermes, keeps what was known.
        if ("busy".equals(state) && "check".equals(mode)) state = p.getString("plugin_state", "older");
        if ("failed".equals(state) && "apply".equals(mode)) e.putInt("plugin_tries_" + stamp, p.getInt("plugin_tries_" + stamp, 0) + 1);
        if ("current".equals(state)) e.remove("plugin_tries_" + stamp);
        e.putString("plugin_state", state).putString("plugin_detail", detail).putString("plugin_installed", installed).apply();
        pageUpdate();
        if ("older".equals(state) && "check".equals(mode)) maybeApply(c);
    }

    static void pageUpdate() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(() -> {
            if (a.web != null) a.web.evaluateJavascript("window.hermesPluginState && window.hermesPluginState()", null);
        });
    }

    /** {state, detail, installed, apk, running, tries, maxTries, at} for Settings → About. */
    static String state(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            String[] a = apk(c);
            o.put("state", p.getString("plugin_state", "unknown"));
            o.put("detail", p.getString("plugin_detail", ""));
            o.put("installed", p.getString("plugin_installed", ""));
            o.put("apk", a == null ? "" : a[0]);
            o.put("running", busyRunning() ? runningMode : "");
            o.put("tries", a == null ? 0 : p.getInt("plugin_tries_" + a[0], 0));
            o.put("maxTries", MAX_TRIES);
            o.put("at", p.getLong("plugin_at", 0));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** GET /plugin-bundle/<token> on the loopback port: the APK's bundle, only to the run that was given the token. */
    static byte[] bundleFor(Context c, String got) {
        String t = token;
        if (t == null || got == null) return null;
        if (!java.security.MessageDigest.isEqual(t.getBytes(StandardCharsets.UTF_8), got.getBytes(StandardCharsets.UTF_8))) return null;
        token = null; // one fetch per run
        return assetBytes(c, BUNDLE);
    }
}
