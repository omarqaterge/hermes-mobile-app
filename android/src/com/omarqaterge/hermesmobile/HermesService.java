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

import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Keeps Hermes's pinned status notification ("Running `ls`", "Thinking…", "Ready") and posts
 * every Hermes notification with the app's own icon. The hermes-mobile plugin inside Hermes
 * POSTs events to 127.0.0.1:9121/event with the shared key (written to Termux's
 * ~/.hermes-mobile/key), or after verifying this listener with local authentication
 * (EventsListener). Loopback only: other devices can't reach it.
 */
public class HermesService extends Service {
    static final int PORT = 9121;
    static final int STATUS_ID = 1;
    static final int SHIZUKU_ID = 9;
    /** "Hermux can't hear from Hermes": the listener could not open its port. */
    static final int LOCAL_ALERT_ID = 12;
    static final String CH_PHONE = "phone", SHIZUKU_PKG = "moe.shizuku.privileged.api";
    static final String CH_STATUS = "status", CH_IDLE = "idle", CH_ALERT = "needs_you", CH_REPLY = "replies",
            CH_LEARN = "learning2", CH_JOBS = "jobs2"; // v2 ids: the first ones badged the icon and a channel's badge flag can't change

    static volatile boolean running = false;
    static volatile HermesService instance;
    ServerSocket server;
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
        /** The plugin started the host with local authentication ({@code "auth":"mac"}): every request opens with a hello. */
        final boolean mac;

        BgApp(String session, String pkg, String label, String action, int port, String token, long since, boolean mac) {
            this.session = session; this.pkg = pkg; this.label = label; this.action = action;
            this.port = port; this.token = token; this.since = since; this.mac = mac;
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
        BgApp old = bgApp;
        bgApp = b;
        main.removeCallbacks(expireBgTask);
        boolean repost = false;
        if (b != null) main.postDelayed(expireBgTask, BG_TTL_MS);
        else {
            main.removeCallbacks(bgThumbTask);
            if (bgThumb != null) {
                bgThumb = null;
                repost = true;
            }
        }
        synchronized (this) {
            // The chip's tap opens the live viewer only while the app is in use for the chip's chat: re-post when that flips.
            if (bgForChip(old) != bgForChip(b)) repost = true;
            if (repost && lastWorking) postStatus();
        }
        MainActivity a = MainActivity.current;
        if (a != null) a.pushBg();
    }

    /** A small picture of the hidden screen for the working chip's expanded card (its large icon); null = none.
     *  Fetched once per plugin event (open / each action), so it costs nothing while Hermes isn't using an app. */
    volatile android.graphics.Bitmap bgThumb = null;
    final Runnable bgThumbTask = this::fetchBgThumb;
    static final int THUMB_PX = 256;

