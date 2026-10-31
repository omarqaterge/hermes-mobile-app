package com.omarqaterge.hermesmobile;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;

/**
 * Settings → About → Remote debugging: WebView remote debugging for a short time, on an installed (release) app.
 * Every decision is native and nothing here is reachable from the page except turning it OFF and reading the state:
 * no bridge method turns it on. It is turned on only by {@link #turnOn}, which MainActivity calls from
 * onActivityResult after the phone's own screen-lock screen returned RESULT_OK.
 *
 * The state is a static field (process memory only), so a process restart turns it off. It also ends by itself after
 * DURATION_MS (one bounded Handler callback, re-checked on every resume), when Android Developer options are turned
 * off, and from the ongoing notification's Turn off action (handled inside the non-exported HermesService).
 * A test build (plan 13, {@link #testBuild}) keeps debugging on whatever this does.
 */
final class DevTools {
    static final String CH_DEVTOOLS = "devtools";
    static final int NOTIFICATION_ID = 11;
    static final String ACTION_OFF = "com.omarqaterge.hermesmobile.DEVTOOLS_OFF";
    static final long DURATION_MS = 60L * 60_000;

    /** SystemClock.elapsedRealtime() at which it ends; 0 = off. Never persisted. */
    private static volatile long until = 0;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static volatile Context appContext;
    private static final Runnable expire = () -> {
        Context c = appContext;
        if (c != null) recheck(c);
    };

    private DevTools() {}

    /** True only in a test build made with HM_DEVTOOLS=1 (android/build.sh): the string resource hm_devtools is "1". */
    static boolean testBuild(Context ctx) {
        try {
            int id = ctx.getResources().getIdentifier("hm_devtools", "string", ctx.getPackageName());
            return id != 0 && "1".equals(ctx.getString(id));
        } catch (Exception e) {
            return false;
        }
    }

    static boolean isOn() {
        return until > SystemClock.elapsedRealtime();
    }

    /** Whole minutes left, rounded up (0 when off). */
    static int minutesLeft() {
        long left = until - SystemClock.elapsedRealtime();
        return left <= 0 ? 0 : (int) ((left + 59_999) / 60_000);
    }

    /** Android Developer options are on (the row only exists then). The screen lock is checked when turning on. */
    static boolean developerOptionsOn(Context ctx) {
        try {
            return android.provider.Settings.Global.getInt(ctx.getContentResolver(),
                    android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
        } catch (Exception e) {
            return false;
        }
    }

    /** The phone has a PIN, pattern or password (API 23; the minimum here is 26). */
    static boolean hasScreenLock(Context ctx) {
        android.app.KeyguardManager km = ctx.getSystemService(android.app.KeyguardManager.class);
        return km != null && km.isDeviceSecure();
    }

    /** {"available":bool,"on":bool,"minutesLeft":int}: what the page may read. */
    static String stateJson(Context ctx) {
        boolean avail = developerOptionsOn(ctx);
        boolean on = avail && isOn();
        return "{\"available\":" + avail + ",\"on\":" + on + ",\"minutesLeft\":" + (on ? minutesLeft() : 0) + "}";
    }

    /** Called only after the phone's credential screen said RESULT_OK (and again checks both conditions). */
    static boolean turnOn(Context ctx) {
        Context app = ctx.getApplicationContext();
        if (!developerOptionsOn(app) || !hasScreenLock(app)) return false;
        appContext = app;
        until = SystemClock.elapsedRealtime() + DURATION_MS;
        apply(app, true);
        return true;
    }

    static void turnOff(Context ctx) {
        until = 0;
        apply(ctx.getApplicationContext(), true);
    }

    /** Resume / timer / service start: end it when it ran out or Developer options went off; drop a notice left by a dead process. */
    static void recheck(Context ctx) {
        Context app = ctx.getApplicationContext();
        appContext = app;
        boolean ended = until != 0 && (!isOn() || !developerOptionsOn(app));
        if (ended) until = 0;
        if (ended || until != 0) {
            apply(app, ended);
            return;
        }
        // Off and never on in this process (a fresh start, also the service's at boot): WebView is already off, so don't
        // load it just to say so; only drop a notification a dead process may have left.
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    }

    /** Makes WebView, the timer and the notification match the state. Main thread. */
    private static void apply(Context ctx, boolean tellPage) {
        WebView.setWebContentsDebuggingEnabled(isOn() || testBuild(ctx));
        main.removeCallbacks(expire);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (isOn()) {
            main.postDelayed(expire, Math.max(1000, until - SystemClock.elapsedRealtime())); // one callback, ends at `until`
            post(ctx, nm);
        } else {
            nm.cancel(NOTIFICATION_ID);
        }
        MainActivity m = MainActivity.current;
        if (tellPage && m != null) m.devtoolsChanged();
    }

    private static void post(Context ctx, NotificationManager nm) {
        try {
            HermesService.createChannels(ctx);
            long endWall = System.currentTimeMillis() + (until - SystemClock.elapsedRealtime());
            String at = android.text.format.DateFormat.getTimeFormat(ctx).format(new java.util.Date(endWall));
            Intent off = new Intent(ctx, HermesService.class).setAction(ACTION_OFF); // explicit, into the non-exported service
            PendingIntent offPi = PendingIntent.getService(ctx, NOTIFICATION_ID, off,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            Notification.Builder b = new Notification.Builder(ctx, CH_DEVTOOLS)
                    .setSmallIcon(R.drawable.ic_stat_hermes)
                    .setContentTitle("Remote debugging is on")
                    .setContentText("Remote debugging is on · turns off at " + at)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .addAction(new Notification.Action.Builder(null, "Turn off", offPi).build());
            if (open != null)
                b.setContentIntent(PendingIntent.getActivity(ctx, NOTIFICATION_ID, open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            nm.notify(NOTIFICATION_ID, b.build());
        } catch (Exception ignored) {
            // notifications not allowed: it still ends by itself
        }
    }
}
