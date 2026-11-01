package com.omarqaterge.hermesmobile;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Tells the user once per release that a newer app version is on GitHub. One small HTTPS request at most every
 * CHECK_MS (the service asks at start-up and then on a timer that does not wake the CPU); no wake lock, no alarm.
 * Tapping the notice opens the app and starts the same download + install as Settings → About → Update (the system installer still asks to confirm).
 */
final class UpdateNotice {
    static final String CH_UPDATE = "update";
    static final int UPDATE_ID = 10;
    static final long CHECK_MS = 12L * 3600_000;
    private static final String API = "https://api.github.com/repos/omarqaterge/hermes-mobile-app/releases/latest";
    private static volatile boolean busy = false;

    private UpdateNotice() {}

    /** "v0.8.21" → [0,8,21]; anything that isn't dotted numbers counts as 0 (same rule as web/src/releasenotes.ts). */
    static int[] parts(String v) {
        String[] p = v.replaceFirst("^[vV]", "").split("\\.");
        int[] r = new int[p.length];
        for (int i = 0; i < p.length; i++) {
            try {
                r[i] = Integer.parseInt(p[i].trim());
            } catch (Exception e) {
                r[i] = 0;
            }
        }
        return r;
    }

    static boolean isNewer(String latest, String current) {
        int[] a = parts(latest), b = parts(current);
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int d = (i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0);
            if (d != 0) return d > 0;
        }
        return false;
    }

    /** Checks in a background thread if the last check is older than CHECK_MS (or force). Safe to call often. */
    static void check(Context ctx, boolean force) {
        Context app = ctx.getApplicationContext();
        SharedPreferences sp = app.getSharedPreferences("update_notice", Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long last = sp.getLong("checked", 0);
        if (!force && now - last < CHECK_MS && now >= last) return;
        if (busy) return;
        busy = true;
        new Thread(() -> {
            try {
                run(app, sp);
            } catch (Exception ignored) {
                // offline or GitHub limiting requests: try again at the next check
            } finally {
                busy = false;
            }
        }, "hermes-update-check").start();
    }

    private static void run(Context ctx, SharedPreferences sp) throws Exception {
        String current = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(15_000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        if (c.getResponseCode() != 200) return;
        StringBuilder sb = new StringBuilder();
        try (InputStream in = c.getInputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && sb.length() < 1_000_000) sb.append(new String(buf, 0, n, "UTF-8"));
        }
        sp.edit().putLong("checked", System.currentTimeMillis()).apply();
        JSONObject rel = new JSONObject(sb.toString());
        String latest = rel.optString("tag_name", "").replaceFirst("^[vV]", "");
        JSONArray assets = rel.optJSONArray("assets");
        String apkUrl = "";
        for (int i = 0; assets != null && i < assets.length(); i++)
            if (assets.getJSONObject(i).optString("name").toLowerCase().endsWith(".apk"))
                apkUrl = assets.getJSONObject(i).optString("browser_download_url", "");
        boolean hasApk = !apkUrl.isEmpty();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (latest.isEmpty() || !isNewer(latest, current)) {
            nm.cancel(UPDATE_ID); // installed (or the release was pulled): the notice has nothing left to say
            return;
        }
        if (!hasApk || latest.equals(sp.getString("notified", ""))) return; // no file yet / already told for this version
        if (notify(ctx, latest, apkUrl)) sp.edit().putString("notified", latest).apply();
    }

    private static boolean notify(Context ctx, String latest, String apkUrl) {
        try {
            HermesService.createChannels(ctx);
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            open.putExtra("updateUrl", apkUrl); // MainActivity checks it is an official release URL
            Notification.Builder b = new Notification.Builder(ctx, CH_UPDATE)
                    .setSmallIcon(R.drawable.ic_stat_hermes)
                    .setContentTitle("Hermes Mobile " + latest + " is available")
                    .setContentText("Tap to download and install it.")
                    .setAutoCancel(true);
            b.setContentIntent(PendingIntent.getActivity(ctx, UPDATE_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            ctx.getSystemService(NotificationManager.class).notify(UPDATE_ID, b.build());
            return true;
        } catch (Exception e) {
            return false; // notifications not allowed: ask again at the next check
        }
    }
}