    /** Hermes is using this app for the chat the working chip shows. */
    boolean bgForChip(BgApp b) {
        return b != null && b.session.equals(lastSession);
    }

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
        if (session.isEmpty() || port < 1024 || port > 65535) return;
        // "auth":"mac": the host takes only requests after a hello it answers with this token as the key (LocalClient,
        // role bghost). Otherwise an older plugin started it: the app sends it nothing (no live view, no taps, no typed
        // text without a proof of who answers) and asks for the plugin's update instead; the agent's tool still works.
        String auth = e.optString("auth", "");
        if (LocalClient.bgOld(auth, token)) {
            showPluginNotice(this, true);
            main.post(() -> PluginSync.maybeApply(this));
            return;
        }
        LocalClient.BgMode mode = LocalClient.bgMode(auth, token);
        if (mode == LocalClient.BgMode.NONE) return;
        boolean mac = mode == LocalClient.BgMode.MAC;
        BgApp old = bgApp;
        String pkg = e.optString("pkg", "");
        long since = old != null && old.session.equals(session) && old.pkg.equals(pkg) ? old.since : System.currentTimeMillis();
        if (old == null || !old.session.equals(session) || !old.pkg.equals(pkg)) bgThumb = null; // another app: no stale picture
        setBgApp(new BgApp(session, pkg, e.optString("label", pkg), e.optString("action", ""), port, token, since, mac));
        // The event comes right after the action: give the app a moment to draw its result, then take the picture.
        main.removeCallbacks(bgThumbTask);
        main.postDelayed(bgThumbTask, 700);
    }

    /** No status beat for a while: Hermes (or its plugin) died mid-turn, so drop the stuck chip. */
    final Runnable expireWorkingTask = this::expireWorking;

    synchronized void expireWorking() {
        if (!lastWorking || System.currentTimeMillis() - lastBeat < WORKING_TTL_MS - 1000) return;
        workingSince = 0;
        lastWorking = false;
        lastShort = "";
        lastStatus = "Ready";
        lastTurnId = "";
        lastProc = "";
        stops.onExpireAll();
        main.removeCallbacks(stopTimeoutTask);
        postStatus();
        updateWake();
    }
    boolean lastWorking = false;
    String lastSub = null;
    String lastTitle = "";
    String lastTurnId = "";
    String lastProc = "";
    int lastSteps = 0, lastMore = 0;
    JSONObject lastTodo = null;
    org.json.JSONArray lastOthers = null;
    boolean lastReview = false;
    /** Per-turn Stop state shared by the status chip and the island panel (synchronized on {@code this}). */
    final IslandState.StopBook stops = new IslandState.StopBook();
    final Runnable stopTimeoutTask = this::expireStopTimeouts;
    /** The chat whose approval answer (from the notification) is being sent; its chip says "Sending your answer…". */
    String answering = null;
    final java.util.HashMap<String, JSONObject> doneInfo = new java.util.HashMap<>();
    // A short-lived "flash" in the status chip (done, memory/skill updates); reverts after FLASH_MS.
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
        HermuxApp.log(this).event("service", "app_service_start");
        DevTools.recheck(this); // a restarted process has remote debugging off: drop a notification the old one left
        loadUnseen();
        try {
            ensureKey();
        } catch (LocalKey.NotSaved e) {
            // storage refused the new key: nothing uses one until a later call saves it
        }
        // The typed call is API 29 and the special-use type API 34; older Android uses the manifest's type.
        if (Build.VERSION.SDK_INT >= 34) startForeground(STATUS_ID, statusNotification("Ready", null, false), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(STATUS_ID, statusNotification("Ready", null, false));
        running = true;
        instance = this;
        // Before the first share (onStartCommand): a rotation after an app update, then the switch (LocalKey.tick).
        try {
            report(this, keys(this).tick(facts(this), switchRunner(this)));
        } catch (RuntimeException e) {
            // nothing changed: the next trigger looks again
        }
        listen();
        armLostCheck(); // a beating installer from before this start gets LOST_MS to be heard again
        rearmWake();
        ShizukuKeeper.armCheck(this); // once, 90 s of real time: after a reboot Shizuku doesn't start by itself, so no binder arrives
        main.postDelayed(updateCheck, 120_000);
        // The plugin in Debian may be older than this APK's (after an app update): compare once Hermes had time to start.
        main.postDelayed(() -> PluginSync.onServiceStart(this), 30_000);
    }

    /** No turn running (by the plugin's beats), no approval or question waiting: a plugin update may restart Hermes. */
    synchronized boolean hermesIdle() {
        boolean beating = lastWorking && System.currentTimeMillis() - lastBeat < WORKING_TTL_MS;
        return !beating && pendingApproval == null && pendingAsk == null;
    }

    /** New-release notice: one GitHub request every 12 h at most (UpdateNotice throttles); the timer does not wake the CPU. */
    private final Runnable updateCheck = new Runnable() {
        @Override
        public void run() {
            UpdateNotice.check(HermesService.this, false);
            main.postDelayed(this, UpdateNotice.CHECK_MS);
        }
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
            stopTurn(intent.getStringExtra("session"), intent.getStringExtra("turn_id"));
            return START_STICKY;
        }
        if (intent != null && DevTools.ACTION_OFF.equals(intent.getAction())) {
            DevTools.turnOff(this); // the Turn off button of the remote-debugging notification (this service is not exported)
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
    static final int TICKER_PORT = 9122; // the poke listener of cron_ticker.py (in the plugin folder)
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

    /** Hermes's ticker sleeps on a clock that stops while the phone sleeps: wake it so the due job starts now. The
     *  ticker is verified first (LocalClient.poke: the hello line, then a signed POKE; the key never goes on the wire). */
    void pokeTicker() {
        new Thread(() -> {
            try {
                LocalClient.poke(TICKER_PORT, keys(this));
                keys(this).tickerSeen(true); // a verified poke: the ticker on the port runs the new code
            } catch (LocalClient.Unverified u) {
                // not verified (or an older ticker that doesn't answer the hello): nothing was sent but the hello, and
                // the job starts on the next tick (≤ 60 s). No alert.
                noteUnverified(this, "ticker", u.why);
            } catch (Exception ignored) {
            }
        }, "hermes-poke").start();
    }

    // ── local authentication as a client: what the app does when a local server isn't verified ──
    /** "Hermux stopped talking to Hermes": the dashboard could not be verified. */
    static final int DASH_ALERT_ID = 13;
    /** "Update the Hermux plugin": the installed plugin is too old to answer the hello. */
    static final int PLUGIN_NOTICE_ID = 14;
    /** Every try at the dashboard's token reports here (MainActivity.dashboardToken); Watch decides what follows. */
    static final LocalDashboard.Watch dashWatch = new LocalDashboard.Watch();
    static volatile boolean dashAlert = false, pluginNotice = false;
    private static final Object NOTICE_LOCK = new Object();
    private static final java.util.Map<String, Long> unverifiedNotedAt = new java.util.HashMap<>();
    /** At most one later try at the dashboard is waiting (Watch asks for it); it runs off the main thread. */
    private final Runnable dashRecheck = () -> new Thread(() -> MainActivity.dashboardToken(this), "hermes-dash-check").start();

    /** The diagnostic event {@code local unverified port=<port> why=<why> side=app}, at most once a minute per port and reason. */
    static void noteUnverified(Context c, String port, String why) {
        if (!LocalClient.REASONS.contains(why)) why = "no_hello";
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (unverifiedNotedAt) {
            Long last = unverifiedNotedAt.get(port + " " + why);
            if (!EventsListener.every(last == null ? -1 : last, now, 60_000L)) return;
            unverifiedNotedAt.put(port + " " + why, now);
        }
        HermuxApp.log(c).event("local", "unverified", "port", port, "why", why, "side", "app");
    }

    /** A dashboard hello verified: the alert and the plugin notice go. Any thread. */
    static void dashboardVerified(Context c) {
        act(c, dashWatch.verified());
    }

    /** A try at the dashboard failed with {@code why} (LocalClient.REASONS): nothing was sent but the hello. Any thread. */
    static void dashboardFailed(Context c, String why) {
        if (!"no_answer".equals(why)) noteUnverified(c, "dashboard", why); // nothing answering is Hermes starting
        android.content.SharedPreferences p = c.getSharedPreferences("hermes", MODE_PRIVATE);
        String[] apk = PluginSync.apk(c);
        LocalDashboard.Plugin plugin = LocalDashboard.plugin(p.getString("plugin_installed", ""), apk == null ? null : apk[0]);
        act(c, dashWatch.failed(why, android.os.SystemClock.elapsedRealtime(), plugin, PluginSync.busyRunning()));
    }

    private static void act(Context c, LocalDashboard.Watch.Step st) {
        switch (st.act) {
            case CLEAR:
                showDashAlert(c, false);
                showPluginNotice(c, false);
                break;
            case UPDATE_PLUGIN:
                showPluginNotice(c, true);
                PluginSync.maybeApply(c); // the connection is down anyway, so the update may go while the app is open
                break;
            case SHARE_KEY: {
                // Through Termux's RUN_COMMAND, never to the port; the Watch asks for it once per episode. "Handed over"
                // is this share's own result, so an alert never rests on an earlier share.
                HermesService s = instance;
                dashWatch.shared(s != null && s.shareKeyWithTermux());
                break;
            }
            case ALERT:
                showDashAlert(c, true);
                break;
            default:
                break;
        }
        HermesService s = instance;
        if (st.recheckMs >= 0 && s != null) {
            s.main.removeCallbacks(s.dashRecheck);
            s.main.postDelayed(s.dashRecheck, st.recheckMs);
        }
    }

    /** The one alert the page's banner shows (LocalDashboard.alertKind), or null. */
    static String alertKind() {
        HermesService s = instance;
        return LocalDashboard.alertKind(s != null && s.localAlert, dashAlert);
    }

    /** "Hermux stopped talking to Hermes" on (until a hello verifies) or off: a notification and the page's banner. */
    static void showDashAlert(Context c, boolean on) {
        synchronized (NOTICE_LOCK) {
            if (on == dashAlert) return;
            dashAlert = on;
        }
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (on) {
                createChannels(c);
                Notification.Builder b = new Notification.Builder(c, CH_ALERT)
                        .setSmallIcon(R.drawable.ic_stat_hermes)
                        .setContentTitle(LocalDashboard.ALERT_TITLE)
                        .setContentText(LocalDashboard.ALERT_TEXT)
                        .setStyle(new Notification.BigTextStyle().bigText(LocalDashboard.ALERT_TEXT + "\n\n" + LocalDashboard.ALERT_MORE))
                        .setOnlyAlertOnce(true)
                        .setAutoCancel(true);
                Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
                if (open != null)
                    b.setContentIntent(PendingIntent.getActivity(c, DASH_ALERT_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                nm.notify(DASH_ALERT_ID, b.build());
            } else nm.cancel(DASH_ALERT_ID);
        } catch (Exception ignored) {
            // notifications not allowed: the page still shows it
        }
        MainActivity a = MainActivity.current;
        if (a != null) a.pushLocalAlert();
    }

    /** The plugin notice's text as last posted (null while it is off). */
    private static String pluginNoticeText = null;

    /** PluginSync's state changed: a plugin notice that is up gets the text for the new state. */
    static void refreshPluginNotice(Context c) {
        if (pluginNotice) showPluginNotice(c, true);
    }

    private static long restVerifiedAt = -1;

    /** A REST call's hello and answer both verified: like a verified token try, at once while an alert or the notice
     *  is up, otherwise at most every 10 s (it only resets the counts then). */
    static void restVerified(Context c) {
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (NOTICE_LOCK) {
            if (!dashAlert && !pluginNotice && !EventsListener.every(restVerifiedAt, now, 10_000L)) return;
            restVerifiedAt = now;
        }
        dashboardVerified(c);
    }

    /** "Update the Hermux plugin" on or off; a plugin the app won't replace by itself points at Update anyway. The
     *  text follows PluginSync's state (refreshPluginNotice); the same text is not posted twice. */
    static void showPluginNotice(Context c, boolean on) {
        String state = c.getSharedPreferences("hermes", MODE_PRIVATE).getString("plugin_state", "");
        String text = on ? LocalDashboard.updateText(state, PluginSync.wanted(c)) : null;
        String act;
        synchronized (NOTICE_LOCK) {
            act = LocalDashboard.noticeAction(pluginNotice, pluginNoticeText, on, text);
            pluginNotice = on;
            pluginNoticeText = text;
        }
        if (act.equals("none")) return;
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (act.equals("post")) {
                createChannels(c);
                Notification.Builder b = new Notification.Builder(c, CH_PHONE)
                        .setSmallIcon(R.drawable.ic_stat_hermes)
                        .setContentTitle(LocalDashboard.UPDATE_TITLE)
                        .setContentText(text)
                        .setStyle(new Notification.BigTextStyle().bigText(text))
                        .setOnlyAlertOnce(true)
                        .setAutoCancel(true);
                Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
                if (open != null)
                    b.setContentIntent(PendingIntent.getActivity(c, PLUGIN_NOTICE_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                nm.notify(PLUGIN_NOTICE_ID, b.build());
            } else nm.cancel(PLUGIN_NOTICE_ID);
        } catch (Exception ignored) {
            // notifications not allowed
        }
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
        HermuxApp.log(this).event("service", "app_service_stop");
        running = false;
        instance = null;
        ShizukuKeeper.stop(); // also removes the 90 s check
        main.removeCallbacks(updateCheck);
        main.removeCallbacks(retryBind);
        main.removeCallbacks(dashRecheck);
        if (voice != null) voice.destroy();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
        }
        listening = false;
        try {
            getSystemService(NotificationManager.class).cancel(LOCAL_ALERT_ID); // this run's state; the next run decides again
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── telling the page when Hermes answers ────────────────
    static final long READY_POLL_MS = 500;
    static final long READY_WATCH_MS = 180_000;
    private final java.util.concurrent.atomic.AtomicBoolean readyWatch = new java.util.concurrent.atomic.AtomicBoolean();

    /** The page lost Hermes: look at the dashboard until it answers, then tell the page, which otherwise only notices at
     *  its next backoff step (up to 15 s late). Only while the app is on screen, READY_WATCH_MS at most; a port nobody
     *  listens on refuses at once, so a try costs next to nothing and Python is touched only once it is up. */
    static void watchReady() {
        HermesService s = instance;
        if (s == null || !MainActivity.visible || !s.readyWatch.compareAndSet(false, true)) return;
        new Thread(s::runReadyWatch, "hermes-ready").start();
    }

    private void runReadyWatch() {
        long end = android.os.SystemClock.elapsedRealtime() + READY_WATCH_MS;
        try {
            while (instance == this && MainActivity.visible && android.os.SystemClock.elapsedRealtime() < end) {
                Thread.sleep(READY_POLL_MS);
                if (!MainActivity.visible || !MainActivity.dashboardAnswers(this)) continue;
                MainActivity a = MainActivity.current;
                if (a != null) a.pushHermesReady();
                return;
            }
        } catch (InterruptedException ignored) {
        } finally {
            readyWatch.set(false);
        }
    }

    // ── key shared with the plugin ──────────────────────────
    private static LocalKey keys;

    /** The one owner of the shared key (LocalKey) over the "hermes" preferences, for the service and MainActivity. */
    static synchronized LocalKey keys(Context c) {
        if (keys == null) {
            Context app = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            final SharedPreferences p = app.getSharedPreferences("hermes", MODE_PRIVATE);
            keys = new LocalKey(new LocalKey.Store() {
                @Override public String getString(String name) { return p.getString(name, null); }
                @Override public long getLong(String name) { return p.getLong(name, 0); }
                @Override public boolean getBoolean(String name) { return p.getBoolean(name, false); }
                @Override public Object get(String name) { return p.getAll().get(name); }
                @Override public boolean save(java.util.Map<String, Object> changes) {
                    SharedPreferences.Editor e = p.edit();
                    for (java.util.Map.Entry<String, Object> en : changes.entrySet()) {
                        Object v = en.getValue();
                        if (v == null) e.remove(en.getKey());
                        else if (v instanceof Long) e.putLong(en.getKey(), (Long) v);
                        else if (v instanceof Boolean) e.putBoolean(en.getKey(), (Boolean) v);
                        else e.putString(en.getKey(), v.toString());
                    }
                    return e.commit(); // rare (a new key, a rotation, a grace cut): written before anyone is told
                }
            }, System::currentTimeMillis, android.os.SystemClock::elapsedRealtime, () -> bootCount(app), PluginSync.versionCode(app));
        }
        return keys;
    }

    /** The phone's boot count (Settings.Global.BOOT_COUNT, API 24, no permission), or -1 when it can't be read. */
    static int bootCount(Context c) {
        try {
            return android.provider.Settings.Global.getInt(c.getContentResolver(), android.provider.Settings.Global.BOOT_COUNT, -1);
        } catch (RuntimeException e) {
            return -1;
        }
    }

    /** The current key (made once, 24 random bytes as hex): LocalKey.current. */
    String ensureKey() {
        return keys(this).current();
    }

    boolean keyShared = false;

    /** Termux accepts our commands now (first good probe, installer DONE): share the event key if it never got there. */
    static void shareKeyAgain() {
        HermesService s = instance;
        if (s == null) return;
        s.keyShared = false;
        s.shareKeyWithTermux();
        localTick(s, true); // a fresh install's plugin and scripts are new: the switch may close the window now
    }

    // ── the end of local authentication's compatibility window (LocalKey.tick: rotations and the switch) ──
    /** One thread for every look at the switch, so two never run at once (a daemon thread that waits on its queue between looks). */
    private static final java.util.concurrent.ExecutorService KEY_THREAD = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "hermes-local-key");
        t.setDaemon(true);
        return t;
    });
    private static final Handler KEY_LATER = new Handler(Looper.getMainLooper());
    private static final Object TICK_LOCK = new Object();
    private static long tickedAt = -1;
    private static Context tickContext;
    /** The one later look a limited rotation asked for (a Handler message: no wake lock; a sleeping phone just waits). */
    private static final Runnable TICK_LATER = () -> { Context c = tickContext; if (c != null) localTick(c, true); };
    private static long legacyNotedDayAt = -1;

    /** What the app knows for the switch: from its own state only (LocalKey.Facts). */
    static LocalKey.Facts facts(Context c) {
        SharedPreferences p = c.getSharedPreferences("hermes", MODE_PRIVATE);
        String[] apk = PluginSync.apk(c);
        return new LocalKey.Facts(MainActivity.termuxOk(c) && !Uninstall.started(c), p.getString("plugin_state", ""),
                p.getString("plugin_installed", ""), apk == null ? null : apk[0], PluginSync.busyRunning() || setup(c).installing());
    }

    /** A look at the switch on its own thread: at once when {@code force}, else at most once a minute. Any thread. */
    static void localTick(Context ctx, boolean force) {
        final Context c = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (TICK_LOCK) {
            if (!force && !EventsListener.every(tickedAt, now, 60_000L)) return;
            tickedAt = now;
            tickContext = c;
        }
        try {
            KEY_THREAD.execute(() -> {
                try {
                    report(c, keys(c).tick(facts(c), switchRunner(c)));
                } catch (RuntimeException ignored) {
                }
            });
        } catch (RuntimeException ignored) {
        }
    }

    /** A raw key reached a server after the switch (the listener, or a Termux-side server's signed report): one more rotation, within its limits. */
    static void legacySeen(Context ctx) {
        final Context c = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        try {
            KEY_THREAD.execute(() -> {
                try {
                    report(c, keys(c).legacySeen(switchRunner(c)));
                } catch (RuntimeException ignored) {
                }
            });
        } catch (RuntimeException ignored) {
        }
    }

    /** The diagnostic events of a tick ({@code local key_rotated why=…}, {@code local enforced why=cap}), the share's state, the later look. */
    private static void report(Context c, LocalKey.Result r) {
        if (r.rotated != null) {
            HermuxApp.log(c).event("local", "key_rotated", "why", r.rotated, "side", "app");
            HermesService s = instance;
            if (s != null) s.keyShared = r.shared; // not handed over: the next trigger shares it
        }
        if (r.enforced != null) HermuxApp.log(c).event("local", "enforced", "why", r.enforced, "side", "app");
        if (r.paused) HermuxApp.log(c).event("local", "legacy_paused", "side", "app");
        lookLater(c);
        if (r.retryMs > 0) {
            synchronized (TICK_LOCK) {
                tickContext = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            }
            KEY_LATER.removeCallbacks(TICK_LATER);
            KEY_LATER.postDelayed(TICK_LATER, Math.min(r.retryMs + 1000, LocalKey.GRACE_MS));
        }
    }

    private static final android.app.AlarmManager.OnAlarmListener LOOK = () -> {
        Context c = tickContext;
        if (c != null) localTick(c, true);
    };

    /**
     * While local authentication's window is open, one more look within LocalKey.LOOK_EVERY_MS of real time, so the
     * window's count misses little before a shutdown: a non-waking, inexact alarm (ELAPSED_REALTIME: delivered at the
     * phone's next wake, never waking it), one at a time, none once the window is closed (bounded by the window).
     */
    private static void lookLater(Context c) {
        try {
            android.app.AlarmManager am = c.getSystemService(android.app.AlarmManager.class);
            if (am == null) return;
            am.cancel(LOOK);
            long ms = keys(c).lookAgainMs(MainActivity.termuxOk(c) && !Uninstall.started(c)); // none while not counting
            if (ms <= 0) return;
            synchronized (TICK_LOCK) {
                tickContext = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            }
            am.set(android.app.AlarmManager.ELAPSED_REALTIME, android.os.SystemClock.elapsedRealtime() + ms, "hermux:local-window", LOOK, KEY_LATER);
        } catch (RuntimeException ignored) {
            // no alarm: the next service start, request or plugin check looks instead
        }
    }

    /**
     * StartReceiver (the keeper wakes the app, e.g. for a key id Termux doesn't know) and a request under the previous
     * key: share the key again, only when the listener saw Termux use a key that isn't the current one
     * (LocalKey.reshareWanted: the keeper's hello names its kid, which counts), at most every 10 minutes.
     */
    static void reshareIfDue() {
        HermesService s = instance;
        if (s == null || !keys(s).reshareWanted()) return; // a bare nudge with nothing seen runs no Termux command
        try {
            KEY_THREAD.execute(s::shareKeyWithTermux);
        } catch (RuntimeException ignored) {
        }
    }

    /** termuxRunner, and nothing before Termux has accepted a command once (a fresh phone: Termux would show an error). */
    static LocalKey.Runner switchRunner(Context c) {
        LocalKey.Runner run = termuxRunner(c);
        return cmd -> {
            if (!MainActivity.termuxOk(c)) throw new IllegalStateException("not set up"); // shareKeyAgain shares it then
            run.run(cmd);
        };
    }

    /**
     * The RUN_COMMAND that runs one key command in Termux (sh -c), refused (it throws) once Uninstall has started or
     * without Termux's permission; a start that returns null counts as not handed over (LocalKey.starting).
     */
    static LocalKey.Runner termuxRunner(Context c) {
        LocalKey.Runner start = LocalKey.starting(cmd -> {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", cmd});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            return c.startForegroundService(i); // null: Termux's service could not be found
        });
        return cmd -> {
            if (Uninstall.started(c)) throw new IllegalStateException("uninstalling"); // nothing more goes into Termux
            if (c.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED)
                throw new IllegalStateException("no permission");
            start.run(cmd);
        };
    }

    // ── app-first setup: the installer's progress lines (SetupLines has the policy) ──
    static final SetupLines setup = new SetupLines();
    static boolean setupLoaded = false;

    /** The progress channel, with the copied command's token restored after a restart (prefs "hermes" setup_token). */
    static SetupLines setup(Context c) {
        synchronized (setup) {
            if (!setupLoaded) {
                setupLoaded = true;
                android.content.SharedPreferences sp = c.getSharedPreferences("hermes", MODE_PRIVATE);
                // No setup_seen (a token saved by an older build): read as nothing heard yet, so it blocks nothing.
                setup.resume(sp.getString("setup_token", ""), sp.getString("setup_failed", ""), sp.getInt("setup_seen", SetupLines.SEEN_NONE));
            }
        }
        return setup;
    }

    /** A new installer command was copied: remember its token (memory + prefs, so a service restart mid-install keeps it). */
    static void startSetup(Context c, String token) {
        setup(c).start(token);
        c.getSharedPreferences("hermes", MODE_PRIVATE).edit().putString("setup_token", token).remove("setup_failed").remove("setup_seen").apply();
        HermesService s = instance;
        if (s != null) s.main.post(s::armLostCheck);
    }

    /** The one delayed look at a beating installer (SetupLines.lostCheckIn): re-armed by each line, none once it is
     *  lost, done or failed. Main looper only; no wake lock (its clock stops in deep sleep, like the installer). */
    private final Runnable lostCheck = this::lostCheckNow;

    void armLostCheck() {
        main.removeCallbacks(lostCheck);
        long in = setup(this).lostCheckIn(SetupLines.nowMs());
        if (in >= 0) main.postDelayed(lostCheck, in);
    }

    private void lostCheckNow() {
        if (setup(this).state() != SetupLines.State.LOST) {
            armLostCheck();
            return;
        }
        HermuxApp.log(this).event("setup", "lost", "step", setup(this).step());
        MainActivity a = MainActivity.current;
        if (a != null) a.setupChanged();
        setupNotice("Setup stopped: open Hermux");
    }

    private void setupNotice(String text) {
        main.post(() -> {
            try {
                getSystemService(NotificationManager.class).notify(STATUS_ID, statusNotification(text, null, false));
            } catch (Exception ignored) {
            }
        });
    }

    /** The probe found the finished marker (MainActivity.probeTermux): a run whose DONE never arrived ends as DONE. */
    static void setupFinishedByProbe(Context c) {
        if (!setup(c).finishedByProbe()) return;
        c.getSharedPreferences("hermes", MODE_PRIVATE).edit().remove("setup_token").remove("setup_failed").remove("setup_seen").apply();
        HermuxApp.log(c).event("setup", "done", "by", "probe");
        MainActivity.setTermuxOk(c);
        HermesService s = instance;
        if (s != null) {
            s.main.removeCallbacks(s.lostCheck);
            s.setupNotice("Ready");
            s.main.post(() -> PluginSync.run(s, "check", false));
        }
    }

    /** The installer's steps in the diagnostic log: the step's name and whether it failed, never the line's words. */
    private void logSetupLine(String line) {
        String[] p = line.split(" ", 3);
        if (line.startsWith("STEP ")) HermuxApp.log(this).event("setup", "step", "name", p[1]);
        else if (line.startsWith("FAIL ")) HermuxApp.log(this).event("setup", "fail", "step", p[1]);
        else if (line.equals("DONE")) HermuxApp.log(this).event("setup", "done");
    }

    /** POST /setup {token, line}: keep it, push it to the page, show the step in the notification. */
    int setupPost(String body) {
        String[] tl = SetupLines.parse(body);
        if (tl == null) return SetupLines.BAD_LINE;
        SetupLines sl = setup(this);
        boolean wasLost = sl.state() == SetupLines.State.LOST;
        int seenBefore = sl.seen();
        int r = sl.add(tl[0], tl[1], tl[2], System.currentTimeMillis() / 1000);
        if (r != SetupLines.OK) return r;
        String line = tl[1];
        if (sl.seen() != seenBefore && sl.active())
            getSharedPreferences("hermes", MODE_PRIVATE).edit().putInt("setup_seen", sl.seen()).apply(); // at most twice per command
        main.post(this::armLostCheck);
        if (line.equals("ALIVE")) {
            // The beat: nothing to show, log or push, unless it brings back an installer that read as stopped.
            MainActivity a = MainActivity.current;
            if (wasLost && a != null) a.runOnUiThread(a::setupChanged);
            return r;
        }
        logSetupLine(line);
        MainActivity a = MainActivity.current;
        if (a != null) a.pushSetupLine(line);
        String text = null;
        if (line.startsWith("STEP ")) {
            getSharedPreferences("hermes", MODE_PRIVATE).edit().remove("setup_failed").apply();
            String[] p = line.split(" ", 3);
            text = "Setting up: " + (p.length > 2 && !p[2].trim().isEmpty() ? p[2].trim() : p[1]);
        } else if (line.startsWith("FAIL ")) {
            getSharedPreferences("hermes", MODE_PRIVATE).edit().putString("setup_failed", sl.failedStep()).apply();
            text = "Setup stopped: open Hermux";
        } else if (line.equals("DONE")) {
            getSharedPreferences("hermes", MODE_PRIVATE).edit().remove("setup_token").remove("setup_failed").remove("setup_seen").apply();
            MainActivity.setTermuxOk(this);
            text = "Ready";
        }
        if (SetupLines.checksPlugin(line)) {
            // The installer put a new plugin and new scripts in place: check them now (a one-off, no timer), so local
            // authentication's switch can see its conditions instead of waiting for the next service start.
            main.post(() -> PluginSync.run(this, "check", false));
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

    /** True when this call handed the key's command to Termux (a start that returned null counts as not handed over). */
    boolean shareKeyWithTermux() {
        if (Uninstall.started(this)) return false; // Settings → Uninstall Hermux: nothing more goes into Termux
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return false;
        // Shared only once the key is saved and the command handed over (LocalKey.share); otherwise keyShared stays false
        // and the next trigger tries again. The key goes to a temporary file moved over the old one (LocalKey.shareCommand),
        // with the enforced file once the switch has begun (LocalKey.shareMode).
        boolean handed = keys(this).share(termuxRunner(this));
        keyShared = handed;
        return handed;
    }

    // ── loopback event listener ─────────────────────────────
    /** The longest one connection may hold the listener thread, whatever it sends (see serve). */
    static final long REQUEST_DEADLINE_MS = 10_000;
    /** The listener's socket in this process, whichever service instance opened it (so a newer one can close it). */
    static ServerSocket listener;
    /** This instance's accept loop holds the port. */
    volatile boolean listening = false;
    private final java.util.concurrent.atomic.AtomicBoolean binding = new java.util.concurrent.atomic.AtomicBoolean();
    // Main thread only: the run of failed tries to open the port (EventsListener decides when the next one comes).
    private final EventsListener.Retry retry = new EventsListener.Retry();
    private long lastNudgeAt = -1;
    private volatile boolean localAlert = false;
    // Listener thread only: the diagnostic events below are rate-limited.
    private long legacyNotedAt = -1, refusedNotedAt = -1;
    private final Runnable retryBind = this::listen;

    /** Opens the port on a thread of its own, unless it is open or a try is under way. */
    void listen() {
        if (instance != this || listening || !binding.compareAndSet(false, true)) return;
        new Thread(this::serve, "hermes-events").start();
    }

    /** MainActivity.onResume, StartReceiver, BootReceiver: try to open the port now if it isn't open (at most every 10 s). */
    static void ensureListening() {
        HermesService s = instance;
        if (s != null) s.main.post(s::nudge);
    }

    private void nudge() {
        if (instance != this || listening) return;
        if (localAlert) pushLocalAlert(true); // a page that loaded since then gets the alert too
        long now = android.os.SystemClock.elapsedRealtime();
        if (!EventsListener.every(lastNudgeAt, now, EventsListener.NUDGE_MS)) return;
        lastNudgeAt = now;
        listen();
    }

    private static ServerSocket bindEvents() throws java.io.IOException {
        return new ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"));
    }

    /** Whether whatever holds the port proves it has our key (then it is a listener of ours left open). Sends only a hello. */
    private boolean selfHello() {
        try (LocalClient.Session ignored = LocalClient.open(EventsListener.ROLE, PORT, keys(this))) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void serve() {
        ServerSocket ss;
        try {
            try {
                ss = bindEvents();
            } catch (java.net.BindException e) {
                if (!selfHello()) throw e;
                // Our own listener, left open by an earlier start in this process: close it and take the port at once,
                // but only while this instance is the live one (a destroyed one must never close the live listener).
                ServerSocket stale;
                synchronized (HermesService.class) {
                    if (!current()) throw e;
                    stale = listener;
                    listener = null;
                }
                HermuxApp.log(this).event("local", "port_taken", "port", "events", "why", "self");
                if (stale != null) try { stale.close(); } catch (Exception ignored) { }
                ss = bindEvents();
            }
        } catch (Exception e) {
            // `binding` stays set until bindFailed has run, so a nudge in between can't start a second try.
            main.post(this::bindFailedThenFree);
            return;
        }
        synchronized (HermesService.class) {
            if (!current()) { // destroyed while binding: let the live instance have the port
                try { ss.close(); } catch (Exception ignored) { }
                binding.set(false);
                return;
            }
            listener = ss;
        }
        server = ss;
        listening = true;
        binding.set(false);
        main.post(this::bindOk);
        try {
            while (running) {
                Socket s = ss.accept();
                boolean handedOff = false;
                // Each read waits at most 3 s, but a client that trickles a byte at a time (even a first line with no
                // newline) would keep this one thread for ever: the whole request, read and answered, gets 10 s, then
                // the socket is closed under it. Ordinary requests take milliseconds, so they are not affected.
                final Socket sock = s;
                final Runnable watchdog = () -> { try { sock.close(); } catch (Exception ignored) { } };
                main.postDelayed(watchdog, REQUEST_DEADLINE_MS);
                try {
                    s.setSoTimeout(3000);
                    handedOff = handle(s);
                } catch (Exception ignored) {
                } finally {
                    main.removeCallbacks(watchdog);
                    if (!handedOff) try { s.close(); } catch (Exception ignored) { }
                }
            }
        } catch (Exception e) {
            // closed by onDestroy or by a newer listener of ours, or the port was lost
        } finally {
            try { ss.close(); } catch (Exception ignored) { }
            synchronized (HermesService.class) { if (listener == ss) listener = null; }
            if (server == ss) {
                listening = false;
                // lost while running: open it again (one try at a time)
                if (current() && binding.compareAndSet(false, true)) main.post(this::bindFailedThenFree);
            }
        }
    }

    /** This instance is the live service. */
    private boolean current() {
        return running && instance == this;
    }

    private void bindFailedThenFree() {
        try {
            bindFailed();
        } finally {
            binding.set(false);
        }
    }

    /** The port could not be opened (main thread): the alert, and the next try as EventsListener says (no wake lock). */
    private void bindFailed() {
        if (instance != this || listening) return;
        long d = retry.failed(android.os.SystemClock.elapsedRealtime()); // -1 once given up: a nudge's one try, nothing scheduled
        if (retry.started) HermuxApp.log(this).event("local", "port_taken", "port", "events");
        // From the second failure in a row: a port that frees itself within a second (a restart) is no reason to alert.
        if (retry.failures >= 2) showLocalAlert(true);
        main.removeCallbacks(retryBind);
        if (d >= 0) main.postDelayed(retryBind, d);
    }

    /** The port is open (main thread). The run of failures is kept for its hour, so a port lost again soon backs off. */
    private void bindOk() {
        if (instance != this) return;
        main.removeCallbacks(retryBind);
        retry.opened();
        showLocalAlert(false);
    }

    /** "Hermux can't hear from Hermes" while the port is not open: a notification and the page's banner. */
    private void showLocalAlert(boolean on) {
        if (on == localAlert) return;
        localAlert = on;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (on) nm.notify(LOCAL_ALERT_ID, localAlertNotification());
            else nm.cancel(LOCAL_ALERT_ID);
        } catch (Exception ignored) {
            // notifications not allowed: the page still shows it
        }
        pushLocalAlert(on);
    }

    private static void pushLocalAlert(boolean on) {
        MainActivity a = MainActivity.current;
        if (a != null) a.pushLocalAlert(); // the banner shows whichever alert is on (alertKind)
    }

    private Notification localAlertNotification() {
        String text = "Another app on this phone is using the connection Hermux listens on. Restart the phone to fix it.";
        Notification.Builder b = new Notification.Builder(this, CH_ALERT)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setContentTitle("Hermux can't hear from Hermes")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setOnlyAlertOnce(true)
                .setAutoCancel(true);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null)
            b.setContentIntent(PendingIntent.getActivity(this, LOCAL_ALERT_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return b.build();
    }

    /** A request came in with the raw key: recorded at most once an hour. */
    private void noteLegacyKey() {
        long now = android.os.SystemClock.elapsedRealtime();
        if (!EventsListener.every(legacyNotedAt, now, 3_600_000L)) return;
        legacyNotedAt = now;
        HermuxApp.log(this).event("local", "legacy_key", "port", "events");
    }

    /**
     * After the switch a request came with an accepted key in the raw header (refused like one without the key):
     * recorded at most once a day as {@code local legacy_key port=events side=app}, and one more rotation (LocalKey
     * limits it to once a day too). Listener thread.
     */
    private void noteLegacyRefused() {
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (TICK_LOCK) {
            if (!EventsListener.every(legacyNotedDayAt, now, LocalKey.LEGACY_EVERY_MS)) return;
            legacyNotedDayAt = now;
        }
        HermuxApp.log(this).event("local", "legacy_key", "port", "events", "side", "app");
        legacySeen(this);
    }

    /** A request after a hello had a missing or wrong MAC (answered 403): recorded at most once a minute. */
    private void noteRefused() {
        long now = android.os.SystemClock.elapsedRealtime();
        if (!EventsListener.every(refusedNotedAt, now, 60_000L)) return;
        refusedNotedAt = now;
        HermuxApp.log(this).event("local", "refused", "port", "events", "side", "app");
    }

    /** True when the socket now belongs to another thread (a /phonedata read), which closes it. */
    boolean handle(Socket s) throws Exception {
        // EventsListener reads it (LocalServer, role events): the hello and one signed request, or the raw key header.
        EventsListener.Request r;
        // Every connection (signed, raw key, a hello alone, refused) is a chance for local authentication's window to be
        // counted: at most once a minute (localTick), so a held old plugin's raw requests count too.
        localTick(this, false);
        try {
            r = EventsListener.read(s, keys(this), PhoneDataRoute.fail("forbidden"), PhoneDataRoute.fail("bad_request"), this::noteLegacyRefused);
        } catch (LocalServer.Refused e) {
            if ("refused".equals(e.why)) noteRefused();
            return false; // its answer is written
        }
        if (r == null) return false; // nothing asked: a bare connect, or a hello whose client went away
        if (r.auth() == LocalServer.Auth.MAC) {
            LocalKey k = keys(this);
            boolean wasRaw = k.rawAccepted();
            k.confirm(r.kid()); // step 3 of the switch, once a key written with the enforced file is in use
            if (wasRaw && !k.rawAccepted()) HermuxApp.log(this).event("local", "enforced", "why", "ready", "side", "app");
            if (k.stale(r.kid())) reshareIfDue(); // Termux still signs with the previous key: it missed the new one
            localTick(this, false);
        } else if (r.auth() == LocalServer.Auth.RAW) noteLegacyKey();
        OutputStream out = s.getOutputStream();
        switch (EventsListener.verdict(r)) { // which routes need the key: EventsListener decides
            case BUNDLE: {
                // GET /plugin-bundle/<token> = phone/plugin-update.sh fetching this APK's plugin (PluginSync, one-time token).
                byte[] b = PluginSync.bundleFor(this, r.bundleToken);
                out.write((b != null ? "HTTP/1.1 200 OK\r\nContent-Type: application/gzip\r\nContent-Length: " + b.length
                        : "HTTP/1.1 403 Forbidden\r\nContent-Length: 0").concat("\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                if (b != null) out.write(b);
                out.flush();
                return false;
            }
            case SETUP: {
                // POST /setup = the installer's progress (its own one-time token, see SetupLines).
                int res = setupPost(r.text());
                out.write((res == SetupLines.OK ? "HTTP/1.1 204 No Content\r\n" : res == SetupLines.BAD_TOKEN ? "HTTP/1.1 403 Forbidden\r\n" : "HTTP/1.1 400 Bad Request\r\n")
                        .concat("Content-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                return false;
            }
            case PHONEDATA: {
                // POST /phonedata = the agent's phone-data read (PhoneDataRoute), always a JSON answer. The read may take
                // seconds (a location fix): not on this thread, which must keep taking /event.
                final String reqBody = r.text();
                if (PhoneDataRoute.submit(() -> phoneDataReply(s, "HTTP/1.1 200 OK", PhoneDataRoute.answer(this, reqBody)))) return true;
                return phoneDataReply(s, "HTTP/1.1 200 OK", PhoneDataRoute.fail("failed"));
            }
            case NO_KEY: {
                // Without the key (raw /phonedata without it was already answered before its body was read).
                if (r.route == EventsListener.Route.PHONEDATA) return phoneDataReply(s, "HTTP/1.1 403 Forbidden", PhoneDataRoute.fail("forbidden"));
                out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
                return false;
            }
            default: { // EVENT, with the key
                out.write("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
                JSONObject ev = new JSONObject(r.text());
                String kind = ev.optString("kind", "");
                // Only the cron ticker sends these: signed, it runs the new code; with the raw key, an older one still runs.
                if ("wake_at".equals(kind) || "cron_idle".equals(kind)) keys(this).tickerSeen(r.auth() == LocalServer.Auth.MAC);
                if ("local_legacy".equals(kind)) {
                    // A Termux-side server refused a raw key after the switch: {port}. Counted only from a signed request.
                    String port = ev.optString("port", "");
                    if (r.auth() == LocalServer.Auth.MAC && ("dashboard".equals(port) || "ticker".equals(port))) legacySeen(this);
                    return false;
                }
                onEvent(ev);
                return false;
            }
        }
    }

    /** Writes a /phonedata answer (JSON, nothing else) and closes the socket, on whichever thread this runs. Always
     *  true: the socket is closed here, so the accept loop must not touch it again. */
    boolean phoneDataReply(Socket s, String status, String json) {
        // A client that stops reading must not hold this thread: a socket has no write timeout, so close it after 5 s.
        final Runnable killer = () -> { try { s.close(); } catch (Exception ignored) { } };
        main.postDelayed(killer, 5000);
        try (Socket sock = s) {
            byte[] b = json.getBytes(StandardCharsets.UTF_8);
            OutputStream o = sock.getOutputStream();
            o.write((status + "\r\nContent-Type: application/json\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            o.write(b);
            o.flush();
        } catch (Exception ignored) {
            // the plugin went away: nothing to tell it
        } finally {
            main.removeCallbacks(killer);
        }
        return true;
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
        String title = e.optString("title", "Hermux");
        String body = e.optString("body", "");
        String session = e.optString("session", null);
        String profile = e.optString("profile", "");
        NotificationManager nm = getSystemService(NotificationManager.class);
        switch (kind) {
            case "status": {
                boolean working = e.optBoolean("working", false);
                String proc = e.optString("proc", "");
                String turnId = working ? e.optString("turn_id", "") : "";
                double since = e.optDouble("since", 0);
                long sinceMs = working && since > 0 ? (long) (since * 1000) : 0;
                org.json.JSONArray others = working ? e.optJSONArray("others") : null;
                java.util.ArrayList<IslandState.LiveTurn> liveTurns = new java.util.ArrayList<>();
                if (working) {
                    String liveSes = session != null && !session.isEmpty() ? session : (lastSession == null ? "" : lastSession);
                    if (!liveSes.isEmpty()) liveTurns.add(new IslandState.LiveTurn(liveSes, turnId, sinceMs));
                    if (others != null) for (int k = 0; k < others.length(); k++) {
                        JSONObject o = others.optJSONObject(k);
                        if (o == null) continue;
                        String os = o.optString("session", "");
                        if (os.isEmpty()) continue;
                        double oSince = o.optDouble("since", 0);
                        liveTurns.add(new IslandState.LiveTurn(os, o.optString("turn_id", ""), oSince > 0 ? (long) (oSince * 1000) : 0));
                    }
                }
                stops.onStatus(proc, working, liveTurns, android.os.SystemClock.uptimeMillis());
                scheduleStopTimeout();
                // Another Hermes process going idle must not overwrite this process's active working chip or panel.
                if (!working && lastWorking && !lastProc.isEmpty() && !proc.isEmpty() && !proc.equals(lastProc)) return;
                if (working && workingSince == 0) workingSince = System.currentTimeMillis();
                if (!working) workingSince = 0;
                lastStatus = body.isEmpty() ? (working ? "Working…" : "Ready") : body;
                lastShort = working ? e.optString("short", "Hermux") : "";
                if (session != null && !session.isEmpty()) lastSession = session;
                lastTurnId = turnId;
                lastProc = working ? proc : "";
                lastSub = profile.isEmpty() || "default".equals(profile) ? null : profile;
                // The turn's progress for the expanded chip (plugin 0.8.36+; older plugins send none of these).
                lastTitle = working ? e.optString("title", "") : "";
                lastSteps = working ? e.optInt("steps", 0) : 0;
                lastTodo = working ? e.optJSONObject("todo") : null;
                lastOthers = others;
                lastMore = working ? e.optInt("more", 0) : 0;
                lastReview = working && e.optBoolean("review", false);
                if (working && sinceMs > 0) workingSince = sinceMs;
                boolean ended = lastWorking && !working;
                lastWorking = working;
                if (working) flashUntil = 0; // real work beats a flash
                lastBeat = System.currentTimeMillis();
                main.removeCallbacks(expireWorkingTask);
                if (working) main.postDelayed(expireWorkingTask, WORKING_TTL_MS);
                postStatus();
                updateWake();
                if (ended) main.postDelayed(() -> PluginSync.maybeApply(this), 15_000); // a quiet moment for a plugin update
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
            case "local_port": { // a Termux-side server could (not) open its port: {port, state}; a diagnostic record only
                String port = e.optString("port", ""), state = e.optString("state", "");
                if (LocalAuth.ROLES.contains(port) && ("taken".equals(state) || "ok".equals(state)))
                    HermuxApp.log(this).event("local", "taken".equals(state) ? "port_taken" : "port_ok", "port", port);
                return;
            }
            case "flash": {
                boolean doneFlash = e.optBoolean("done", false) || e.optString("short", "").contains("Done");
                if (doneFlash && session != null && !session.isEmpty()) {
                    String proc = e.optString("proc", "");
                    String turnId = e.optString("turn_id", "");
                    boolean stopEnded = stops.onDoneFlash(proc, session, turnId);
                    if (stopEnded) scheduleStopTimeout();
                    // The island panel's Done state, whatever the Done chip's rules below decide for the chip.
                    lastDone.remove(session); // one per chat, the newest last
                    lastDone.put(session, new IslandState.Done(session, turnId, IslandState.chatLine(title, profile), e.optString("reply", ""),
                            e.optInt("steps", 0), e.optLong("secs", 0), System.currentTimeMillis()));
                    while (lastDone.size() > IslandState.MAX_DONE) lastDone.remove(lastDone.keySet().iterator().next());
                    if (stopEnded) postStatus();
                    else IslandPanel.refresh(this);
                    if (MainActivity.visible) return; // the app is on screen: its own unread dots show it, no sticky chip
                    if (!NotifyChoice.finishes(this)) return; // Settings → Notifications → "When a task finishes" is off: no Done chip, no badge
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
                if (doneFlash && !NotifyChoice.finishes(this)) return; // nor a momentary Done chip
                // Momentary chip: done (green) or a memory/skill update.
                flashChip = e.optString("short", "Done");
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
                // A phone-data read: the app's own wording replaces the plugin's text everywhere (never the raw hex), and
                // only Allow once and Deny are offered.
                final JSONObject ev = phoneDataEvent(e);
                body = ev.optString("body", "");
                boolean ticking = pendingApproval != null;
                pending.arrived(PendingAsk.APPROVAL, session, ev.optString("request_id", ""), ev,
                        System.currentTimeMillis() + Math.max(1, e.optLong("timeout", 60)) * 1000L);
                syncPending();
                postStatus();
                updateWake();
                if (!ticking) main.postDelayed(this::tickApproval, 1000);
                if (MainActivity.visible) return; // no popup: the app shows its own sheet
                if (!NotifyChoice.needsMe(this)) return; // "When Hermux needs me" is off: it waits in the app, no pop-up and no chip
                Notification.Builder b = alertBuilder(CH_ALERT, title, clip(body, 600), session, true);
                hideOnLockScreen(b, ev.optBoolean("phone_data", false));
                // Answer right from the popup, like the in-app sheet.
                if (!ev.optBoolean("phone_data_unreadable", false)) b.addAction(approveAction(ev, "once", "Allow once"));
                if (ev.optBoolean("allow_session", true)) b.addAction(approveAction(ev, "session", "Allow session"));
                b.addAction(approveAction(ev, "deny", "Deny"));
                postGrouped(nm, tag(kind, session), b.build());
                return;
            }
            case "ask": {
                // HyperOS hides the popup after ~5 s: the question and its answers also ride on the island chip,
                // armed even while the app is on screen so leaving it unanswered still leaves a way to answer.
                pending.arrived(PendingAsk.ASK, session, "", e, System.currentTimeMillis() + ASK_TTL_MS);
                syncPending();
                main.postDelayed(expireAskTask, ASK_TTL_MS + 100); // each arrival has its own expiry check
                postStatus();
                if (MainActivity.visible) return; // no popup: the app shows its own sheet
                if (!NotifyChoice.needsMe(this)) return; // "When Hermux needs me" is off: it waits in the app, no pop-up and no chip
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
                if (NotifyChoice.finishes(this)) { // "When a task finishes" off: no card; reading the reply aloud is its own setting
                    Notification.Builder rb = alertBuilder(CH_REPLY, title, body, session, false);
                    if (session != null && !session.isEmpty()) rb.addAction(answerAction("reply", session, "Reply", null));
                    postGrouped(nm, tag("reply", session), badged(rb, unseen.size() + (session != null && !unseen.containsKey(session) ? 1 : 0)));
                }
                if ("reply".equals(kind)) readAloud(e, session);
                return;
            case "learning":
                flashChip = title.startsWith("Skill") ? "Skill" : "Memory";
                flashTitle = title;
                flashBody = body;
                flashColor = Color.parseColor("#7B61D9");
                flashUntil = System.currentTimeMillis() + FLASH_MS;
                postStatus();
                main.postDelayed(this::expireFlash, FLASH_MS + 100);
                postGrouped(nm, tag("learn", e.optString("id", title)), alert(CH_LEARN, title, body, session, false));
                return;
            case "cron":
                if (NotifyChoice.finishes(this)) postGrouped(nm, tag("cron", e.optString("id", session)), alert(CH_JOBS, title, body, session, false));
                return;
            case "clear":
                // The clear names its chat (not the request): only that chat's entries go; one naming no chat drops them all.
                if ("ask".equals(e.optString("what")) && pending.cleared(PendingAsk.ASK, session)) {
                    syncPending();
                    postStatus();
                }
                if ("approval".equals(e.optString("what")) && pending.cleared(PendingAsk.APPROVAL, session)) {
                    syncPending();
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

    /** Settings → Notifications changed (NotifyChoice): the chip shows or hides a waiting approval or question at once,
     *  and with "When Hermux needs me" off the approval and question pop-ups go. Nothing waiting is answered or dropped. */
    static void notifyChoicesChanged() {
        HermesService s = instance;
        if (s != null) s.applyNotifyChoices();
    }

    synchronized void applyNotifyChoices() {
        if (!NotifyChoice.needsMe(this)) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            try {
                for (android.service.notification.StatusBarNotification sn : nm.getActiveNotifications()) {
                    String t = sn.getTag();
                    if (sn.getId() == 2 && t != null && (t.startsWith("approval:") || t.startsWith("ask:"))) {
                        nm.cancel(t, 2);
                        dropEmptySummary(nm, t);
                    }
                }
            } catch (Exception ignored) {
                // getActiveNotifications can fail while the service is going away
            }
        }
        postStatus();
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
        IslandPanel.refresh(this); // the open island panel follows every change
    }

    /** The last answer sent (or tried) from here, for the island panel: it tells sent, failed and gone apart. */
    IslandState.Outcome lastOutcome;

    /** Records what came of an answer and hands the open panel the news. */
    void noteOutcome(String kind, String session, String request, String result, String reason) {
        synchronized (this) {
            lastOutcome = new IslandState.Outcome(kind, session, request, result, reason, System.currentTimeMillis());
        }
        IslandPanel.refresh(this);
    }

    /** What the island panel shows: a snapshot of the live state, from the fields the chip uses, in the chip's order. */
    synchronized IslandState islandState() {
        // Whatever "When Hermux needs me" says: that switch decides only whether notifications are posted; a panel the
        // user opened follows every question and request the service still holds.
        JSONObject q = pendingAsk;
        IslandState.Ask ask = null;
        if (q != null) {
            String session = q.optString("session", "");
            java.util.ArrayList<String> choices = new java.util.ArrayList<>();
            org.json.JSONArray ch = q.optJSONArray("choices");
            if (ch != null) for (int k = 0; k < ch.length(); k++) choices.add(ch.optString(k, ""));
            ask = new IslandState.Ask(session, IslandState.chatLine(chatTitle(session), q.optString("profile", "")),
                    q.optString("body", ""), choices, q.optBoolean("single", true));
        }
        String kind = IslandState.pick(pendingApproval != null, ask != null, lastWorking, !lastWorking && !unseen.isEmpty());
        java.util.List<IslandState.Progress> working = islandWorking();
        java.util.ArrayList<IslandState.Done> dones = new java.util.ArrayList<>(lastDone.values());
        java.util.Collections.reverse(dones); // the newest first
        return new IslandState(kind, ask, lastOutcome, lastExpired, islandApprovals(), working,
                working.isEmpty() ? 0 : 1 + lastMore, dones);
    }

    /** The last turn of each chat that finished with a reply (its "flash" event), the newest last, for the island
     *  panel's Done state: a map, so two chats finishing one after the other each keep their own. */
    final java.util.LinkedHashMap<String, IslandState.Done> lastDone = new java.util.LinkedHashMap<>();

    /** Every chat at work, as the island panel's Progress state shows it: the one the chip shows (its step, task list,
     *  clock, steps, a stop on its way, the app Hermux uses for it), then the other busy chats the plugin names. */
    synchronized java.util.List<IslandState.Progress> islandWorking() {
        java.util.ArrayList<IslandState.Progress> out = new java.util.ArrayList<>();
        if (!lastWorking || lastSession == null || lastSession.isEmpty()) return out;
        long nowMono = android.os.SystemClock.uptimeMillis();
        BgApp bg = bgApp;
        android.graphics.Bitmap thumb = bgThumb;
        JSONObject todo = lastTodo != null && lastTodo.optInt("total", 0) > 0 ? lastTodo : null;
        boolean app = bg != null && bg.session.equals(lastSession);
        out.add(new IslandState.Progress(lastSession, lastTurnId, IslandState.chatLine(lastTitle, lastSub), lastTitle, lastStatus,
                workingSince, lastSteps, todo == null ? "" : todo.optString("states", ""),
                todo == null ? "" : todo.optString("current", ""), todo == null ? 0 : todo.optInt("done", 0),
                todo == null ? 0 : todo.optInt("total", 0), stops.view(lastSession, lastTurnId, nowMono), app ? bg.label : "",
                app && thumb != null ? System.identityHashCode(thumb) : 0));
        if (lastOthers != null) for (int k = 0; k < lastOthers.length(); k++) {
            JSONObject o = lastOthers.optJSONObject(k);
            String ses = o == null ? "" : o.optString("session", "");
            if (ses.isEmpty() || ses.equals(lastSession)) continue;
            String oTurnId = o.optString("turn_id", "");
            double oSinceSec = o.optDouble("since", 0);
            long oSince = oSinceSec > 0 ? (long) (oSinceSec * 1000) : 0;
            boolean oapp = bg != null && bg.session.equals(ses);
            out.add(new IslandState.Progress(ses, oTurnId, IslandState.chatLine(o.optString("title", ""), lastSub), o.optString("title", ""),
                    o.optString("text", ""), oSince, 0, "", "", 0, 0, stops.view(ses, oTurnId, nowMono), oapp ? bg.label : "",
                    oapp && thumb != null ? System.identityHashCode(thumb) : 0));
        }
        return out;
    }

    /** Every permission request waiting, as the island panel shows it, the oldest first (whatever "When Hermux needs
     *  me" says, as for the whole of islandState). */
    synchronized java.util.List<IslandState.Approval> islandApprovals() {
        java.util.ArrayList<IslandState.Approval> out = new java.util.ArrayList<>();
        for (PendingAsk.Entry<JSONObject> e : pending.all(PendingAsk.APPROVAL)) {
            if (out.size() >= IslandState.MAX_APPROVALS) break;
            JSONObject a = e.payload;
            out.add(new IslandState.Approval(e.session, e.id, IslandState.chatLine(chatTitle(e.session), a.optString("profile", "")),
                    a.optString("what", ""), a.optString("command", ""), a.optString("body", ""), a.optBoolean("allow_session", true),
                    a.optBoolean("phone_data", false), a.optBoolean("phone_data_unreadable", false), e.deadline,
                    Math.max(1, a.optLong("timeout", 60)) * 1000L));
        }
        return out;
    }

    /** A chat's title from what the service knows: the working chat, the other busy chats, the finished ones. */
    synchronized String chatTitle(String session) {
        if (session == null || session.isEmpty()) return "";
        if (session.equals(lastSession) && !lastTitle.isEmpty()) return lastTitle;
        if (lastOthers != null) for (int k = 0; k < lastOthers.length(); k++) {
            JSONObject o = lastOthers.optJSONObject(k);
            if (o != null && session.equals(o.optString("session", ""))) return o.optString("title", "");
        }
        String[] u = unseen.get(session);
        return u == null || u[0] == null ? "" : u[0];
    }

    /** One collapsed stack for every Hermes notification (replies, approvals, learning, jobs). */
    void postGrouped(NotificationManager nm, String tag, Notification n) {
        nm.notify(tag, 2, n);
        Notification.Builder sum = new Notification.Builder(this, CH_LEARN)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(Color.parseColor("#D9A441"))
                .setContentTitle("Hermux")
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

    PendingIntent openApp(String session, boolean clearDone) {
        return openApp(session, clearDone, false);
    }

    /** clearDone: tapping the card also clears the sticky Done chip (all of it), even when the chat it names is gone.
     *  bgView: the chat opens with the live viewer of the app Hermes uses for it (MainActivity.EXTRA_BG_VIEW). */
    PendingIntent openApp(String session, boolean clearDone, boolean bgView) {
        Intent open = IntentGate.mark(this, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK));
        if (session != null && !session.isEmpty()) open.putExtra("session", session);
        if (clearDone) open.putExtra("clearDone", true);
        if (bgView) open.putExtra(MainActivity.EXTRA_BG_VIEW, true);
        int code = (session == null ? 0 : session.hashCode()) + (clearDone ? 31 : 0) + (bgView ? 17 : 0);
        return PendingIntent.getActivity(this, code, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    Notification statusNotification(String text, String sub, boolean working) {
        if (confirmUntil > System.currentTimeMillis()) return confirmNotification(); // a card answer went through: 2 s
        boolean flash = flashUntil > System.currentTimeMillis();
        // "When Hermux needs me" off (NotifyChoice): a waiting approval or question is not shown on the chip (no buttons
        // either); it stays in `pending`, so the app's sheet and Needs you still have it and nothing is answered or dropped.
        boolean needs = NotifyChoice.needsMe(this);
        boolean approval = needs && pendingApproval != null, ask = needs && pendingAsk != null;
        if (flash && !approval && !ask) return flashNotification();
        if (approval) return approvalNotification(sub);
        if (ask) return askNotification(sub);
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
        boolean isStopping = stops.view(lastSession, lastTurnId, android.os.SystemClock.uptimeMillis()).stopping();
        String chat = lastTitle.isEmpty() ? "Hermux" : lastTitle;

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

        BgApp bg = bgApp; // one read: the card's picture and its tap never disagree
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GOLD)
                .setContentTitle(chat)
                .setContentText(t)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                // the island panel on its Progress state; while Hermux uses an app for this chat, the live viewer as before
                .setContentIntent(bgForChip(bg) ? openApp(lastSession, false, true) : islandIntent(lastSession, IslandState.PROGRESS));
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
            Intent stop = new Intent(this, HermesService.class).setAction(ACTION_STOP)
                    .putExtra("session", lastSession)
                    .putExtra("turn_id", lastTurnId);
            b.addAction(new Notification.Action.Builder(null, colored("\u25A0 Stop", RED),
                    PendingIntent.getService(this, ("stop:" + lastSession + ":" + lastTurnId).hashCode(), stop,
                            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
        }
        promote(b, lastShort.isEmpty() ? "Hermux" : lastShort);
        // Hermes is using an app on the hidden screen for this chat: the expanded card shows a picture of it.
        // The lock screen gets the same card without the picture (it can show the user's own data).
        android.graphics.Bitmap thumb = bgThumb;
        if (thumb != null && bgForChip(bg)) {
            // build() hands back the builder's own Notification: clone it, or the card becomes its own public version.
            b.setPublicVersion(b.build().clone());
            b.setLargeIcon(android.graphics.drawable.Icon.createWithBitmap(thumb));
        }
        return b.build();
    }

    /** Schedules the single timeout callback for the earliest in-flight stop (none while no stop is sending). */
    synchronized void scheduleStopTimeout() {
        main.removeCallbacks(stopTimeoutTask);
        long delay = stops.nextTimeoutDelayMs(android.os.SystemClock.uptimeMillis());
        if (delay >= 0) main.postDelayed(stopTimeoutTask, delay);
    }

    /** Fails any stop that reached 15 s unheard, restoring Stop on both chip and panel and posting the failure card. */
    void expireStopTimeouts() {
        java.util.List<IslandState.StopTimeout> timedOut;
        synchronized (this) {
            timedOut = stops.expireTimeouts(System.currentTimeMillis(), android.os.SystemClock.uptimeMillis());
            scheduleStopTimeout();
            if (timedOut.isEmpty()) return;
            for (IslandState.StopTimeout to : timedOut)
                noteOutcome("stop", to.session, to.turnId, IslandState.Outcome.FAILED, "timed out");
            postStatus();
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (IslandState.StopTimeout to : timedOut) {
            postGrouped(nm, tag("stop", to.session), alert(CH_ALERT, "Couldn't stop Hermux",
                    "Open the chat to stop it (timed out)", to.session, true));
        }
    }

    /** The chip's and panel's Stop button: the plugin interrupts the exact turn on screen (session.interrupt).
     *  Both chip and panel derive their view from {@link #stops}: "Stopping…" until a matching 200 or the turn's end,
     *  or "Couldn't stop Hermux" (with Stop usable again) after a real failure or 15 s. */
    void stopTurn(String session, String turnId) {
        if (session == null || session.isEmpty()) return;
        final IslandState.StopTicket ticket;
        synchronized (this) {
            ticket = stops.beginStop(session, turnId, System.currentTimeMillis(), android.os.SystemClock.uptimeMillis());
            if (ticket == null) {
                postStatus(); // refresh panel in case the turn already ended or a stop is already active
                return;
            }
            scheduleStopTimeout();
            postStatus();
        }
        new Thread(() -> {
            String err = null;
            String respTurnId = "";
            try {
                JSONObject req = new JSONObject().put("session", ticket.session);
                if (!ticket.turnId.isEmpty()) req.put("turn_id", ticket.turnId);
                String path = "/api/plugins/hermes-mobile/stop";
                String[] res = MainActivity.rawHttp(this, "POST", path, dashboardToken(false), req.toString(), true);
                if ("401".equals(res[0]) || "403".equals(res[0]))
                    res = MainActivity.rawHttp(this, "POST", path, dashboardToken(true), req.toString(), true);
                if ("404".equals(res[0])) err = "it isn't running in Hermux";
                else if (!res[0].startsWith("2")) err = "HTTP " + res[0];
                else if (res[1] != null && !res[1].isEmpty()) {
                    try {
                        respTurnId = new JSONObject(res[1]).optString("turn_id", "");
                    } catch (Exception ignored) {
                    }
                }
            } catch (Exception ex) {
                err = ex.getMessage();
            }
            final String failed = err;
            final String gotTurnId = respTurnId;
            if (failed == null) {
                main.post(() -> {
                    synchronized (HermesService.this) {
                        if (!stops.onStop200(ticket.session, ticket.turnId, gotTurnId, ticket.attempt,
                                android.os.SystemClock.uptimeMillis())) return;
                        scheduleStopTimeout();
                        noteOutcome("stop", ticket.session, ticket.turnId, IslandState.Outcome.STOPPED, null);
                        postStatus();
                    }
                });
                return;
            }
            // One post: the failure and the end of "Stopping…" together, so no status in between sees one without the other.
            main.post(() -> {
                synchronized (HermesService.this) {
                    if (!stops.onStopFailed(ticket.session, ticket.turnId, ticket.attempt, failed,
                            System.currentTimeMillis(), android.os.SystemClock.uptimeMillis())) return;
                    scheduleStopTimeout();
                    noteOutcome("stop", ticket.session, ticket.turnId, IslandState.Outcome.FAILED, failed);
                    postStatus();
                }
                NotificationManager nm = getSystemService(NotificationManager.class);
                postGrouped(nm, tag("stop", ticket.session), alert(CH_ALERT, "Couldn't stop Hermux",
                        "Open the chat to stop it (" + failed + ")", ticket.session, true));
            });
        }, "hermes-stop").start();
    }

    /** "2m 14s", "45s", "1h 3m". */
    static String took(long secs) {
        return IslandState.took(secs);
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

    /** A question from Hermes, as a Live Update: "Answer?" chip; expanded, the question in bold, the choices listed,
     * up to two choice buttons and Answer. HyperOS drops a RemoteInput field from a promoted card (the same action
     * draws on the Needs you card), so tapping the card or Answer opens the island panel, which has the field. */
    Notification askNotification(String sub) {
        JSONObject a = pendingAsk;
        String session = a.optString("session", "");
        String q = a.optString("body", "").trim();
        if (q.isEmpty()) q = "Hermux has a question";
        java.util.ArrayList<String> choices = new java.util.ArrayList<>();
        org.json.JSONArray ch = a.optJSONArray("choices");
        if (ch != null) for (int k = 0; k < ch.length() && choices.size() < 5; k++) {
            String c = ch.optString(k, "").trim();
            if (!c.isEmpty()) choices.add(c); // whole: a tap answers with this text; only the card's list is cut
        }
        boolean single = a.optBoolean("single", true);
        android.text.SpannableStringBuilder t = new android.text.SpannableStringBuilder(q);
        t.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, t.length(), 0);
        if (single) for (String c : choices) {
            int st = t.length();
            t.append("\n\u25CB ").append(c.length() > 40 ? c.substring(0, 40) : c);
            t.setSpan(new android.text.style.ForegroundColorSpan(GOLD), st + 1, st + 2, 0);
        }
        if (single) t.append("\nTap to answer");
        PendingIntent box = islandIntent(session, IslandState.QUESTION);
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(GOLD)
                .setContentTitle("Hermux asks")
                .setContentText(t)
                .setSubText(sub)
                .setStyle(new Notification.BigTextStyle().bigText(t))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(single ? box : openApp(session));
        if (single) {
            // A notification shows three actions at most: keep the last one for Answer.
            for (int k = 0; k < Math.min(2, choices.size()); k++) b.addAction(choiceAction(session, choices.get(k), k));
            b.addAction(new Notification.Action.Builder(null, colored("Answer", GOLD), box).build());
        }
        promote(b, "Answer?");
        return b.build();
    }

    /** Opens the island panel on this chat's state. An activity that is not shown over the lock screen, so a locked
     *  phone asks for the unlock before it shows. The intent says only which chat and state were tapped: the panel
     *  shows the live state (islandState). */
    PendingIntent islandIntent(String session, String kind) {
        Intent i = new Intent(this, IslandPanel.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(IslandPanel.EXTRA_SESSION, session == null ? "" : session)
                .putExtra(IslandPanel.EXTRA_KIND, kind);
        return PendingIntent.getActivity(this, ("island:" + kind + ":" + session).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
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
    /** Every approval and question waiting, per chat and request; pendingApproval / pendingAsk / approvalDeadline are
     *  the ones the chip shows now (the oldest of each), set by syncPending after every change to this list. */
    final PendingAsk<JSONObject> pending = new PendingAsk<>();

    synchronized void syncPending() {
        PendingAsk.Entry<JSONObject> a = pending.shown(PendingAsk.APPROVAL);
        if (a == null || a.payload != pendingApproval) lastReAlert = -1; // another request is shown: its re-alerts start over
        pendingApproval = a == null ? null : a.payload;
        if (a != null) approvalDeadline = a.deadline;
        PendingAsk.Entry<JSONObject> q = pending.shown(PendingAsk.ASK);
        pendingAsk = q == null ? null : q.payload;
    }

    /** The last question that ran out of time, for the island panel (it buzzes "reject" for that, not for a question
     *  answered elsewhere). */
    IslandState.Expired lastExpired;

    /** pending.expire, noting the last question it dropped. */
    synchronized boolean expirePending(long now, long graceMs) {
        java.util.List<PendingAsk.Entry<JSONObject>> gone = pending.expired(now, graceMs);
        for (PendingAsk.Entry<JSONObject> e : gone)
            if (PendingAsk.ASK.equals(e.kind)) lastExpired = new IslandState.Expired(e.session, e.payload.optString("body", ""), now);
        return !gone.isEmpty();
    }

    final Runnable expireAskTask = () -> {
        synchronized (HermesService.this) {
            if (expirePending(System.currentTimeMillis(), 0)) {
                syncPending();
                postStatus();
                updateWake();
            }
        }
    };

    /** Waiting approval, as a Live Update: shield chip with a live countdown; expanded, the command
     * in monospace over a draining countdown bar (gold → amber → red) and coloured answer buttons. */
    /** The approval chip's line while its answer is being sent. */
    static final String SENDING_ANSWER = "Sending your answer\u2026";

    Notification approvalNotification(String sub) {
        JSONObject a = pendingApproval;
        boolean sending = answering != null && answering.equals(a.optString("session", ""));
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
                .setContentTitle(a.optBoolean("phone_data", false) ? "Hermux wants to read your phone" : "Hermux wants to run a command")
                .setContentText(t)
                .setSubText((sub != null ? sub + " · " : "") + (sending ? SENDING_ANSWER : "expires in " + secs + "s"))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(islandApprovalIntent(a, null)); // the island panel, on the live request
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
        if (!sending) { // while the answer is on its way, no second one
            if (!a.optBoolean("phone_data_unreadable", false))
                b.addAction(unlockFirst(new Notification.Action.Builder(null, colored("Allow once", GREEN), approveIntent(a, "once"))).build());
            if (a.optBoolean("allow_session", true))
                b.addAction(unlockFirst(new Notification.Action.Builder(null, colored("Allow session", GOLD), approveIntent(a, "session"))).build());
            b.addAction(new Notification.Action.Builder(null, colored("Deny", RED), approveIntent(a, "deny")).build());
        }
        hideOnLockScreen(b, a.optBoolean("phone_data", false));
        promote(b, secs + "s");
        return b.build();
    }

    /** A phone-data approval (kind, search text, wording) never shows on the lock screen: private, with a public version
     *  that only says Hermux needs an answer. For a phone that locks after the notification was posted. Other
     *  notifications are unchanged. */
    void hideOnLockScreen(Notification.Builder b, boolean phoneData) {
        if (!phoneData) return;
        b.setVisibility(Notification.VISIBILITY_PRIVATE);
        b.setPublicVersion(new Notification.Builder(this, CH_ALERT)
                .setSmallIcon(R.drawable.ic_stat_shield)
                .setContentTitle("Hermux needs your approval")
                .build());
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
        Notification.Builder b = alertBuilder(CH_ALERT, e.optString("title", "Hermux"), "Still waiting for your answer: " + clip(e.optString("body", ""), 600), session, true);
        hideOnLockScreen(b, e.optBoolean("phone_data", false));
        if (!e.optBoolean("phone_data_unreadable", false)) b.addAction(approveAction(e, "once", "Allow once"));
        if (e.optBoolean("allow_session", true)) b.addAction(approveAction(e, "session", "Allow session"));
        b.addAction(approveAction(e, "deny", "Deny"));
        nm.cancel(tag("approval", session), 2); // a fresh post is what re-triggers the heads-up
        postGrouped(nm, tag("approval", session), b.build());
    }

    /** The approval event as the notification shows it. For a phone-data read (the description starts "phone_data:") the
     *  app writes the wording itself from the decoded args, so the raw hex never reaches a notification, and offers only
     *  Allow once and Deny. Any other approval comes back unchanged. {@code phone_data} marks such an event;
     *  {@code phone_data_unreadable} means the text didn't parse, so there is no Allow at all. */
    static JSONObject phoneDataEvent(JSONObject e) {
        // Only the plugin's own request counts: the description names the read AND Hermes's label for the tool is the
        // command. A shell command that mentions phone_data: anywhere else is an ordinary approval, shown as it is.
        String raw = PhoneDataWording.rawOf(e.optString("what", ""), e.optString("command", ""));
        if (raw == null) return e;
        try {
            JSONObject c = new JSONObject(e.toString());
            String text = PhoneDataWording.notificationText(raw);
            c.put("what", text).put("body", text).put("command", "").put("allow_session", false).put("allow_permanent", false)
                    .put("phone_data", true).put("phone_data_unreadable", PhoneDataWording.wording(raw) == null);
            return c;
        } catch (Exception ex) {
            JSONObject safe = new JSONObject();
            try {
                String text = PhoneDataWording.WARNING;
                safe.put("session", e.optString("session", "")).put("key", e.optString("key", "")).put("request_id", e.optString("request_id", ""))
                        .put("profile", e.optString("profile", "")).put("timeout", e.optLong("timeout", 60)).put("what", text).put("body", text)
                        .put("allow_session", false).put("phone_data", true).put("phone_data_unreadable", true);
            } catch (Exception ignored) {
                // a JSONObject accepts these keys; nothing to do
            }
            return safe;
        }
    }

    /** Ticks the approval countdown once a second until answered or expired. */
    void tickApproval() {
        synchronized (this) {
            if (pendingApproval == null) return;
            // HyperOS drops the heads-up after ~5 s: pop it up again at 20 s and 40 s while unanswered.
            long elapsed = Math.max(1, pendingApproval.optLong("timeout", 60)) * 1000L - (approvalDeadline - System.currentTimeMillis());
            long sec = elapsed / 1000;
            boolean needs = NotifyChoice.needsMe(this);
            if ((sec == 20 || sec == 40) && sec != lastReAlert && !MainActivity.visible && needs) {
                lastReAlert = sec;
                reAlertApproval();
            }
            if (System.currentTimeMillis() > approvalDeadline + 3000) {
                pending.expire(System.currentTimeMillis(), 3000); // expired; the plugin's clear normally beats this
                syncPending();
                postStatus();
                updateWake();
                if (pendingApproval != null) main.postDelayed(this::tickApproval, 1000); // another request still waits
                return;
            }
            if (needs) postStatus(); // the countdown on the chip; with "needs me" off the chip doesn't show it
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
        String title = n == 1 ? (latest[0].isEmpty() ? "Hermux" : latest[0]) : n + " chats finished";
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
        promote(b, n == 1 ? "Done" : n + " done");
        return b.build();
    }

    /** A card button's answer went through: the chip says so for two seconds ("Allowed", "Denied", "Sent"), so a card
     *  answer is confirmed as a panel answer is (design 6): a drawn check (green) or cross (red) icon beside the word. */
    String confirmText = "";
    boolean confirmGood;
    long confirmUntil = 0;
    static final long CONFIRM_MS = 2000;
    static final String CONFIRM_ALLOWED = "Allowed", CONFIRM_DENIED = "Denied", CONFIRM_SENT = "Sent";

    void confirmChip(String text, boolean good) {
        synchronized (this) {
            confirmText = text;
            confirmGood = good;
            confirmUntil = System.currentTimeMillis() + CONFIRM_MS;
            postStatus();
        }
        main.postDelayed(this::expireConfirm, CONFIRM_MS + 100);
    }

    synchronized void expireConfirm() {
        if (confirmUntil != 0 && System.currentTimeMillis() >= confirmUntil) {
            confirmUntil = 0;
            postStatus();
        }
    }

    Notification confirmNotification() {
        Notification.Builder b = new Notification.Builder(this, CH_STATUS)
                .setSmallIcon(confirmGood ? R.drawable.ic_stat_check : R.drawable.ic_stat_cross)
                .setColor(confirmGood ? GREEN : RED)
                .setContentTitle(confirmText)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(lastSession));
        promote(b, confirmText);
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
        Intent open = IntentGate.mark(this, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP))
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

    /** Opens the app on that chat, whose approval sheet asks for the fingerprint or screen lock on Allow. */
    void openToConfirm(String session) {
        Intent open = IntentGate.mark(this, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        if (session != null && !session.isEmpty()) open.putExtra("session", session);
        try {
            startActivity(open);
        } catch (Exception e) {
            // background start refused: nothing is allowed; the approval still waits in the app
            android.widget.Toast.makeText(this, "Open Hermux to allow this", android.widget.Toast.LENGTH_LONG).show();
        }
    }

    /** On the lock screen, Android asks to unlock before this answer goes through (API 31+): whoever holds a locked
     *  phone can't allow a command or tell Hermes what to do. Deny stays one tap. */
    static Notification.Action.Builder unlockFirst(Notification.Action.Builder b) {
        if (Build.VERSION.SDK_INT >= 31) b.setAuthenticationRequired(true);
        return b;
    }

    PendingIntent approveIntent(JSONObject e, String choice) {
        String session = e.optString("session", "");
        // A phone-data read is never allowed from a notification: this event arrived on /event, which the agent can
        // also post to, so only the page (whose request came from Hermes itself) may mint the one-use grant. Allow
        // opens the app on that chat, where the sheet asks.
        boolean phoneData = e.optBoolean("phone_data", false);
        if (phoneData && !"deny".equals(choice)) {
            Intent open = IntentGate.mark(this, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            if (!session.isEmpty()) open.putExtra("session", session);
            return PendingIntent.getActivity(this, approvalCode("phonedata", session, e.optString("request_id", ""), choice), open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        if (Build.VERSION.SDK_INT >= 31 && !"deny".equals(choice) && ApprovalLock.needed(this)) {
            // Android 12+ refuses to open an activity from a service a notification started (trampoline): Allow opens
            // the island panel directly, which asks for the fingerprint at once and then sends that answer itself.
            return islandApprovalIntent(e, choice);
        }
        Intent i = new Intent(this, HermesService.class).setAction(ACTION_APPROVE)
                .putExtra("session", session)
                .putExtra("key", e.optString("key", ""))
                .putExtra("request_id", e.optString("request_id", ""))
                .putExtra("profile", e.optString("profile", ""))
                .putExtra("choice", choice)
                .putExtra("phone_data", phoneData);
        return PendingIntent.getService(this, approvalCode("approve", session, e.optString("request_id", ""), choice), i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A notification PendingIntent's request code for one choice on one request of one chat: two requests waiting in
     *  one chat (the chip on one, a card on the other) never share a PendingIntent, which FLAG_UPDATE_CURRENT would
     *  rewrite to the newer request's extras. */
    static int approvalCode(String what, String session, String request, String choice) {
        return (what + "\n" + session + "\n" + request + "\n" + (choice == null ? "" : choice)).hashCode();
    }

    /** A notification button's answer: POST it to the plugin's /approve (approval.respond). */
    void answerApproval(Intent i) {
        String session = i.getStringExtra("session");
        String choice = i.getStringExtra("choice");
        // Only Deny is ever sent for a phone-data read from here (approveIntent opens the app for Allow); anything
        // else, even a forged intent, opens the app instead.
        if (i.getBooleanExtra("phone_data", false) && !"deny".equals(choice)) {
            openToConfirm(session);
            return;
        }
        if (!"deny".equals(choice) && openToUnlock(session, null, "approval " + choice)) return;
        // Confirm approvals with fingerprint: the notification can't tell the live session a confirmation is filed under,
        // so it sends nothing: the island panel opens, asks for the fingerprint and sends that answer (Android 8-11; on
        // 12+ approveIntent opens the panel itself).
        if (!"deny".equals(choice) && ApprovalLock.needed(this)) {
            openPanelToConfirm(i);
            return;
        }
        sendApproval(session, i.getStringExtra("key"), i.getStringExtra("request_id"), i.getStringExtra("profile"), choice, true);
    }

    /** Opens the island panel on this request with the choice the card's Allow made, where it asks for the
     *  fingerprint. If Android refuses to open it from the background, the app's own path (openToConfirm). */
    void openPanelToConfirm(Intent i) {
        String session = i.getStringExtra("session");
        Intent panel = new Intent(this, IslandPanel.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(IslandPanel.EXTRA_SESSION, session == null ? "" : session)
                .putExtra(IslandPanel.EXTRA_KIND, IslandState.PERMISSION)
                .putExtra(IslandPanel.EXTRA_REQUEST, i.getStringExtra("request_id") == null ? "" : i.getStringExtra("request_id"))
                .putExtra(IslandPanel.EXTRA_CHOICE, i.getStringExtra("choice"));
        // Before Android 12 a card button that reaches this service leaves the shade open, so the panel and its PIN
        // screen would open behind it; apps may still close it there (the broadcast is refused from Android 12).
        if (Build.VERSION.SDK_INT < 31) sendBroadcast(new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS));
        try {
            startActivity(panel);
        } catch (Exception e) {
            openToConfirm(session);
        }
    }

    /** Opens the island panel on a permission request: the card's body ({@code choice} null), or the card's Allow
     *  once / Allow session while the fingerprint is needed ({@code choice} "once" or "session": the panel asks for it
     *  at once). The panel shows the live request, never this intent's: the intent names only the chat, the request id
     *  and the choice. Not shown over the lock screen, so a locked phone asks for the unlock first. */
    PendingIntent islandApprovalIntent(JSONObject e, String choice) {
        String session = e.optString("session", ""), request = e.optString("request_id", "");
        Intent i = new Intent(this, IslandPanel.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(IslandPanel.EXTRA_SESSION, session)
                .putExtra(IslandPanel.EXTRA_KIND, IslandState.PERMISSION)
                .putExtra(IslandPanel.EXTRA_REQUEST, request);
        if (choice != null) i.putExtra(IslandPanel.EXTRA_CHOICE, choice);
        return PendingIntent.getActivity(this, approvalCode("island:approval", session, request, choice), i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * The island panel's answer to the request it shows (IslandPanel, in this process; nothing outside it can call
     * this). The request is looked up again in what waits now, by chat and request id, and answered with the service's
     * own copy of it (key, profile), never the panel's. Deny is sent at once. Allow is refused for a phone-data read
     * (only the app's sheet may allow one), for a request whose text could not be read, for "session" where the request
     * doesn't offer it, on a locked phone, and, while ApprovalLock.needed, without the one-use grant the panel's
     * fingerprint prompt filed for this very request and choice (ApprovalLock.askOnce). Returns null when it was handed
     * on (the outcome follows through noteOutcome), otherwise why nothing was sent.
     */
    String approveFromPanel(String session, String request, String choice, String grant) {
        String why = panelRefusal(session, request, choice, grant);
        if (why != null) android.util.Log.i("HermesApprove", "island panel answer not sent: " + why); // no request text
        return why;
    }

    /** approveFromPanel's work: null once the answer is handed on, otherwise why it was not. */
    private String panelRefusal(String session, String request, String choice, String grant) {
        boolean deny = "deny".equals(choice);
        if (!deny && !"once".equals(choice) && !"session".equals(choice)) return "unknown choice";
        JSONObject live;
        long deadline;
        synchronized (this) {
            PendingAsk.Entry<JSONObject> e = pending.find(PendingAsk.APPROVAL, session, request);
            live = e == null ? null : e.payload;
            deadline = e == null ? 0 : e.deadline;
        }
        if (live == null) return "gone";
        if (!deny) {
            if (deadline <= System.currentTimeMillis()) return "expired"; // Hermes has stopped waiting: no late Allow
            if (live.optBoolean("phone_data", false) || live.optBoolean("phone_data_unreadable", false)) return "phone data";
            if ("session".equals(choice) && !live.optBoolean("allow_session", true)) return "no session choice";
            if (MainActivity.keyguardLocked(this)) return "locked";
            if (ApprovalLock.needed(this) && !ApprovalLock.takeGrant(grant, ApprovalLock.grantFor(session, request, choice), System.currentTimeMillis()))
                return "not confirmed";
        }
        sendApproval(session, live.optString("key", ""), request, live.optString("profile", ""), choice, false);
        return null;
    }

    /** POSTs one answer to the plugin's /approve (approval.respond) and records how it went. Every gate is the
     *  caller's: answerApproval (a notification button) and approveFromPanel (the island panel). {@code card}: from a
     *  notification button, so the chip confirms it for two seconds once it went through (the panel shows its own). */
    void sendApproval(String session, String key, String requestId, String profile, String choice, boolean card) {
        String t = tag("approval", session);
        NotificationManager nm = getSystemService(NotificationManager.class);
        synchronized (this) {
            answering = session; // the chip says "Sending your answer…" until it is sent or fails
            postStatus();
        }
        new Thread(() -> {
            String err = null;
            try {
                JSONObject body = new JSONObject()
                        .put("session", session)
                        .put("key", key)
                        .put("choice", choice)
                        .put("request_id", requestId)
                        .put("profile", profile);
                String path = "/api/plugins/hermes-mobile/approve";
                String[] res = MainActivity.rawHttp(this, "POST", path, dashboardToken(false), body.toString(), true);
                if ("401".equals(res[0]) || "403".equals(res[0]))
                    res = MainActivity.rawHttp(this, "POST", path, dashboardToken(true), body.toString(), true);
                if (!res[0].startsWith("2")) err = "HTTP " + res[0];
            } catch (Exception ex) {
                err = ex.getMessage();
            }
            final String failed = err;
            main.post(() -> {
                noteOutcome(PendingAsk.APPROVAL, session, requestId, failed != null ? IslandState.Outcome.FAILED
                        : "deny".equals(choice) ? IslandState.Outcome.DENIED : IslandState.Outcome.ALLOWED, failed);
                synchronized (HermesService.this) {
                    if (session.equals(answering)) answering = null;
                    if (failed == null) {
                        pending.answered(PendingAsk.APPROVAL, session, requestId);
                        syncPending();
                        updateWake(); // the wake lock was held for this approval's deadline
                    }
                    postStatus();
                }
                if (failed == null) {
                    nm.cancel(t, 2);
                    dropEmptySummary(nm, t);
                    if (card) confirmChip("deny".equals(choice) ? CONFIRM_DENIED : CONFIRM_ALLOWED, !"deny".equals(choice));
                } else {
                    postGrouped(nm, t, alert(CH_ALERT, "Couldn't send your answer",
                            "Open Hermux to answer (" + failed + ")", session, true));
                }
            });
        }, "hermes-approve").start();
    }

    /** A text field on the notification (RemoteInput). Its PendingIntent must be mutable to receive the text;
     *  it is explicit (this service), so nothing else can fill it in. */
    Notification.Action answerAction(String kind, String session, String label, java.util.List<CharSequence> choices) {
        android.app.RemoteInput.Builder ri = new android.app.RemoteInput.Builder(REMOTE_TEXT).setLabel("ask".equals(kind) ? "Your answer" : "Message Hermux");
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
        boolean fromPanel = i.getBooleanExtra("panel", false); // the island panel shows its own check
        String t = tag("ask".equals(kind) ? "ask" : "reply", session);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (!text.isEmpty() && openToUnlock(session, text, "answer " + kind)) return;
        if ("ask".equals(kind) && !text.isEmpty() && pending.answered(PendingAsk.ASK, session, "")) {
            syncPending(); // answered (or it failed and says so): the chip goes back to the status
            postStatus();
        }
        if (text.isEmpty()) {
            nm.cancel(t, 2);
            dropEmptySummary(nm, t);
            return;
        }
        MainActivity a = MainActivity.current;
        java.util.function.Consumer<Boolean> done = ok -> {
            noteOutcome(kind, session, "", ok ? IslandState.Outcome.SENT : IslandState.Outcome.FAILED, ok ? "" : (a == null ? "app not running" : "not delivered"));
            if (ok) {
                nm.cancel(t, 2);
                dropEmptySummary(nm, t);
                if ("ask".equals(kind) && !fromPanel) confirmChip(CONFIRM_SENT, true); // a card's answer: the chip says Sent
                return;
            }
            Intent open = IntentGate.mark(this, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK))
                    .putExtra("draft", text.length() > 20000 ? text.substring(0, 20000) : text);
            if (session != null && !session.isEmpty()) open.putExtra("session", session);
            PendingIntent pi = PendingIntent.getActivity(this, ("draft:" + session).hashCode(), open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = alertBuilder(CH_ALERT, "Couldn't send your answer",
                    "ask".equals(kind) ? "The question is no longer open here. Tap to open the chat; your text is in the box."
                            : "Hermux isn't connected. Tap to open the chat; your text is in the box.", session, false)
                    .setContentIntent(pi);
            postGrouped(nm, t, b.build());
        };
        if (a == null) {
            done.accept(false);
            return;
        }
        main.post(() -> a.deliverAnswer(kind, session, text, done));
    }

    /** The approval waiting for an answer: its buttons ride on the island chip. */
    JSONObject pendingApproval;

    /** The dashboard's session token from a verified hello (MainActivity.dashboardToken), kept until refreshed or
     *  dropped (LocalDashboard.Tokens). Every REST call with it says hello on its own connection first. */
    final LocalDashboard.Tokens dashTokens = new LocalDashboard.Tokens();

    String dashboardToken(boolean refresh) {
        return dashTokens.get(refresh, () -> MainActivity.dashboardToken(this));
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
        status.setDescription("Pinned: what Hermux is doing right now");
        status.setShowBadge(false);
        NotificationChannel idle = new NotificationChannel(CH_IDLE, "Idle", NotificationManager.IMPORTANCE_LOW);
        idle.setDescription("The small card shown while Hermux is idle. Set it to Minimised to hide its status-bar icon.");
        idle.setShowBadge(false);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Needs you", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Approvals and questions from Hermux");
        NotificationChannel reply = new NotificationChannel(CH_REPLY, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        reply.setDescription("A reply finished while the app was closed");
        NotificationChannel learn = new NotificationChannel(CH_LEARN, "Learning", NotificationManager.IMPORTANCE_LOW);
        learn.setDescription("Skill and memory updates from Hermux's self-improvement");
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
        upd.setDescription("A newer Hermux version is available");
        upd.setShowBadge(false);
        NotificationChannel pair = new NotificationChannel(AdbPairing.CH_PAIR, "Pairing", NotificationManager.IMPORTANCE_HIGH);
        pair.setDescription("The Wireless debugging pairing code, while you set up Hermux");
        pair.setShowBadge(false);
        NotificationChannel devtools = new NotificationChannel(DevTools.CH_DEVTOOLS, "Remote debugging", NotificationManager.IMPORTANCE_LOW);
        devtools.setDescription("Shown while remote debugging is on, with a button to turn it off");
        devtools.setShowBadge(false);
        for (NotificationChannel c : new NotificationChannel[]{status, idle, alert, reply, learn, jobs, playback, phone, upd, pair, devtools}) nm.createNotificationChannel(c);
        nm.deleteNotificationChannel("hermes"); // v0.1 channel, replaced by the ones above
        nm.deleteNotificationChannel("learning"); // replaced by learning2/jobs2, which don't badge the icon
        nm.deleteNotificationChannel("jobs");
    }
}
