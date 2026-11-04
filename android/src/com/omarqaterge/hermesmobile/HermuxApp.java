package com.omarqaterge.hermesmobile;

import android.app.ActivityManager;
import android.app.Application;
import android.app.ApplicationExitInfo;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.webkit.WebView;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Starts the diagnostic log (DiagLog has the policy) as soon as the app's process starts, whatever started it: records
 * uncaught exceptions, why Android ended the last runs (Android 11+), and memory pressure, and answers what the log's
 * "Phone" section says. Nothing here sends anything.
 */
public class HermuxApp extends Application {
    private static final String PREFS = "hm";
    private static final String P_OFF = "diagOff";
    private static final String P_EXIT_SEEN = "diagExitSeen";
    private static DiagLog log;

    /** The app's log; a context is needed only for the first call (a receiver or service before the Application is ready). */
    static synchronized DiagLog log(Context c) {
        if (log == null) {
            Context a = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            // The no-backup folder: app-private, never in a device backup or a transfer to a new phone.
            log = new DiagLog(new java.io.File(a.getNoBackupFilesDir(), "diag"));
            log.setEnabled(!a.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(P_OFF, false));
        }
        return log;
    }

    /** Settings → About → Keep a diagnostic log. Off also deletes what was kept. */
    static void setEnabled(Context c, boolean on) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(P_OFF, !on).apply();
        log(c).setEnabled(on);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (!mainProcess()) return; // the speech-model probe has its own process: its starts and native crashes say nothing about the app
        DiagLog d = log(this);
        Thread.UncaughtExceptionHandler next = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            try {
                d.crash(e, thread == null ? "" : thread.getName(), getPackageName());
            } catch (Throwable ignored) {
                // Out of memory, say: the process must still end as it always did.
            } finally {
                if (next != null) next.uncaughtException(thread, e); // Android's own handler ends the process as before
            }
        });
        new Thread(() -> {
            exitReasons(d);
            String version = "";
            try {
                version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception ignored) {
            }
            d.event("app", "start", "version", version);
        }, "hermes-diag").start();
    }

    /** Application.getProcessName is API 28; this file works on every Android. */
    private boolean mainProcess() {
        try (java.io.FileInputStream in = new java.io.FileInputStream("/proc/self/cmdline")) {
            byte[] b = new byte[256];
            int n = in.read(b);
            int end = 0;
            while (end < n && b[end] != 0) end++;
            return new String(b, 0, end, java.nio.charset.StandardCharsets.UTF_8).equals(getPackageName());
        } catch (Exception e) {
            return true;
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (!mainProcess()) return;
        // Only the levels that mean the phone is short of memory, not every hide of the app.
        if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level == ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
            log(this).event("app", "low_memory", "level", String.valueOf(level));
    }

    /** Android 11+ keeps why this app's recent runs ended: writes the ones not seen before, at the time they happened. */
    private void exitReasons(DiagLog d) {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (am == null) return;
            SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
            long seen = p.getLong(P_EXIT_SEEN, 0);
            List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(getPackageName(), 0, 8);
            long newest = seen;
            for (int i = list.size() - 1; i >= 0; i--) { // the list is newest first; the log runs oldest first
                ApplicationExitInfo x = list.get(i);
                if (x.getTimestamp() <= seen) continue;
                newest = Math.max(newest, x.getTimestamp());
                if (!getPackageName().equals(x.getProcessName())) continue; // the speech-model probe's own process
                // Not getDescription() or the trace: free text from the system.
                d.event(x.getTimestamp() / 1000, "app", "exit",
                        "reason", exitReason(x.getReason()),
                        "status", String.valueOf(x.getStatus()),
                        "importance", String.valueOf(x.getImportance()),
                        "pss_mb", String.valueOf(x.getPss() / 1024),
                        "rss_mb", String.valueOf(x.getRss() / 1024));
            }
            if (newest != seen) p.edit().putLong(P_EXIT_SEEN, newest).apply();
        } catch (Exception ignored) {
            // Some makers' builds throw here: no exit reasons, then.
        }
    }

    private static String exitReason(int r) {
        switch (r) {
            case ApplicationExitInfo.REASON_ANR: return "anr";
            case ApplicationExitInfo.REASON_CRASH: return "crash";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "crash_native";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "dependency_died";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "excessive_resources";
            case ApplicationExitInfo.REASON_EXIT_SELF: return "exit_self";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "init_failure";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "low_memory";
            case ApplicationExitInfo.REASON_OTHER: return "other";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "permission_change";
            case ApplicationExitInfo.REASON_SIGNALED: return "signaled";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "user_requested";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "user_stopped";
            case 14: return "freezer"; // these three are newer than the compile-time names older Android has
            case 15: return "package_state_change";
            case 16: return "package_updated";
            default: return "code_" + r;
        }
    }

    /** The log's "Phone" section: what helps with a problem on one kind of phone, and no model, name or ID. */
    static JSONObject phoneFacts(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("android", Build.VERSION.RELEASE);
            o.put("api", Build.VERSION.SDK_INT);
            o.put("maker", token(Build.MANUFACTURER)); // the maker only: battery savers differ by maker. Never MODEL or DEVICE.
            if (Build.SUPPORTED_ABIS.length > 0) o.put("cpu", token(Build.SUPPORTED_ABIS[0]));
            android.content.pm.PackageInfo wv = WebView.getCurrentWebViewPackage();
            if (wv != null) o.put("webview", token(wv.versionName));
            o.put("termux", version(c, "com.termux"));
            o.put("shizuku", version(c, "moe.shizuku.privileged.api"));
            o.put("shizuku_running", ShizukuProvider.running());
            PowerManager pm = (PowerManager) c.getSystemService(POWER_SERVICE);
            if (pm != null) {
                o.put("battery_exempt_app", pm.isIgnoringBatteryOptimizations(c.getPackageName()));
                o.put("battery_exempt_termux", pm.isIgnoringBatteryOptimizations("com.termux"));
            }
            o.put("notifications", Build.VERSION.SDK_INT < 33
                    || c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED);
            ActivityManager am = (ActivityManager) c.getSystemService(ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo m = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(m);
                o.put("ram_gb", Math.round(m.totalMem / 1e9)); // rounded: a bucket, not a fingerprint
            }
            long free = new StatFs(c.getFilesDir().getPath()).getAvailableBytes();
            o.put("free_storage", free < 1_000_000_000L ? "under_1gb" : free < 5_000_000_000L ? "1_to_5gb" : free < 20_000_000_000L ? "5_to_20gb" : "over_20gb");
        } catch (Exception ignored) {
            // What was found so far is still useful.
        }
        return o;
    }

    private static String version(Context c, String pkg) {
        try {
            return token(c.getPackageManager().getPackageInfo(pkg, 0).versionName);
        } catch (Exception e) {
            return "none";
        }
    }

    private static String token(String s) {
        if (s == null) return "";
        String t = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]+", "_");
        return t.length() > 30 ? t.substring(0, 30) : t;
    }
}
