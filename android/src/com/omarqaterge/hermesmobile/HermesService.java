package com.omarqaterge.hermesmobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Keeps Hermes's pinned status notification ("Running `ls`", "Thinking…", "Ready") and posts
 * every Hermes notification with the app's own icon. The hermes-mobile plugin inside Hermes
 * POSTs events to 127.0.0.1:9121/event with the shared key (written to Termux's
 * ~/.hermes-mobile/key). Loopback only: other devices can't reach it.
 */
public class HermesService extends Service {
    static final int PORT = 9121;
    static final int STATUS_ID = 1;
    static final int SHIZUKU_ID = 9;
    static final String CH_PHONE = "phone", SHIZUKU_PKG = "moe.shizuku.privileged.api";
    static final String CH_STATUS = "status", CH_IDLE = "idle", CH_ALERT = "needs_you", CH_REPLY = "replies",
            CH_LEARN = "learning2", CH_JOBS = "jobs2"; // v2 ids: the first ones badged the icon and a channel's badge flag can't change

    static volatile boolean running = false;
    static volatile HermesService instance;
    ServerSocket server;
    String key;
    String lastStatus = "Ready";
    String lastShort = "";
    String lastSession = null;
    long workingSince = 0;
    long lastBeat = 0;
    static final long WORKING_TTL_MS = 50_000; // the plugin beats every 15 s while working

    /** The app Hermes is driving on the hidden display (event kind "bgapp"); null = none. Port and token never leave Java. */
    static final class BgApp {
        final String session, pkg, label, action, token;
        final int port;
        final long since;

        BgApp(String session, String pkg, String label, String action, int port, String token, long since) {
            this.session = session; this.pkg = pkg; this.label = label; this.action = action;
            this.port = port; this.token = token; this.since = since;
        }

        /** What the page may see: no port, no token. */
        String pageJson() {
            try {
                return new JSONObject().put("session", session).put("pkg", pkg).put("label", label)
                        .put("action", action).put("since", since).toString();
            } catch (Exception e) {
                return "";
            }
        }
    }

    static volatile BgApp bgApp = null;
    /** The host exits after 2 idle minutes; keep the card a little longer than that between plugin events. */
    static final long BG_TTL_MS = 130_000;
    final Runnable expireBgTask = () -> setBgApp(null);

    /** Every change of the background app reaches the open page (if any) as window.__hmBg(state|null). */
    void setBgApp(BgApp b) {
        bgApp = b;
        main.removeCallbacks(expireBgTask);
        if (b != null) main.postDelayed(expireBgTask, BG_TTL_MS);
        else {
            main.removeCallbacks(bgThumbTask);
            if (bgThumb != null) {
                bgThumb = null;
                synchronized (this) {
                    if (lastWorking) postStatus();
                }
            }
        }
        MainActivity a = MainActivity.current;
        if (a != null) a.pushBg();
    }

    /** A small picture of the hidden screen for the working chip's expanded card (its large icon); null = none.
     *  Fetched once per plugin event (open / each action), so it costs nothing while Hermes isn't using an app. */
    volatile android.graphics.Bitmap bgThumb = null;
    final Runnable bgThumbTask = this::fetchBgThumb;
    static final int THUMB_PX = 256;

    void fetchBgThumb() {
        final BgApp b = bgApp;
        if (b == null) return;
        new Thread(() -> {
            android.graphics.Bitmap got = null;
            try {
                int[] st = new int[1];
                byte[] img = MainActivity.bgRequest(b, "GET", "/frame?w=" + THUMB_PX * 2, st);
                if (st[0] == 200 && img.length > 0) {
                    android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(img, 0, img.length);
                    if (bm != null) got = squareThumb(bm, THUMB_PX);
                }
            } catch (Exception ignored) {
                // the host is gone or busy: keep the last picture, the next event tries again
            }
            final android.graphics.Bitmap thumb = got;
            main.post(() -> {
                BgApp cur = bgApp;
                if (thumb == null || cur == null || !cur.session.equals(b.session) || !cur.pkg.equals(b.pkg)) return;
                bgThumb = thumb;
                synchronized (HermesService.this) {
                    if (lastWorking) postStatus();
                }
            });
        }, "hermes-bgthumb").start();
    }

