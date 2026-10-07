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
    static final String CH_STATUS = "status", CH_IDLE = "idle", CH_ALERT = "needs_you", CH_REPLY = "replies",
            CH_LEARN = "learning", CH_JOBS = "jobs";

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

    /** No status beat for a while: Hermes (or its plugin) died mid-turn, so drop the stuck chip. */
    final Runnable expireWorkingTask = this::expireWorking;

    void expireWorking() {
        if (!lastWorking || System.currentTimeMillis() - lastBeat < WORKING_TTL_MS - 1000) return;
        workingSince = 0;
        lastWorking = false;
        lastShort = "";
        lastStatus = "Ready";
        postStatus();
        updateWake();
    }
    boolean lastWorking = false;
    String lastSub = null;
    // A short-lived "flash" in the status chip (done ✅, memory/skill updates); reverts after FLASH_MS.
    String flashChip = null, flashTitle = null, flashBody = null;
    int flashColor = 0;
    long flashUntil = 0;
    static final long FLASH_MS = 6000;
    static final String GROUP = "hermes";
    static final String ACTION_APPROVE = "com.omarqaterge.hermesmobile.APPROVE";
    static final String ACTION_ANSWER = "com.omarqaterge.hermesmobile.ANSWER";
    static final String ACTION_WAKE = "com.omarqaterge.hermesmobile.WAKE";
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
        key = ensureKey();
        startForeground(STATUS_ID, statusNotification("Ready", null, false), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        running = true;
        instance = this;
        new Thread(this::serve, "hermes-events").start();
        rearmWake();
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
        if (intent != null && ACTION_WAKE.equals(intent.getAction())) {
            wakeForCron();
            return START_STICKY;
        }
        if (!keyShared) shareKeyWithTermux(); // once per service run: each share spawns a Termux shell
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
            if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
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

    void shareKeyWithTermux() {
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
        int len = 0;
        String gotKey = "";
        int headers = 0;
        while ((line = in.readLine()) != null && !line.isEmpty()) {
            if (++headers > 40 || line.length() > 2048) throw new java.io.IOException("bad request");
            String l = line.toLowerCase();
            if (l.startsWith("content-length:")) len = Integer.parseInt(line.substring(15).trim());
            if (l.startsWith("x-hermes-mobile-key:")) gotKey = line.substring(20).trim();
        }
        if (len < 0 || len > 256 * 1024) throw new java.io.IOException("too large");
        char[] buf = new char[len];
        int read = 0;
        while (read < buf.length) {
            int r = in.read(buf, read, buf.length - read);
            if (r < 0) break;
            read += r;
        }
        boolean ok = java.security.MessageDigest.isEqual(
                key.getBytes(StandardCharsets.UTF_8), gotKey.getBytes(StandardCharsets.UTF_8)); // constant time
        OutputStream out = s.getOutputStream();
        out.write((ok ? "HTTP/1.1 204 No Content\r\n" : "HTTP/1.1 403 Forbidden\r\n")
                .concat("Content-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        if (ok) onEvent(new JSONObject(new String(buf, 0, read)));
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
            final String ttsCfg = String.valueOf(cfg.optJSONObject("tts") == null ? "{}" : cfg.optJSONObject("tts"));
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
                lastWorking = working;
                if (working) flashUntil = 0; // real work beats a flash
                lastBeat = System.currentTimeMillis();
                main.removeCallbacks(expireWorkingTask);
                if (working) main.postDelayed(expireWorkingTask, WORKING_TTL_MS);
                postStatus();
                updateWake();
                return;
            }
            case "wake_at":
                scheduleWake(e.optDouble("at", 0));
                return;
            case "cron_idle":
                cronIdle(e.optDouble("since", 0));
                return;
            case "flash": {
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
                if (MainActivity.visible) return; // the app shows its own sheet
                Notification.Builder b = alertBuilder(CH_ALERT, title, body, session, true);
                // Answer right from the popup, like the in-app sheet.
                b.addAction(approveAction(e, "once", "Allow once"));
                if (e.optBoolean("allow_session", true)) b.addAction(approveAction(e, "session", "Allow session"));
                b.addAction(approveAction(e, "deny", "Deny"));
                // HyperOS hides the popup after ~5 s whatever we ask; the island chip keeps the
                // same buttons (status notification) until the approval is answered.
                boolean ticking = pendingApproval != null;
                if (!ticking) lastReAlert = -1;
                pendingApproval = e;
                approvalDeadline = System.currentTimeMillis() + Math.max(1, e.optLong("timeout", 60)) * 1000L;
                postStatus();
                updateWake();
                if (!ticking) main.postDelayed(this::tickApproval, 1000);
                postGrouped(nm, tag(kind, session), b.build());
                return;
            }
            case "ask": {
                if (MainActivity.visible) return; // the app shows its own sheet
                Notification.Builder b = alertBuilder(CH_ALERT, title, body, session, true);
                // Answer in the notification; a question with choices offers them as quick replies.
                org.json.JSONArray ch = e.optJSONArray("choices");
                java.util.ArrayList<CharSequence> choices = new java.util.ArrayList<>();
                if (ch != null) for (int k = 0; k < ch.length() && choices.size() < 5; k++) {
                    String c = ch.optString(k, "").trim();
                    if (!c.isEmpty()) choices.add(c.length() > 40 ? c.substring(0, 40) : c);
                }
                if (e.optBoolean("single", true)) b.addAction(answerAction("ask", session, "Answer", choices));
                // HyperOS hides the popup after ~5 s: the question and its answers also ride on the island chip.
                pendingAsk = e;
                main.removeCallbacks(expireAskTask);
                main.postDelayed(expireAskTask, ASK_TTL_MS);
                postStatus();
                postGrouped(nm, tag(kind, session), b.build());
                return;
            }
            case "reply":
            case "error":
                if (MainActivity.visible) return;
                Notification.Builder rb = alertBuilder(CH_REPLY, title, body, session, false);
                if (session != null && !session.isEmpty()) rb.addAction(answerAction("reply", session, "Reply", null));
                postGrouped(nm, tag("reply", session), rb.build());
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
        nm.notify(SUMMARY_ID, sum.build());
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
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (session != null && !session.isEmpty()) open.putExtra("session", session);
        int code = session == null ? 0 : session.hashCode();
        return PendingIntent.getActivity(this, code, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    Notification statusNotification(String text, String sub, boolean working) {
        boolean flash = flashUntil > System.currentTimeMillis();
        if (flash && pendingApproval == null && pendingAsk == null) return flashNotification();
        if (pendingApproval != null) return approvalNotification(sub);
        if (pendingAsk != null) return askNotification(sub);
        // Idle = a slim green card on its own channel (so it can be minimised on its own); working = the gold Live Update.
        Notification.Builder b = new Notification.Builder(this, working ? CH_STATUS : CH_IDLE)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setColor(working ? GOLD : GREEN)
                .setContentTitle("Status: " + text.replace("`", ""))
                .setContentText(working ? text : null)
                .setStyle(working ? new Notification.BigTextStyle().bigText(text) : null)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(working)
                .setContentIntent(openApp(lastSession));
        if (working && workingSince > 0) b.setWhen(workingSince).setUsesChronometer(true);
        if (sub != null) b.setSubText(sub);
        if (working) {
            // Android 16 Live Update: a promoted ongoing notification gets a status-bar chip
            // (HyperOS shows it in the Hyper Island around the camera). Only while working, so
            // the chip disappears when Hermes is idle. Expanded: a live gold progress sweep.
            if (Build.VERSION.SDK_INT >= 36) {
                b.setStyle(new Notification.ProgressStyle()
                        .setProgressIndeterminate(true)
                        .setStyledByProgress(false)
                        .setProgressSegments(java.util.List.of(new Notification.ProgressStyle.Segment(100).setColor(GOLD))));
                b.setContentText(codeSpans(text));
            }
            promote(b, lastShort.isEmpty() ? "Hermes" : lastShort);
        }
        return b.build();
    }

    static final int GOLD = Color.parseColor("#D9A441"), GREEN = Color.parseColor("#3DBE7A"),
            RED = Color.parseColor("#E5564B"), AMBER = Color.parseColor("#E8912D");

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
        return new Notification.Action.Builder(null, colored(choice.length() > 18 ? choice.substring(0, 17) + "\u2026" : choice, GOLD), pi).build();
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

        String what = a.optString("what", "");
        String cmd = a.optString("command", "");
        if (what.isEmpty() && cmd.isEmpty()) what = a.optString("body", "a command");
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
        b.addAction(new Notification.Action.Builder(null, colored("✓ Allow once", GREEN), approveIntent(a, "once")).build());
        if (a.optBoolean("allow_session", true))
            b.addAction(new Notification.Action.Builder(null, colored("Allow session", GOLD), approveIntent(a, "session")).build());
        b.addAction(new Notification.Action.Builder(null, colored("✕ Deny", RED), approveIntent(a, "deny")).build());
        promote(b, secs + "s");
        return b.build();
    }

    long approvalDeadline;
    long lastReAlert = -1;

    void reAlertApproval() {
        JSONObject e = pendingApproval;
        if (e == null) return;
        String session = e.optString("session", null);
        NotificationManager nm = getSystemService(NotificationManager.class);
        Notification.Builder b = alertBuilder(CH_ALERT, e.optString("title", "Hermes"), "Still waiting for your answer: " + e.optString("body", ""), session, true);
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
        return new Notification.Action.Builder(null, label, approveIntent(e, choice)).build();
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
        return new Notification.Action.Builder(null, label, pi).addRemoteInput(ri.build()).setAllowGeneratedReplies(false).build();
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
        NotificationChannel jobs = new NotificationChannel(CH_JOBS, "Scheduled jobs", NotificationManager.IMPORTANCE_DEFAULT);
        jobs.setDescription("Cron job results");
        for (NotificationChannel c : new NotificationChannel[]{status, idle, alert, reply, learn, jobs}) nm.createNotificationChannel(c);
        nm.deleteNotificationChannel("hermes"); // v0.1 channel, replaced by the ones above
    }
}