    /** The whole (tall) screen fitted into a square on black, so the notification's square icon shows all of it. */
    static android.graphics.Bitmap squareThumb(android.graphics.Bitmap src, int px) {
        android.graphics.Bitmap out = android.graphics.Bitmap.createBitmap(px, px, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas c = new android.graphics.Canvas(out);
        c.drawColor(Color.BLACK);
        float s = Math.min(px / (float) src.getWidth(), px / (float) src.getHeight());
        float w = src.getWidth() * s, h = src.getHeight() * s;
        android.graphics.RectF dst = new android.graphics.RectF((px - w) / 2f, (px - h) / 2f, (px + w) / 2f, (px + h) / 2f);
        c.drawBitmap(src, null, dst, new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    void onBgEvent(JSONObject e) {
        String state = e.optString("state");
        String session = e.optString("session", "");
        if ("done".equals(state)) {
            setBgApp(null);
            return;
        }
        int port = e.optInt("port", 0);
        String token = e.optString("token", "");
        if (session.isEmpty() || port < 1024 || port > 65535 || token.isEmpty() || token.length() > 256) return;
        BgApp old = bgApp;
        String pkg = e.optString("pkg", "");
        long since = old != null && old.session.equals(session) && old.pkg.equals(pkg) ? old.since : System.currentTimeMillis();
        if (old == null || !old.session.equals(session) || !old.pkg.equals(pkg)) bgThumb = null; // another app: no stale picture
        setBgApp(new BgApp(session, pkg, e.optString("label", pkg), e.optString("action", ""), port, token, since));
        // The event comes right after the action: give the app a moment to draw its result, then take the picture.
        main.removeCallbacks(bgThumbTask);
        main.postDelayed(bgThumbTask, 700);
    }

    /** No status beat for a while: Hermes (or its plugin) died mid-turn, so drop the stuck chip. */
    final Runnable expireWorkingTask = this::expireWorking;

    void expireWorking() {
        if (!lastWorking || System.currentTimeMillis() - lastBeat < WORKING_TTL_MS - 1000) return;
        workingSince = 0;
        lastWorking = false;
        lastShort = "";
        lastStatus = "Ready";
        stopping = null;
        postStatus();
        updateWake();
    }
    boolean lastWorking = false;
    String lastSub = null;
    String lastTitle = "";
    int lastSteps = 0, lastMore = 0;
    JSONObject lastTodo = null;
    org.json.JSONArray lastOthers = null;
    boolean lastReview = false;
    /** The chat whose Stop button was tapped, until Hermes reports the turn over (or the request fails). */
    String stopping = null;
    final java.util.HashMap<String, JSONObject> doneInfo = new java.util.HashMap<>();
    // A short-lived "flash" in the status chip (done ✅, memory/skill updates); reverts after FLASH_MS.
    String flashChip = null, flashTitle = null, flashBody = null;
    int flashColor = 0;
    long flashUntil = 0;
    static final long FLASH_MS = 6000;
    /** Chats that finished while you weren't looking: id → {title, profile}. Persisted; the sticky Done chip and the icon badge. */
    final java.util.LinkedHashMap<String, String[]> unseen = new java.util.LinkedHashMap<>();
    /** The chat on screen right now (set by the page, cleared when the activity pauses). */
    static volatile String openChat = null;
    /** The chat the page showed last (kept while the app is hidden, unlike openChat). */
    static volatile String lastShownChat = null;
    static final String GROUP = "hermes";
    static final String ACTION_APPROVE = "com.omarqaterge.hermesmobile.APPROVE";
    static final String ACTION_ANSWER = "com.omarqaterge.hermesmobile.ANSWER";
    static final String ACTION_CLEAR_DONE = "com.omarqaterge.hermesmobile.CLEAR_DONE";
    static final String ACTION_WAKE = "com.omarqaterge.hermesmobile.WAKE";
    static final String ACTION_STOP = "com.omarqaterge.hermesmobile.STOP";
    static final String REMOTE_TEXT = "text";
    static final int SUMMARY_ID = 3;
    final Handler main = new Handler(Looper.getMainLooper());

    static void start(Context ctx) {
        try {
            ctx.startForegroundService(new Intent(ctx, HermesService.class));
        } catch (Exception ignored) {
            // background-start restrictions: the app / Termux keeper will start it next time
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels(this);
        loadUnseen();
        key = ensureKey();
        // The typed call is API 29 and the special-use type API 34; older Android uses the manifest's type.
        if (Build.VERSION.SDK_INT >= 34) startForeground(STATUS_ID, statusNotification("Ready", null, false), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(STATUS_ID, statusNotification("Ready", null, false));
        running = true;
        instance = this;
        new Thread(this::serve, "hermes-events").start();
        rearmWake();
        main.postDelayed(shizukuCheck, 90_000); // once: after a reboot Shizuku doesn't start by itself, so no binder ever arrives
        main.postDelayed(updateCheck, 120_000);
    }

    /** New-release notice: one GitHub request every 12 h at most (UpdateNotice throttles); the timer does not wake the CPU. */
    private final Runnable updateCheck = new Runnable() {
        @Override
        public void run() {
            UpdateNotice.check(HermesService.this, false);
            main.postDelayed(this, UpdateNotice.CHECK_MS);
        }
    };

    /** Not running 90 s after start: the keeper restarts it, or says in the notice why it can't (ShizukuKeeper). */
    private final Runnable shizukuCheck = () -> {
        if (shizukuInstalled(this) && !ShizukuProvider.running()) ShizukuKeeper.onDown(this, true);
    };

    static boolean shizukuInstalled(Context ctx) {
        try {
            ctx.getPackageManager().getPackageInfo(SHIZUKU_PKG, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Shizuku's binder died (called from ShizukuProvider, any thread): the keeper restarts it or shows why it can't. */
    static void shizukuDown(Context ctx) {
        ShizukuKeeper.onDown(ctx, false);
    }

    /** Shizuku runs (again): the keeper stops and the notice goes away. */
    static void shizukuUp(Context ctx) {
        ShizukuKeeper.onUp(ctx);
    }

    /** The Shizuku notice; text = the keeper's reason. Opens Shizuku, or this app when the set-up must be finished. */
    static void shizukuNotice(Context ctx, String title, String text, boolean openApp) {
        try {
            createChannels(ctx);
            Intent open = openApp ? null : ctx.getPackageManager().getLaunchIntentForPackage(SHIZUKU_PKG);
            if (open == null) open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            Notification.Builder b = new Notification.Builder(ctx, CH_PHONE)
                    .setSmallIcon(R.drawable.ic_stat_hermes)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setOnlyAlertOnce(true)
                    .setAutoCancel(true);
            if (open != null)
                b.setContentIntent(PendingIntent.getActivity(ctx, SHIZUKU_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            ctx.getSystemService(NotificationManager.class).notify(SHIZUKU_ID, b.build());
        } catch (Exception ignored) {
            // notifications not allowed: nothing to do
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_APPROVE.equals(intent.getAction())) {
            answerApproval(intent);
            return START_STICKY;
        }
        if (intent != null && ACTION_ANSWER.equals(intent.getAction())) {
            answerFromNotification(intent);
            return START_STICKY;
        }
        if (intent != null && AdbPairing.ACTION_CODE.equals(intent.getAction())) {
            AdbPairing.onReply(this, intent); // the code typed into the Pairing notification
            return START_STICKY;
        }
        if (intent != null && ACTION_CLEAR_DONE.equals(intent.getAction())) {
            clearUnseen();
            return START_STICKY;
        }
        if (intent != null && ACTION_WAKE.equals(intent.getAction())) {
            wakeForCron();
            return START_STICKY;
        }
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTurn(intent.getStringExtra("session"));
            return START_STICKY;
        }
        if (intent != null && TtsMedia.ACTION_TTS.equals(intent.getAction())) {
            // a button on the "Reading aloud" card; Voice.control() runs it on the main thread for the active reader
            Voice.control(intent.getStringExtra("cmd"));
            return START_STICKY;
        }
        // Once per service run: each share spawns a Termux shell. Not before Termux has accepted a command once (a fresh
        // phone before the installer): Termux refuses it with an error notification, and the share is retried when the
        // probe first succeeds or the installer reports DONE (shareKeyAgain).
        if (!keyShared && MainActivity.termuxOk(this)) shareKeyWithTermux();
        return START_STICKY;
    }

    // ── battery: keep the CPU awake only while Hermes has work ──
    // Termux no longer holds a permanent wake lock (it kept the phone out of deep sleep around the clock).
    // Hermes runs in Termux, so while a turn, an approval or a due cron job is under way this service holds
    // a partial wake lock for it; a foreground service's wake lock still counts in Doze.
    // Upper bound only: the alarm pokes the ticker (it ticks at once) and the ticker reports cron_idle once no job
    // is running, which ends the hold early; an agent job's status beats keep the phone awake after that.
    static final long CRON_WAKE_MS = 150_000;
    static final int TICKER_PORT = 9122; // phone/cron_ticker.py's poke listener
    PowerManager.WakeLock wakeLock;
    long alarmAwakeUntil = 0, heldUntil = 0, alarmAt = 0, alarmFor = 0;

    /** WakeReceiver (the cron alarm): stay awake until the ticker has run the due job (at most CRON_WAKE_MS). */
    synchronized void wakeForCron() {
        long now = System.currentTimeMillis();
        alarmFor = alarmAt > 0 ? Math.min(alarmAt, now) : now; // a tick cycle starting at/after this saw the job due
        alarmAt = 0;
        getSharedPreferences("hermes", MODE_PRIVATE).edit().remove("wake_at").apply(); // fired: nothing to re-arm
        alarmAwakeUntil = now + CRON_WAKE_MS;
        updateWake();
        pokeTicker();
    }

    /** The ticker reports that a tick cycle started at `sinceSec` ended with no job running: the alarm's work is done. */
    synchronized void cronIdle(double sinceSec) {
        if (alarmAwakeUntil <= System.currentTimeMillis() || sinceSec * 1000 < alarmFor - 1000) return;
        alarmAwakeUntil = 0;
        updateWake();
    }

    /** Hermes's ticker sleeps on a clock that stops while the phone sleeps: wake it so the due job starts now. */
    void pokeTicker() {
        new Thread(() -> {
            try (Socket s = new Socket()) {
                s.connect(new java.net.InetSocketAddress("127.0.0.1", TICKER_PORT), 1000);
                OutputStream out = s.getOutputStream();
                out.write((key + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (Exception ignored) {
                // an older ticker without the listener: the job starts on its next tick (≤ 60 s)
            }
        }, "hermes-poke").start();
    }

    synchronized void updateWake() {
        long now = System.currentTimeMillis();
        long until = alarmAwakeUntil;
        if (lastWorking) until = Math.max(until, lastBeat + WORKING_TTL_MS + 5000);
        if (pendingApproval != null) until = Math.max(until, approvalDeadline + 5000);
        try {
            if (wakeLock == null) {
                wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hermes:working");
                wakeLock.setReferenceCounted(false);
            }
            if (until <= now) {
                if (wakeLock.isHeld()) wakeLock.release();
                heldUntil = 0;
            } else if (until != heldUntil || !wakeLock.isHeld()) {
                wakeLock.acquire(until - now); // not reference counted: replaces the previous timeout
                heldUntil = until;
            }
        } catch (Exception ignored) {
        }
    }

    /** The cron ticker reports the next due job (epoch seconds, 0 = none): wake the phone for it. */
    synchronized void scheduleWake(double atSec) {
        long at = (long) (atSec * 1000);
        if (at == alarmAt) return;
        alarmAt = at;
        getSharedPreferences("hermes", MODE_PRIVATE).edit().putLong("wake_at", at).apply();
        AlarmManager am = getSystemService(AlarmManager.class);
        // A broadcast: the alarm manager keeps the CPU awake until onReceive returns, which takes our lock.
        PendingIntent pi = PendingIntent.getBroadcast(this, 7, new Intent(this, WakeReceiver.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        if (at <= System.currentTimeMillis()) return;
        try {
            // canScheduleExactAlarms is API 31; before that exact alarms need no permission.
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    /**
     * Alarms die with the app (update, force-stop, reboot), and the ticker that would report the time again is
     * frozen in Doze, so a scheduled job could wait for hours. Re-arm the last reported time from storage; one
     * that already passed (up to 6 h ago) wakes the phone now so the ticker catches up.
     */
    void rearmWake() {
        long at = getSharedPreferences("hermes", MODE_PRIVATE).getLong("wake_at", 0);
        long now = System.currentTimeMillis();
        if (at > now) scheduleWake(at / 1000.0);
        else if (at > now - 6 * 3600_000L) wakeForCron();
    }

    @Override
    public void onDestroy() {
        running = false;
        instance = null;
        main.removeCallbacks(shizukuCheck);
        ShizukuKeeper.stop();
        main.removeCallbacks(updateCheck);
        if (voice != null) voice.destroy();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── key shared with the plugin ──────────────────────────
    String ensureKey() {
        SharedPreferences p = getSharedPreferences("hermes", MODE_PRIVATE);
        String k = p.getString("event_key", null);
        if (k == null) {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            k = sb.toString();
            p.edit().putString("event_key", k).apply();
        }
        return k;
    }

    boolean keyShared = false;

    /** Termux accepts our commands now (first good probe, installer DONE): share the event key if it never got there. */
    static void shareKeyAgain() {
        HermesService s = instance;
        if (s == null) return;
        s.keyShared = false;
        s.shareKeyWithTermux();
    }

    // ── app-first setup: the installer's progress lines (SetupLines has the policy) ──
    static final SetupLines setup = new SetupLines();
    static boolean setupLoaded = false;

    /** The progress channel, with the copied command's token restored after a restart (prefs "hermes" setup_token). */
    static SetupLines setup(Context c) {
        synchronized (setup) {
            if (!setupLoaded) {
                setupLoaded = true;
                setup.resume(c.getSharedPreferences("hermes", MODE_PRIVATE).getString("setup_token", ""));
            }
        }
        return setup;
    }

    /** A new installer command was copied: remember its token (memory + prefs, so a service restart mid-install keeps it). */
    static void startSetup(Context c, String token) {
        setup(c).start(token);
        c.getSharedPreferences("hermes", MODE_PRIVATE).edit().putString("setup_token", token).apply();
    }

    /** POST /setup {token, line}: keep it, push it to the page, show the step in the notification. */
    int setupPost(String body) {
        String[] tl = SetupLines.parse(body);
        if (tl == null) return SetupLines.BAD_LINE;
        SetupLines sl = setup(this);
        int r = sl.add(tl[0], tl[1], tl[2], System.currentTimeMillis() / 1000);
        if (r != SetupLines.OK) return r;
        String line = tl[1];
        MainActivity a = MainActivity.current;
        if (a != null) a.pushSetupLine(line);
        String text = null;
        if (line.startsWith("STEP ")) {
            String[] p = line.split(" ", 3);
            text = "Setting up: " + (p.length > 2 && !p[2].trim().isEmpty() ? p[2].trim() : p[1]);
        } else if (line.startsWith("FAIL ")) text = "Setup stopped: open Hermes Mobile";
        else if (line.equals("DONE")) {
            getSharedPreferences("hermes", MODE_PRIVATE).edit().remove("setup_token").apply();
            MainActivity.setTermuxOk(this);
            text = "Ready";
        }
        if (text != null) {
            final String t = text;
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    getSystemService(NotificationManager.class).notify(STATUS_ID, statusNotification(t, null, false));
                } catch (Exception ignored) {
                }
            });
        }
        return r;
    }

    void shareKeyWithTermux() {
        if (Uninstall.started(this)) return; // Settings → Uninstall Hermes: nothing more goes into Termux
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return;
        keyShared = true;
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c",
                    "mkdir -p ~/.hermes-mobile && umask 077 && printf %s " + key + " > ~/.hermes-mobile/key"});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            startForegroundService(i);
        } catch (Exception ignored) {
        }
    }

    // ── loopback event listener ─────────────────────────────
    void serve() {
        try {
            server = new ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"));
            while (running) {
                try (Socket s = server.accept()) {
                    s.setSoTimeout(3000);
                    handle(s);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception e) {
            running = false;
        }
    }

    void handle(Socket s) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String line = in.readLine();
        // POST /setup = the installer's progress (its own one-time token, see SetupLines); everything else is an event.
        boolean setupReq = line != null && line.startsWith("POST /setup ");
        int len = 0;
        String gotKey = "";
        int headers = 0;
        while ((line = in.readLine()) != null && !line.isEmpty()) {
            if (++headers > 40 || line.length() > 2048) throw new java.io.IOException("bad request");
            String l = line.toLowerCase();
            if (l.startsWith("content-length:")) len = Integer.parseInt(line.substring(15).trim());
            if (l.startsWith("x-hermes-mobile-key:")) gotKey = line.substring(20).trim();
        }
        if (len < 0 || len > (setupReq ? 1024 : 256 * 1024)) throw new java.io.IOException("too large");
        // Content-Length counts UTF-8 bytes, the reader gives chars: count bytes, or a non-ASCII body waits forever.
        StringBuilder body = new StringBuilder();
        int bytes = 0;
        char[] buf = new char[4096];
        while (bytes < len) {
            int r = in.read(buf, 0, Math.min(buf.length, len - bytes));
            if (r < 0) break;
            body.append(buf, 0, r);
            for (int k = 0; k < r; k++) {
                char c = buf[k];
                bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : Character.isSurrogate(c) ? 2 : 3;
            }
        }
        OutputStream out = s.getOutputStream();
        if (setupReq) {
            int r = setupPost(body.toString());
            out.write((r == SetupLines.OK ? "HTTP/1.1 204 No Content\r\n" : r == SetupLines.BAD_TOKEN ? "HTTP/1.1 403 Forbidden\r\n" : "HTTP/1.1 400 Bad Request\r\n")
                    .concat("Content-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            return;
        }
        boolean ok = java.security.MessageDigest.isEqual(
                key.getBytes(StandardCharsets.UTF_8), gotKey.getBytes(StandardCharsets.UTF_8)); // constant time
        out.write((ok ? "HTTP/1.1 204 No Content\r\n" : "HTTP/1.1 403 Forbidden\r\n")
                .concat("Content-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        if (ok) onEvent(new JSONObject(body.toString()));
    }

    // ── read-aloud mode: speak replies while the app is closed or the phone is locked ──
    Voice voice;

    /** Speaks a finished reply when read-aloud mode is on for its chat (global setting or per-chat override). */
    void readAloud(JSONObject e, String session) {
        try {
            if (!"mobile".equals(e.optString("platform", ""))) return; // only chats made in this app
            String text = e.optString("speak_text", "");
            if (text.isEmpty() || session == null) return;
            String raw = getSharedPreferences("hm", MODE_PRIVATE).getString("readaloud", null);
            if (raw == null) return;
            JSONObject cfg = new JSONObject(raw);
            JSONObject per = cfg.optJSONObject("sessions");
            boolean on = per != null && per.has(session) ? per.optBoolean(session) : cfg.optBoolean("global", false);
            if (!on) return;
            final String speech = Voice.speakable(text);
            if (speech.isEmpty()) return;
            JSONObject tc = cfg.optJSONObject("tts") == null ? new JSONObject() : new JSONObject(cfg.optJSONObject("tts").toString());
            tc.put("notify", true).put("title", e.optString("title", "")).put("session", session); // the "Reading aloud" card
            final String ttsCfg = tc.toString();
            main.post(() -> {
                if (voice == null) voice = new Voice(this);
                voice.speak(speech, ttsCfg);
            });
        } catch (Exception ignored) {
        }
    }

    // ── events → notifications ──────────────────────────────
    synchronized void onEvent(JSONObject e) {
        String kind = e.optString("kind");
        String title = e.optString("title", "Hermes");
        String body = e.optString("body", "");
        String session = e.optString("session", null);
        String profile = e.optString("profile", "");
        NotificationManager nm = getSystemService(NotificationManager.class);
        switch (kind) {
            case "status": {
                boolean working = e.optBoolean("working", false);
                if (working && workingSince == 0) workingSince = System.currentTimeMillis();
                if (!working) workingSince = 0;
                lastStatus = body.isEmpty() ? (working ? "Working…" : "Ready") : body;
                lastShort = working ? e.optString("short", "Hermes") : "";
                if (session != null && !session.isEmpty()) lastSession = session;
                lastSub = profile.isEmpty() || "default".equals(profile) ? null : profile;
                // The turn's progress for the expanded chip (plugin 0.8.36+; older plugins send none of these).
                lastTitle = working ? e.optString("title", "") : "";
                lastSteps = working ? e.optInt("steps", 0) : 0;
                lastTodo = working ? e.optJSONObject("todo") : null;
                lastOthers = working ? e.optJSONArray("others") : null;
                lastMore = working ? e.optInt("more", 0) : 0;
                lastReview = working && e.optBoolean("review", false);
                double since = e.optDouble("since", 0);
                if (working && since > 0) workingSince = (long) (since * 1000);
                if (!working) stopping = null;
                lastWorking = working;
                if (working) flashUntil = 0; // real work beats a flash
                lastBeat = System.currentTimeMillis();
                main.removeCallbacks(expireWorkingTask);
                if (working) main.postDelayed(expireWorkingTask, WORKING_TTL_MS);
                postStatus();
                updateWake();
                return;
            }
            case "bgapp":
                onBgEvent(e);
                return;
            case "wake_at":
                scheduleWake(e.optDouble("at", 0));
                return;
            case "cron_idle":
                cronIdle(e.optDouble("since", 0));
                return;
            case "shizuku-auto": // Termux's hm-shizuku after pair/start: {cmd, paired, result, detail}
                ShizukuKeeper.onEvent(this, e);
                AdbPairing.onEvent(this, e); // the answer to a code typed into the Pairing notification
                return;
            case "flash": {
                if ((e.optBoolean("done", false) || e.optString("short", "").contains("Done")) && session != null && !session.isEmpty()) {
                    if (MainActivity.visible) return; // the app is on screen: its own unread dots show it, no sticky chip
                    unseen.remove(session);
                    unseen.put(session, new String[]{title, profile});
                    // What the expanded Done chip says about the turn (in memory only; a restart shows the title alone).
                    doneInfo.keySet().retainAll(unseen.keySet());
                    doneInfo.put(session, e);
                    lastSession = session;
                    saveUnseen();
                    updateBadge();
                    postStatus();
                    return;
                }
                // Momentary chip: done ✅ (green) or a memory/skill update.
                flashChip = e.optString("short", "✅ Done");
                flashTitle = title;
                flashBody = body;
                flashColor = Color.parseColor(e.optString("color", "#2E9E5B"));
                flashUntil = System.currentTimeMillis() + FLASH_MS;
                if (session != null && !session.isEmpty()) lastSession = session;
                postStatus();
                main.postDelayed(this::expireFlash, FLASH_MS + 100);
                return;
            }
            case "approval": {
                // HyperOS hides the popup after ~5 s whatever we ask; the island chip keeps the
                // same buttons (status notification) until the approval is answered. The chip is
                // armed even while the app is on screen: leaving the app with the sheet unanswered
                // must still leave a way to answer (it used to return here and the chip had none).
                boolean ticking = pendingApproval != null;
                if (!ticking) lastReAlert = -1;
                pendingApproval = e;
                approvalDeadline = System.currentTimeMillis() + Math.max(1, e.optLong("timeout", 60)) * 1000L;
                postStatus();
                updateWake();
                if (!ticking) main.postDelayed(this::tickApproval, 1000);
                if (MainActivity.visible) return; // no popup: the app shows its own sheet
                Notification.Builder b = alertBuilder(CH_ALERT, title, clip(body, 600), session, true);
                // Answer right from the popup, like the in-app sheet.
                b.addAction(approveAction(e, "once", "Allow once"));
                if (e.optBoolean("allow_session", true)) b.addAction(approveAction(e, "session", "Allow session"));
                b.addAction(approveAction(e, "deny", "Deny"));
                postGrouped(nm, tag(kind, session), b.build());
                return;
            }
            case "ask": {
                // HyperOS hides the popup after ~5 s: the question and its answers also ride on the island chip,
                // armed even while the app is on screen so leaving it unanswered still leaves a way to answer.
                pendingAsk = e;
                main.removeCallbacks(expireAskTask);
                main.postDelayed(expireAskTask, ASK_TTL_MS);
                postStatus();
                if (MainActivity.visible) return; // no popup: the app shows its own sheet
                Notification.Builder b = alertBuilder(CH_ALERT, title, body, session, true);
                // Answer in the notification; a question with choices offers them as quick replies.
                org.json.JSONArray ch = e.optJSONArray("choices");
                java.util.ArrayList<CharSequence> choices = new java.util.ArrayList<>();
                if (ch != null) for (int k = 0; k < ch.length() && choices.size() < 5; k++) {
                    String c = ch.optString(k, "").trim();
                    if (!c.isEmpty()) choices.add(c.length() > 40 ? c.substring(0, 40) : c);
                }
                if (e.optBoolean("single", true)) b.addAction(answerAction("ask", session, "Answer", choices));
                postGrouped(nm, tag(kind, session), b.build());
                return;
            }
            case "reply":
            case "error":
                if (MainActivity.visible) return;
                Notification.Builder rb = alertBuilder(CH_REPLY, title, body, session, false);
                if (session != null && !session.isEmpty()) rb.addAction(answerAction("reply", session, "Reply", null));
                postGrouped(nm, tag("reply", session), badged(rb, unseen.size() + (session != null && !unseen.containsKey(session) ? 1 : 0)));
                if ("reply".equals(kind)) readAloud(e, session);
                return;
            case "learning":
                flashChip = title.startsWith("Skill") ? "🧩 Skill" : "🧠 Memory";
                flashTitle = title;
                flashBody = body;
                flashColor = Color.parseColor("#7B61D9");
                flashUntil = System.currentTimeMillis() + FLASH_MS;
                postStatus();
                main.postDelayed(this::expireFlash, FLASH_MS + 100);
                postGrouped(nm, tag("learn", e.optString("id", title)), alert(CH_LEARN, title, body, session, false));
                return;
            case "cron":
                postGrouped(nm, tag("cron", e.optString("id", session)), alert(CH_JOBS, title, body, session, false));
                return;
            case "clear":
                if ("ask".equals(e.optString("what")) && pendingAsk != null) {
                    pendingAsk = null;
                    main.removeCallbacks(expireAskTask);
                    postStatus();
                }
                if ("approval".equals(e.optString("what")) && pendingApproval != null) {
                    pendingApproval = null;
                    postStatus();
                    updateWake();
                }
                String t = tag(e.optString("what", "reply"), session);
                nm.cancel(t, 2);
                dropEmptySummary(nm, t);
                return;
            default:
        }
    }

    synchronized void expireFlash() {
        if (flashUntil != 0 && System.currentTimeMillis() >= flashUntil) {
            flashUntil = 0;
            postStatus();
        }
    }

    // ── unseen chats: sticky Done chip + icon badge ──
    synchronized void loadUnseen() {
        try {
            org.json.JSONArray a = new org.json.JSONArray(getSharedPreferences("hm", MODE_PRIVATE).getString("unseen", "[]"));
            unseen.clear();
            for (int k = 0; k < a.length(); k++) {
                JSONObject o = a.getJSONObject(k);
                unseen.put(o.getString("id"), new String[]{o.optString("title", ""), o.optString("profile", "")});
            }
        } catch (Exception ignored) {
        }
    }

    synchronized void saveUnseen() {
        try {
            org.json.JSONArray a = new org.json.JSONArray();
            for (java.util.Map.Entry<String, String[]> en : unseen.entrySet())
                a.put(new JSONObject().put("id", en.getKey()).put("title", en.getValue()[0]).put("profile", en.getValue()[1]));
            getSharedPreferences("hm", MODE_PRIVATE).edit().putString("unseen", a.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** The Done chip was tapped: forget every unseen chat, whether or not it still exists. */
    static void clearDoneChip() {
        HermesService s = instance;
        if (s != null) s.clearUnseen();
    }

    synchronized void clearUnseen() {
        unseen.clear();
        saveUnseen();
        updateBadge();
        postStatus();
    }

    /** A chat was opened (page) or its notification handled: forget it, cancel its reply card. */
    static void seen(String id) {
        HermesService s = instance;
        if (s == null || id == null) return;
        s.markSeen(id);
    }

    synchronized void markSeen(String id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        String t = tag("reply", id);
        nm.cancel(t, 2);
        dropEmptySummary(nm, t);
        if (unseen.remove(id) != null) {
            saveUnseen();
            updateBadge();
            postStatus();
        }
    }

    /** The page's own unread list for one profile replaces that profile's entries (badge and in-app dots then agree). */
    static void replaceUnseen(String profile, org.json.JSONArray rows) {
        HermesService s = instance;
        if (s != null) s.replaceUnseenRows(profile, rows);
    }

    /** The page's unread chats for one profile, [{id,title}]. Only REMOVES chips (the chat was read in the app); a chat
     *  joins the sticky Done chip only when it finished while the app was off screen (the "flash" event). */
    synchronized void replaceUnseenRows(String profile, org.json.JSONArray rows) {
        java.util.LinkedHashMap<String, String[]> old = new java.util.LinkedHashMap<>(unseen);
        java.util.Set<String> keep = new java.util.HashSet<>();
        for (int k = 0; k < rows.length(); k++) {
            JSONObject o = rows.optJSONObject(k);
            if (o == null) continue;
            String id = o.optString("id", "");
            if (id.isEmpty()) continue;
            keep.add(id);
            String[] prev = unseen.get(id);
            if (prev == null) continue;
            String title = o.optString("title", "");
            if (!title.isEmpty()) unseen.put(id, new String[]{title, profile});
        }
        java.util.Iterator<java.util.Map.Entry<String, String[]>> it = unseen.entrySet().iterator();
        while (it.hasNext()) {
            java.util.Map.Entry<String, String[]> en = it.next();
            if (profile.equals(en.getValue()[1]) && !keep.contains(en.getKey())) it.remove();
        }
        boolean same = old.size() == unseen.size();
        if (same) for (java.util.Map.Entry<String, String[]> en : old.entrySet()) {
            String[] now = unseen.get(en.getKey());
            if (now == null || !now[0].equals(en.getValue()[0])) { same = false; break; }
        }
        if (same) return;
        saveUnseen();
        updateBadge();
        postStatus();
    }

    /** App-icon badge number = unseen chats. Isolated so it can be adapted per launcher. Stock Android shows only a
     *  dot (from any badging notification); HyperOS shows a number taken from setNumber / Xiaomi's message count.
     *  Every reply notification and the group summary carry the current count; this refreshes the ones on display. */
    int badgeCount = -1;

    void updateBadge() {
        int n = unseen.size();
        if (n == badgeCount) return;
        badgeCount = n;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            for (android.service.notification.StatusBarNotification sn : nm.getActiveNotifications()) {
                String t = sn.getTag();
                boolean reply = sn.getId() == 2 && t != null && t.startsWith("reply:");
                if (!reply && sn.getId() != SUMMARY_ID) continue;
                // Nothing unseen any more (Clear, or every chat opened): HyperOS reads number 0 as "no number"
                // and counts the cards still showing instead (phone-tested: badge 1), so drop the reply cards.
                if (n == 0 && reply) {
                    nm.cancel(t, 2);
                    dropEmptySummary(nm, t);
                    continue;
                }
                if (n == 0) continue;
                Notification.Builder b = Notification.Builder.recoverBuilder(this, sn.getNotification()).setOnlyAlertOnce(true);
                nm.notify(t, sn.getId(), badged(b, n));
            }
        } catch (Exception ignored) {
        }
    }

    /** Builds with the badge number set: setNumber, plus Xiaomi's own count by reflection (no-op elsewhere). */
    Notification badged(Notification.Builder b, int n) {
        Notification note = b.setNumber(n).build();
        try {
            java.lang.reflect.Field f = Notification.class.getDeclaredField("extraNotification");
            f.setAccessible(true);
            Object extra = f.get(note);
            if (extra != null) extra.getClass().getDeclaredMethod("setMessageCount", int.class).invoke(extra, n);
        } catch (Throwable ignored) {
        }
        return note;
    }

    void postStatus() {
        getSystemService(NotificationManager.class).notify(STATUS_ID, statusNotification(lastStatus, lastSub, lastWorking));
    }

    /** One collapsed stack for every Hermes notification (replies, approvals, learning, jobs). */
    void postGrouped(NotificationManager nm, String tag, Notification n) {
        nm.notify(tag, 2, n);
        Notification.Builder sum = new Notification.Builder(this, CH_LEARN)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(Color.parseColor("#D9A441"))
                .setContentTitle("Hermes")
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
                .setAutoCancel(true)
                .setContentIntent(openApp(null));
        nm.notify(SUMMARY_ID, badged(sum, unseen.size()));
    }

    void dropEmptySummary(NotificationManager nm, String gone) {
        for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications())
            if (n.getId() == 2 && !gone.equals(n.getTag())) return;
        nm.cancel(SUMMARY_ID);
    }

    static String tag(String kind, String id) {
        return kind + ":" + (id == null ? "" : id);
    }

    PendingIntent openApp(String session) {
        return openApp(session, false);
    }

    /** clearDone: tapping the card also clears the sticky Done chip (all of it), even when the chat it names is gone. */
    PendingIntent openApp(String session, boolean clearDone) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (session != null && !session.isEmpty()) open.putExtra("session", session);
        if (clearDone) open.putExtra("clearDone", true);
        int code = (session == null ? 0 : session.hashCode()) + (clearDone ? 31 : 0);
        return PendingIntent.getActivity(this, code, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    Notification statusNotification(String text, String sub, boolean working) {
        boolean flash = flashUntil > System.currentTimeMillis();
        if (flash && pendingApproval == null && pendingAsk == null) return flashNotification();
        if (pendingApproval != null) return approvalNotification(sub);
        if (pendingAsk != null) return askNotification(sub);
        if (!working && !unseen.isEmpty()) return doneNotification(sub);
        if (working) return workingNotification(text, sub);
        // Idle = a slim green card on its own channel (so it can be minimised on its own); working = the gold Live Update.
        Notification.Builder b = new Notification.Builder(this, CH_IDLE)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GREEN)
                .setContentTitle("Status: " + text.replace("`", ""))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(lastSession));
        if (sub != null) b.setSubText(sub);
        return b.build();
    }

    static final int GOLD = Color.parseColor("#D9A441"), GREEN = Color.parseColor("#3DBE7A"),
            RED = Color.parseColor("#E5564B"), AMBER = Color.parseColor("#E8912D");
    /** A dropped task on the progress bar (faint grey, reads on the dark and the light shade). */
    static final int DROPPED = 0x40808080;

    /** Hermes at work, as a Live Update (the chip shows the kind of step: Shell, Web, Files…). Tapped/expanded:
     *  the chat's title; what it is doing now (`code` in gold monospace); the task it is on; a bar with one segment
     *  per task when Hermes keeps a task list (green done, gold current and to do, faded past the tracker), otherwise an activity sweep;
     *  the header says how many tasks/steps and the turn's running time; other busy chats; a Stop button. */
    Notification workingNotification(String text, String sub) {
        JSONObject todo = lastTodo != null && lastTodo.optInt("total", 0) > 0 ? lastTodo : null;
        boolean isStopping = stopping != null && stopping.equals(lastSession);
        String chat = lastTitle.isEmpty() ? "Hermes" : lastTitle;

        android.text.SpannableStringBuilder t = new android.text.SpannableStringBuilder();
        t.append(isStopping ? "Stopping\u2026" : codeSpans(text));
        String task = todo == null ? "" : todo.optString("current", "");
        if (!task.isEmpty()) {
            int st = t.length();
            t.append("\n\u25B8 ").append(task);
            t.setSpan(new android.text.style.ForegroundColorSpan(GOLD), st + 1, st + 2, 0);
        }
        if (lastOthers != null) for (int k = 0; k < lastOthers.length(); k++) {
            JSONObject o = lastOthers.optJSONObject(k);
            if (o == null) continue;
            String ot = o.optString("title", "");
            t.append("\n").append(ot.isEmpty() ? "Another chat" : ot).append(": ").append(o.optString("text", "").replace("`", ""));
        }

        java.util.ArrayList<String> head = new java.util.ArrayList<>();
        if (sub != null) head.add(sub);
        if (todo != null) head.add(todo.optInt("done", 0) + " of " + todo.optInt("total", 0) + " tasks");
        else if (lastSteps > 0) head.add(lastSteps == 1 ? "1 step" : lastSteps + " steps");
        if (lastMore > 0) head.add("+" + lastMore + (lastMore == 1 ? " chat" : " chats"));

        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GOLD)
                .setContentTitle(chat)
                .setContentText(t)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setContentIntent(openApp(lastSession));
        if (workingSince > 0) b.setWhen(workingSince).setUsesChronometer(true);
        if (!head.isEmpty()) b.setSubText(String.join(" \u00B7 ", head));
        if (Build.VERSION.SDK_INT >= 36) {
            Notification.ProgressStyle ps = new Notification.ProgressStyle().setStyledByProgress(todo != null);
            if (todo != null) {
                // Styled by progress: the system fades everything past the tracker, so the current task is half
                // solid, half faded, and the tasks still to do read as faint.
                String states = todo.optString("states", "");
                java.util.ArrayList<Notification.ProgressStyle.Segment> segs = new java.util.ArrayList<>();
                int pos = -1;
                for (int k = 0; k < states.length(); k++) {
                    char c = states.charAt(k);
                    segs.add(new Notification.ProgressStyle.Segment(100).setColor(
                            c == 'd' ? GREEN : c == 'x' ? DROPPED : GOLD));
                    if (c == 'a' && pos < 0) pos = k * 100 + 50;
                }
                if (pos < 0) pos = states.lastIndexOf('d') * 100 + 100;
                ps.setProgressSegments(segs).setProgress(Math.max(0, pos))
                        .setProgressTrackerIcon(android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_stat_hermes));
            } else {
                ps.setProgressIndeterminate(true)
                        .setProgressSegments(java.util.List.of(new Notification.ProgressStyle.Segment(100).setColor(GOLD)));
            }
            b.setStyle(ps);
        } else {
            b.setStyle(new Notification.BigTextStyle().bigText(t));
            if (todo != null) b.setProgress(todo.optInt("total", 0), todo.optInt("done", 0), false);
            else b.setProgress(0, 0, true);
        }
        if (!isStopping && lastSession != null && !lastSession.isEmpty()) {
            Intent stop = new Intent(this, HermesService.class).setAction(ACTION_STOP).putExtra("session", lastSession);
            b.addAction(new Notification.Action.Builder(null, colored("\u25A0 Stop", RED),
                    PendingIntent.getService(this, ("stop:" + lastSession).hashCode(), stop,
                            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
        }
        promote(b, lastShort.isEmpty() ? "Hermes" : lastShort);
        // Hermes is using an app on the hidden screen for this chat: the expanded card shows a picture of it.
        // The lock screen gets the same card without the picture (it can show the user's own data).
        BgApp bg = bgApp;
        android.graphics.Bitmap thumb = bgThumb;
        if (bg != null && thumb != null && bg.session.equals(lastSession)) {
            // build() hands back the builder's own Notification: clone it, or the card becomes its own public version.
            b.setPublicVersion(b.build().clone());
            b.setLargeIcon(android.graphics.drawable.Icon.createWithBitmap(thumb));
        }
        return b.build();
    }

    /** The chip's Stop button: the plugin interrupts the turn (session.interrupt, like the app's stop button).
     *  The chip says "Stopping…" until Hermes reports the turn over; a failure is said plainly. */
    void stopTurn(String session) {
        if (session == null || session.isEmpty()) return;
        synchronized (this) {
            stopping = session;
            postStatus();
        }
        new Thread(() -> {
            String err = null;
            try {
                String body = new JSONObject().put("session", session).toString();
                String path = "/api/plugins/hermes-mobile/stop";
                String[] res = MainActivity.rawHttp("POST", path, dashboardToken(false), body);
                if ("401".equals(res[0]) || "403".equals(res[0]))
                    res = MainActivity.rawHttp("POST", path, dashboardToken(true), body);
                if ("404".equals(res[0])) err = "it isn't running in the app's Hermes";
                else if (!res[0].startsWith("2")) err = "HTTP " + res[0];
            } catch (Exception ex) {
                err = ex.getMessage();
            }
            final String failed = err;
            if (failed == null) return;
            main.post(() -> {
                synchronized (HermesService.this) {
                    if (session.equals(stopping)) stopping = null;
                    postStatus();
                }
                NotificationManager nm = getSystemService(NotificationManager.class);
                postGrouped(nm, tag("stop", session), alert(CH_ALERT, "Couldn't stop Hermes",
                        "Open the chat to stop it (" + failed + ")", session, true));
            });
        }, "hermes-stop").start();
    }

    /** "2m 14s", "45s", "1h 3m". */
    static String took(long secs) {
        if (secs < 60) return secs + "s";
        if (secs < 3600) return (secs / 60) + "m " + (secs % 60) + "s";
        return (secs / 3600) + "h " + (secs % 3600 / 60) + "m";
    }

    void promote(Notification.Builder b, String chip) {
        Bundle extras = new Bundle();
        extras.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(extras);
        if (Build.VERSION.SDK_INT >= 36) b.setShortCriticalText(chip);
    }

    static CharSequence bold(String s) {
        android.text.SpannableString sp = new android.text.SpannableString(s);
        sp.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, s.length(), 0);
        return sp;
    }

    /** Bold status line; `code` becomes gold monospace (backticks dropped). */
    static CharSequence codeSpans(String s) {
        android.text.SpannableStringBuilder b = new android.text.SpannableStringBuilder();
        String[] parts = s.split("`", -1);
        for (int k = 0; k < parts.length; k++) {
            int st = b.length();
            b.append(parts[k]);
            if (k % 2 == 1 && k < parts.length - 1) {
                b.setSpan(new android.text.style.TypefaceSpan("monospace"), st, b.length(), 0);
                b.setSpan(new android.text.style.ForegroundColorSpan(GOLD), st, b.length(), 0);
            } else if (k % 2 == 1) {
                b.insert(st, "`"); // unpaired backtick: keep it literal
            }
        }
        b.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, b.length(), 0);
        return b;
    }

    static CharSequence colored(String s, int color) {
        android.text.SpannableString sp = new android.text.SpannableString(s);
        sp.setSpan(new android.text.style.ForegroundColorSpan(color), 0, s.length(), 0);
        sp.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, s.length(), 0);
        return sp;
    }

    /** A question from Hermes, as a Live Update: "Answer?" chip; expanded, the question in bold, the choices
     * listed and one button per choice (a long list: the first two plus a text field with all as quick replies). */
    Notification askNotification(String sub) {
        JSONObject a = pendingAsk;
        String session = a.optString("session", "");
        String q = a.optString("body", "").trim();
        if (q.isEmpty()) q = "Hermes has a question";
        java.util.ArrayList<String> choices = new java.util.ArrayList<>();
        org.json.JSONArray ch = a.optJSONArray("choices");
        if (ch != null) for (int k = 0; k < ch.length() && choices.size() < 5; k++) {
            String c = ch.optString(k, "").trim();
            if (!c.isEmpty()) choices.add(c.length() > 40 ? c.substring(0, 40) : c);
        }
        boolean single = a.optBoolean("single", true);
        android.text.SpannableStringBuilder t = new android.text.SpannableStringBuilder(q);
        t.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, t.length(), 0);
        if (single) for (String c : choices) {
            int st = t.length();
            t.append("\n\u25CB ").append(c);
            t.setSpan(new android.text.style.ForegroundColorSpan(GOLD), st + 1, st + 2, 0);
        }
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GOLD)
                .setContentTitle("Hermes asks")
                .setContentText(t)
                .setSubText(sub)
                .setStyle(new Notification.BigTextStyle().bigText(t))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(session));
        if (single) {
            if (choices.isEmpty()) {
                b.addAction(answerAction("ask", session, "Answer", null));
            } else if (choices.size() <= 3) {
                for (int k = 0; k < choices.size(); k++) b.addAction(choiceAction(session, choices.get(k), k));
            } else {
                b.addAction(choiceAction(session, choices.get(0), 0));
                b.addAction(choiceAction(session, choices.get(1), 1));
                b.addAction(answerAction("ask", session, "More\u2026", new java.util.ArrayList<CharSequence>(choices)));
            }
        }
        promote(b, "Answer?");
        return b.build();
    }

    /** A button that answers the open question with one fixed choice. */
    Notification.Action choiceAction(String session, String choice, int k) {
        Intent i = new Intent(this, HermesService.class).setAction(ACTION_ANSWER)
                .putExtra("kind", "ask").putExtra("session", session == null ? "" : session).putExtra("text", choice);
        PendingIntent pi = PendingIntent.getService(this, ("choice:" + session + ":" + k).hashCode(), i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return unlockFirst(new Notification.Action.Builder(null, colored(choice.length() > 18 ? choice.substring(0, 17) + "\u2026" : choice, GOLD), pi)).build();
    }

    JSONObject pendingAsk;
    static final long ASK_TTL_MS = 10 * 60 * 1000L;
    final Runnable expireAskTask = () -> {
        if (pendingAsk != null) {
            pendingAsk = null;
            postStatus();
        }
    };

    /** Waiting approval, as a Live Update: shield chip with a live countdown; expanded, the command
     * in monospace over a draining countdown bar (gold → amber → red) and coloured answer buttons. */
    Notification approvalNotification(String sub) {
        JSONObject a = pendingApproval;
        long total = Math.max(1, a.optLong("timeout", 60)) * 1000L;
        long left = Math.max(0, approvalDeadline - System.currentTimeMillis());
        int secs = (int) Math.ceil(left / 1000.0);
        float frac = left / (float) total;
        int barColor = frac > 0.5f ? GOLD : frac > 0.2f ? AMBER : RED;

        String what = clip(a.optString("what", ""), 280);
        String cmd = clip(a.optString("command", ""), 400);
        if (what.isEmpty() && cmd.isEmpty()) what = clip(a.optString("body", "a command"), 400);
        android.text.SpannableStringBuilder t = new android.text.SpannableStringBuilder();
        if (!what.isEmpty()) {
            t.append(what.substring(0, 1).toUpperCase() + what.substring(1));
            t.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, t.length(), 0);
        }
        if (!cmd.isEmpty()) {
            if (t.length() > 0) t.append("\n");
            int st = t.length();
            t.append("$ ").append(cmd);
            t.setSpan(new android.text.style.TypefaceSpan("monospace"), st, t.length(), 0);
            t.setSpan(new android.text.style.ForegroundColorSpan(GOLD), st, st + 1, 0);
        }

        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_shield)
                .setColor(barColor)
                .setContentTitle("Hermes wants to run a command")
                .setContentText(t)
                .setSubText((sub != null ? sub + " · " : "") + "expires in " + secs + "s")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(a.optString("session", "")));
        if (Build.VERSION.SDK_INT >= 36) {
            int p = Math.round(frac * 1000);
            b.setStyle(new Notification.ProgressStyle()
                    .setStyledByProgress(false)
                    .setProgressSegments(java.util.List.of(
                            new Notification.ProgressStyle.Segment(Math.max(p, 1)).setColor(barColor),
                            new Notification.ProgressStyle.Segment(Math.max(1000 - p, 1)).setColor(0x33FFFFFF)))
                    .setProgress(p)
                    .setProgressTrackerIcon(android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_stat_shield)));
        } else {
            b.setStyle(new Notification.BigTextStyle().bigText(t));
        }
        b.addAction(unlockFirst(new Notification.Action.Builder(null, colored("✓ Allow once", GREEN), approveIntent(a, "once"))).build());
        if (a.optBoolean("allow_session", true))
            b.addAction(unlockFirst(new Notification.Action.Builder(null, colored("Allow session", GOLD), approveIntent(a, "session"))).build());
        b.addAction(new Notification.Action.Builder(null, colored("✕ Deny", RED), approveIntent(a, "deny")).build());
        promote(b, secs + "s");
        return b.build();
    }

    /** A notification line kept short enough that the answer buttons stay in view. */
    static String clip(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 1) + "\u2026";
    }

    long approvalDeadline;
    long lastReAlert = -1;

    void reAlertApproval() {
        JSONObject e = pendingApproval;
        if (e == null) return;
        String session = e.optString("session", null);
        NotificationManager nm = getSystemService(NotificationManager.class);
        Notification.Builder b = alertBuilder(CH_ALERT, e.optString("title", "Hermes"), "Still waiting for your answer: " + clip(e.optString("body", ""), 600), session, true);
        b.addAction(approveAction(e, "once", "Allow once"));
        if (e.optBoolean("allow_session", true)) b.addAction(approveAction(e, "session", "Allow session"));
        b.addAction(approveAction(e, "deny", "Deny"));
        nm.cancel(tag("approval", session), 2); // a fresh post is what re-triggers the heads-up
        postGrouped(nm, tag("approval", session), b.build());
    }

    /** Ticks the approval countdown once a second until answered or expired. */
    void tickApproval() {
        synchronized (this) {
            if (pendingApproval == null) return;
            // HyperOS drops the heads-up after ~5 s: pop it up again at 20 s and 40 s while unanswered.
            long elapsed = Math.max(1, pendingApproval.optLong("timeout", 60)) * 1000L - (approvalDeadline - System.currentTimeMillis());
            long sec = elapsed / 1000;
            if ((sec == 20 || sec == 40) && sec != lastReAlert && !MainActivity.visible) {
                lastReAlert = sec;
                reAlertApproval();
            }
            if (System.currentTimeMillis() > approvalDeadline + 3000) {
                pendingApproval = null; // expired; the plugin's clear normally beats this
                postStatus();
                updateWake();
                return;
            }
            postStatus();
        }
        main.postDelayed(this::tickApproval, 1000);
    }

    /** The sticky green chip: stays until the chats are opened (or Clear). */
    synchronized Notification doneNotification(String sub) {
        int n = unseen.size();
        String latestId = null;
        String[] latest = null;
        for (java.util.Map.Entry<String, String[]> en : unseen.entrySet()) {
            latestId = en.getKey();
            latest = en.getValue();
        }
        StringBuilder titles = new StringBuilder();
        for (String[] v : unseen.values()) titles.append(titles.length() > 0 ? "\n" : "").append(v[0].isEmpty() ? "Chat" : v[0]);
        String title = n == 1 ? (latest[0].isEmpty() ? "Hermes" : latest[0]) : n + " chats finished";
        // One chat: the start of the reply, and how long the turn took / how many steps. Several: their titles.
        JSONObject info = n == 1 ? doneInfo.get(latestId) : null;
        String reply = info == null ? "" : info.optString("reply", "");
        String text = n == 1 ? (reply.isEmpty() ? "Done" : reply) : titles.toString();
        java.util.ArrayList<String> head = new java.util.ArrayList<>();
        if (sub != null) head.add(sub);
        head.add("Done");
        if (info != null && info.optInt("steps", 0) > 0) head.add(info.optInt("steps") == 1 ? "1 step" : info.optInt("steps") + " steps");
        if (info != null && info.optLong("secs", 0) > 0) head.add(took(info.optLong("secs")));
        Intent clear = new Intent(this, HermesService.class).setAction(ACTION_CLEAR_DONE);
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GREEN)
                .setContentTitle(title)
                .setContentText(n == 1 ? text : titles.toString().replace("\n", " · "))
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSubText(String.join(" \u00B7 ", head))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(latestId, true))
                .addAction(new Notification.Action.Builder(null, "Clear",
                        PendingIntent.getService(this, 7, clear, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
        promote(b, n == 1 ? "✅ Done" : "✅ " + n + " done");
        return b.build();
    }

    Notification flashNotification() {
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(flashColor)
                .setContentTitle(flashTitle)
                .setContentText(flashBody)
                .setStyle(new Notification.BigTextStyle().bigText(flashBody))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(lastSession));
        Bundle extras = new Bundle();
        extras.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(extras);
        if (Build.VERSION.SDK_INT >= 36) b.setShortCriticalText(flashChip);
        return b.build();
    }

    Notification alert(String channel, String title, String body, String session, boolean urgent) {
        return alertBuilder(channel, title, body, session, urgent).build();
    }

    Notification.Action approveAction(JSONObject e, String choice, String label) {
        Notification.Action.Builder b = new Notification.Action.Builder(null, label, approveIntent(e, choice));
        return ("deny".equals(choice) ? b : unlockFirst(b)).build();
    }

    /** A notification answer that acts (Allow, Allow session, an answer, a choice, a reply) on a LOCKED phone: don't
     *  act, open the app instead with the request (its chat, the typed text in the box) so the user unlocks first
     *  (MainActivity asks for the unlock screen) and answers there. Android 12+ already asks for the unlock before
     *  the button works (unlockFirst); this covers Android 8-11. True = it was locked and nothing was sent. */
    boolean openToUnlock(String session, String draft, String what) {
        if (!MainActivity.keyguardLocked(this)) return false;
        android.util.Log.i("HermesLock", "locked: not sending " + what + ", opening the app to unlock");
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_UNLOCK, true);
        if (session != null && !session.isEmpty()) open.putExtra("session", session); // opens that chat (its sheet)
        if (draft != null) open.putExtra("draft", draft.length() > 20000 ? draft.substring(0, 20000) : draft);
        try {
            startActivity(open);
        } catch (Exception ignored) {
            // background start refused: the notification is still there, answered once unlocked
        }
        return true;
    }

    /** On the lock screen, Android asks to unlock before this answer goes through (API 31+): whoever holds a locked
     *  phone can't allow a command or tell Hermes what to do. Deny stays one tap. */
    static Notification.Action.Builder unlockFirst(Notification.Action.Builder b) {
        if (Build.VERSION.SDK_INT >= 31) b.setAuthenticationRequired(true);
        return b;
    }

    PendingIntent approveIntent(JSONObject e, String choice) {
        String session = e.optString("session", "");
        Intent i = new Intent(this, HermesService.class).setAction(ACTION_APPROVE)
                .putExtra("session", session)
                .putExtra("key", e.optString("key", ""))
                .putExtra("request_id", e.optString("request_id", ""))
                .putExtra("profile", e.optString("profile", ""))
                .putExtra("choice", choice);
        return PendingIntent.getService(this, (session + choice).hashCode(), i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A notification button's answer: POST it to the plugin's /approve (approval.respond). */
    void answerApproval(Intent i) {
        String session = i.getStringExtra("session");
        String choice = i.getStringExtra("choice");
        if (!"deny".equals(choice) && openToUnlock(session, null, "approval " + choice)) return;
        String t = tag("approval", session);
        NotificationManager nm = getSystemService(NotificationManager.class);
        new Thread(() -> {
            String err = null;
            try {
                JSONObject body = new JSONObject()
                        .put("session", session)
                        .put("key", i.getStringExtra("key"))
                        .put("choice", choice)
                        .put("request_id", i.getStringExtra("request_id"))
                        .put("profile", i.getStringExtra("profile"));
                String path = "/api/plugins/hermes-mobile/approve";
                String[] res = MainActivity.rawHttp("POST", path, dashboardToken(false), body.toString());
                if ("401".equals(res[0]) || "403".equals(res[0]))
                    res = MainActivity.rawHttp("POST", path, dashboardToken(true), body.toString());
                if (!res[0].startsWith("2")) err = "HTTP " + res[0];
            } catch (Exception ex) {
                err = ex.getMessage();
            }
            final String failed = err;
            main.post(() -> {
                if (failed == null) {
                    synchronized (HermesService.this) {
                        pendingApproval = null;
                        postStatus();
                    }
                    nm.cancel(t, 2);
                    dropEmptySummary(nm, t);
                } else {
                    postGrouped(nm, t, alert(CH_ALERT, "Couldn't send your answer",
                            "Open Hermes to answer (" + failed + ")", session, true));
                }
            });
        }, "hermes-approve").start();
    }

    /** A text field on the notification (RemoteInput). Its PendingIntent must be mutable to receive the text;
     *  it is explicit (this service), so nothing else can fill it in. */
    Notification.Action answerAction(String kind, String session, String label, java.util.List<CharSequence> choices) {
        android.app.RemoteInput.Builder ri = new android.app.RemoteInput.Builder(REMOTE_TEXT).setLabel("ask".equals(kind) ? "Your answer" : "Message Hermes");
        if (choices != null && !choices.isEmpty()) ri.setChoices(choices.toArray(new CharSequence[0]));
        Intent i = new Intent(this, HermesService.class).setAction(ACTION_ANSWER)
                .putExtra("kind", kind)
                .putExtra("session", session == null ? "" : session);
        PendingIntent pi = PendingIntent.getService(this, ("answer:" + kind + ":" + session).hashCode(), i,
                PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return unlockFirst(new Notification.Action.Builder(null, label, pi).addRemoteInput(ri.build()).setAllowGeneratedReplies(false)).build();
    }

    /** Hand a typed answer to the app's page (it holds the connection Hermes asked on). If the app isn't
     *  running, say so and offer to open the chat with the text already in the composer. */
    void answerFromNotification(Intent i) {
        Bundle res = android.app.RemoteInput.getResultsFromIntent(i);
        CharSequence cs = res == null ? null : res.getCharSequence(REMOTE_TEXT);
        String typed = cs == null ? "" : cs.toString().trim();
        final String text = typed.isEmpty() && i.hasExtra("text") ? i.getStringExtra("text").trim() : typed; // a choice button
        String kind = i.getStringExtra("kind");
        String session = i.getStringExtra("session");
        String t = tag("ask".equals(kind) ? "ask" : "reply", session);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (!text.isEmpty() && openToUnlock(session, text, "answer " + kind)) return;
        if ("ask".equals(kind) && !text.isEmpty() && pendingAsk != null) {
            pendingAsk = null; // answered (or it failed and says so): the chip goes back to the status
            main.removeCallbacks(expireAskTask);
            postStatus();
        }
        if (text.isEmpty()) {
            nm.cancel(t, 2);
            dropEmptySummary(nm, t);
            return;
        }
        MainActivity a = MainActivity.current;
        java.util.function.Consumer<Boolean> done = ok -> {
            if (ok) {
                nm.cancel(t, 2);
                dropEmptySummary(nm, t);
                return;
            }
            Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("draft", text.length() > 20000 ? text.substring(0, 20000) : text);
            if (session != null && !session.isEmpty()) open.putExtra("session", session);
            PendingIntent pi = PendingIntent.getActivity(this, ("draft:" + session).hashCode(), open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = alertBuilder(CH_ALERT, "Couldn't send your answer",
                    "ask".equals(kind) ? "The question is no longer open here. Tap to open the chat; your text is in the box."
                            : "Hermes isn't connected. Tap to open the chat; your text is in the box.", session, false)
                    .setContentIntent(pi);
            postGrouped(nm, t, b.build());
        };
        if (a == null) {
            done.accept(false);
            return;
        }
        main.post(() -> a.deliverAnswer(kind, session, text, done));
    }

    String dashToken = "";
    /** The approval waiting for an answer: its buttons ride on the island chip. */
    JSONObject pendingApproval;

    synchronized String dashboardToken(boolean refresh) {
        if (refresh || dashToken.isEmpty()) {
            String html = MainActivity.httpGet(MainActivity.BASE_URL + "/");
            java.util.regex.Matcher m = html == null ? null : MainActivity.TOKEN.matcher(html);
            dashToken = (m != null && m.find()) ? m.group(1) : "";
        }
        return dashToken;
    }

    Notification.Builder alertBuilder(String channel, String title, String body, String session, boolean urgent) {
        Notification.Builder b = new Notification.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(Color.parseColor("#D9A441"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setGroup(GROUP)
                .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
                .setContentIntent(openApp(session));
        if (urgent) b.setCategory(Notification.CATEGORY_REMINDER);
        return b;
    }

    /** Also called by MainActivity: its own alerts (masked prompts) post on "needs_you" before the service may run. */
    static void createChannels(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel status = new NotificationChannel(CH_STATUS, "Status", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("Pinned: what Hermes is doing right now");
        status.setShowBadge(false);
        NotificationChannel idle = new NotificationChannel(CH_IDLE, "Idle", NotificationManager.IMPORTANCE_LOW);
        idle.setDescription("The small card shown while Hermes is idle. Set it to Minimised to hide its status-bar icon.");
        idle.setShowBadge(false);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Needs you", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Approvals and questions from Hermes");
        NotificationChannel reply = new NotificationChannel(CH_REPLY, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        reply.setDescription("A reply finished while the app was closed");
        NotificationChannel learn = new NotificationChannel(CH_LEARN, "Learning", NotificationManager.IMPORTANCE_LOW);
        learn.setDescription("Skill and memory updates from Hermes's self-improvement");
        learn.setShowBadge(false);
        NotificationChannel jobs = new NotificationChannel(CH_JOBS, "Scheduled jobs", NotificationManager.IMPORTANCE_DEFAULT);
        jobs.setDescription("Cron job results");
        jobs.setShowBadge(false);
        NotificationChannel playback = new NotificationChannel(TtsMedia.CH_PLAYBACK, "Reading aloud", NotificationManager.IMPORTANCE_LOW);
        playback.setDescription("Pause, skip or stop a reply being read aloud");
        playback.setShowBadge(false);
        NotificationChannel phone = new NotificationChannel(CH_PHONE, "Phone access", NotificationManager.IMPORTANCE_DEFAULT);
        phone.setDescription("Shizuku stopped or not running");
        phone.setShowBadge(false);
        NotificationChannel upd = new NotificationChannel(UpdateNotice.CH_UPDATE, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
        upd.setDescription("A newer Hermes Mobile version is available");
        upd.setShowBadge(false);
        NotificationChannel pair = new NotificationChannel(AdbPairing.CH_PAIR, "Pairing", NotificationManager.IMPORTANCE_HIGH);
        pair.setDescription("The Wireless debugging pairing code, while you set up Hermes Mobile");
        pair.setShowBadge(false);
        for (NotificationChannel c : new NotificationChannel[]{status, idle, alert, reply, learn, jobs, playback, phone, upd, pair}) nm.createNotificationChannel(c);
        nm.deleteNotificationChannel("hermes"); // v0.1 channel, replaced by the ones above
        nm.deleteNotificationChannel("learning"); // replaced by learning2/jobs2, which don't badge the icon
        nm.deleteNotificationChannel("jobs");
    }
}
