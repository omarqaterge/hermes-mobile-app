package com.omarqaterge.hermesmobile;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native shell for the Hermes phone UI. The UI itself is a single self-contained HTML file
 * in assets/www (loaded from file://, which the Hermes gateway accepts as a non-web origin).
 * This class only provides what a web page cannot do on its own: read the dashboard session
 * token (no CORS), start Hermes in Termux, notifications, file picking, haptics.
 */
public class MainActivity extends Activity {
    static final String BASE_URL = "http://127.0.0.1:9119";
    static final int REQ_FILES = 41;
    static final int REQ_CAMERA = 42;
    static final Pattern TOKEN = Pattern.compile("__HERMES_SESSION_TOKEN__\\s*=\\s*\"([^\"]+)\"");

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    java.io.File cameraFile;
    volatile boolean foreground = false;
    /** Read by HermesService: skip reply/approval alerts while the chat is on screen. */
    static volatile boolean visible = false;
    long lastStartRequest = 0;
    volatile String cachedToken = "";
    String pendingSession = null;
    String pendingDraft = null;
    /** The live activity, so HermesService can hand it answers typed into notifications. */
    static volatile MainActivity current;
    /** "Share to Hermes": files another app shared, read on demand by the page (Bridge.sharedItem). */
    final java.util.List<Uri> sharedUris = new java.util.ArrayList<>();
    String pendingShareText = null;
    boolean shareWaiting = false;
    boolean pageReady = false;
    FrameLayout root;
    final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Last theme background the page chose (OLED black or default), so launch doesn't flash.
        int bg = getSharedPreferences("hm", MODE_PRIVATE).getInt("bg", Color.parseColor("#0E1115"));
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);

        root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        web = new WebView(this);
        web.setBackgroundColor(bg);
        // Keep the renderer at the app's priority while hidden, so it is still alive when a notification
        // answer needs the page (see wakePage).
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        setBarIcons(bg); // needs the window's decor view, so only after setContentView

        // Edge-to-edge (enforced from targetSdk 35): pad for system bars and the keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true); // the app page itself is file:///android_asset
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "HermesAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                newBridgeKey();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                openPendingSession();
                deliverShare();
                deliverShortcut();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!MEDIA_HOST.equals(u.getHost())) return null;
                return media(u, req.getRequestHeaders());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // Canvas pages run in sandboxed frames: their navigations never leave the app.
                if (!req.isForMainFrame()) return true;
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                if (safeLink(u)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception ignored) {
                    }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                if (params.isCaptureEnabled() && takePhoto()) return true;
                try {
                    Intent i = params.createIntent();
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(i, REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        HermesService.createChannels(this);
        HermesService.start(this);
        current = this;
        pendingSession = getIntent().getStringExtra("session");
        pendingDraft = getIntent().getStringExtra("draft");
        takeShare(getIntent());
        pendingShortcut = shortcutOf(getIntent());
        requestRuntimePermissions();
        startHermes(); // no-op if already running; the supervisor script is idempotent
        web.loadUrl("file:///android_asset/www/index.html");
    }

    void requestRuntimePermissions() {
        java.util.ArrayList<String> want = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            want.add(Manifest.permission.POST_NOTIFICATIONS);
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED)
            want.add("com.termux.permission.RUN_COMMAND");
        if (!want.isEmpty()) requestPermissions(want.toArray(new String[0]), 7);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == Voice.REQ_MIC) {
            voice.onPermission(results);
            return;
        }
        startHermes();
    }

    /** Ask Termux to run ~/bin/hermes-services (sshd + dashboard + memory sync; idempotent). */
    void startHermes() {
        long now = System.currentTimeMillis();
        if (now - lastStartRequest < 8000) return;
        lastStartRequest = now;
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return;
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/home/bin/hermes-services");
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            i.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
            startForegroundService(i);
            startError = "";
        } catch (Exception e) {
            // Termux missing or allow-external-apps disabled: the UI shows "Hermes is offline".
            startError = String.valueOf(e.getMessage());
        }
    }

    /** Why the last startHermes failed ("" = the intent went through), for the setup check. */
    volatile String startError = "";

    static final String SHIZUKU = "moe.shizuku.privileged.api";

    boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** What the setup check needs to know that only Android can tell. */
    String setupState() {
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        org.json.JSONObject o = new org.json.JSONObject();
        try {
            o.put("termux", installed("com.termux"));
            o.put("runCommand", checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED);
            o.put("notifications", Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
            o.put("batteryApp", pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()));
            o.put("batteryTermux", pm != null && pm.isIgnoringBatteryOptimizations("com.termux"));
            o.put("termuxApi", installed("com.termux.api"));
            o.put("shizuku", installed(SHIZUKU));
            o.put("startError", startError);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Open the place that fixes one setup item. Only these fixed targets: nothing from the page reaches an intent. */
    void setupFix(String what) {
        try {
            Intent i;
            switch (what) {
                case "permissions":
                    requestRuntimePermissions();
                    return;
                case "start":
                    lastStartRequest = 0;
                    startHermes();
                    return;
                case "notifications":
                    i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
                    break;
                case "battery-app":
                    i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                    break;
                case "battery-termux":
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:com.termux"));
                    break;
                case "app-settings":
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    break;
                case "open-termux":
                    i = getPackageManager().getLaunchIntentForPackage("com.termux");
                    if (i == null) return;
                    break;
                case "get-termux":
                    i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux/"));
                    break;
                case "get-termux-api":
                    i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux.api/"));
                    break;
                case "get-shizuku":
                    i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://shizuku.rikka.app/download/"));
                    break;
                case "open-shizuku":
                    i = getPackageManager().getLaunchIntentForPackage(SHIZUKU);
                    if (i == null) return;
                    break;
                case "storage":
                    // Termux asks Android for the files permission ("y": it asks before rebuilding an existing ~/storage).
                    runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c", "echo y | termux-setup-storage"});
                    return;
                case "restart-hermes":
                    // The hermes-services loop starts the dashboard again within ~10 s; a new one sees what Termux may
                    // reach now (e.g. files granted after Hermes started). Exact match, like install.sh.
                    runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c",
                            "pids=$(pgrep -f 'hermes dashboard --host 127.0.0.1 --port 9119'); [ -n \"$pids\" ] && kill -9 $pids"});
                    return;
                default:
                    return;
            }
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            // The direct battery prompt is missing on some ROMs: fall back to the app's own settings page.
            if (what.equals("battery-app")) setupFix("app-settings");
        }
    }


    /** Run a command inside Termux (needs RUN_COMMAND permission + allow-external-apps). */
    void runTermux(String path, String[] args) {
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return;
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", path);
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args);
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            startForegroundService(i);
        } catch (Exception ignored) {
        }
    }

    /** Opens Termux in front on `hermes auth add <provider>` inside Debian, for the logins Hermes only does in a terminal
     *  (Claude subscription). Both names are checked against a strict pattern, so the page can't put anything else in the command. */
    boolean signInTermux(String provider, String profile) {
        if (provider == null || !provider.matches("[a-z0-9][a-z0-9-]{0,39}")) return false;
        if (profile == null) profile = "";
        if (!profile.isEmpty() && !profile.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}")) return false;
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) return false;
        String hermes = profile.isEmpty() || profile.equals("default") ? "hermes" : "hermes -p " + profile;
        String script = "clear; echo 'Signing in to " + provider + " for Hermes.'; "
                + "echo 'To open the link: long-press it, More, Select URL. Then paste the code back here.'; echo; "
                + "proot-distro login debian -- bash -lc '" + hermes + " auth add " + provider + "'; "
                + "echo; echo 'Finished. Go back to Hermes Mobile: it shows whether the sign-in worked.'; read -r -p 'Press Enter to close. ' _";
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", false);
            i.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0"); // new session, Termux in front
            startForegroundService(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String s = intent.getStringExtra("session");
        if (s != null) {
            pendingSession = s;
            pendingDraft = intent.getStringExtra("draft");
            openPendingSession();
        }
        if (takeShare(intent)) deliverShare();
        String sc = shortcutOf(intent);
        if (sc != null) {
            pendingShortcut = sc;
            deliverShortcut();
        }
    }

    /** Launcher shortcut (res/xml/shortcuts.xml): "new" or "live". */
    String pendingShortcut = null;

    /** The shortcut an intent asks for: the "shortcut" extra, or the assist gesture / headset voice button
     *  (Hermes as the phone's digital assistant) → Live mode, or a new chat when the system hints at typing. */
    static String shortcutOf(Intent in) {
        if (in == null) return null;
        String act = in.getAction();
        if (Intent.ACTION_ASSIST.equals(act) || Intent.ACTION_VOICE_COMMAND.equals(act)) {
            if ((in.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null; // reopened from Recents
            return in.getBooleanExtra(Intent.EXTRA_ASSIST_INPUT_HINT_KEYBOARD, false) ? "new" : "live";
        }
        return in.getStringExtra("shortcut");
    }

    void deliverShortcut() {
        if (!pageReady || pendingShortcut == null) return;
        String sc = pendingShortcut.replaceAll("[^a-z]", "");
        pendingShortcut = null;
        getIntent().removeExtra("shortcut");
        getIntent().setAction(Intent.ACTION_MAIN); // an ASSIST intent must not start Live mode again
        web.evaluateJavascript("window.hermesShortcut && window.hermesShortcut('" + sc + "')", null);
    }

    /** The last opened chat as a dynamic launcher shortcut (it opens through the existing "session" extra). */
    void setLastChat(String id, String title) {
        try {
            android.content.pm.ShortcutManager sm = getSystemService(android.content.pm.ShortcutManager.class);
            if (sm == null) return;
            if (id == null || id.isEmpty()) {
                sm.removeDynamicShortcuts(java.util.Collections.singletonList("last_chat"));
                return;
            }
            String label = title == null || title.trim().isEmpty() ? "Last chat" : title.trim().replaceFirst("^⎇\\s*", "");
            if (label.length() > 25) label = label.substring(0, 24) + "…";
            Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).putExtra("session", id)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            android.content.pm.ShortcutInfo si = new android.content.pm.ShortcutInfo.Builder(this, "last_chat")
                    .setShortLabel(label)
                    .setLongLabel(title == null || title.isEmpty() ? "Last chat" : title.length() > 60 ? title.substring(0, 59) + "…" : title)
                    .setIcon(android.graphics.drawable.Icon.createWithResource(this, R.mipmap.ic_launcher))
                    .setIntent(open)
                    .setRank(0)
                    .build();
            sm.setDynamicShortcuts(java.util.Collections.singletonList(si));
        } catch (Exception ignored) {
            // rate-limited or not supported by the launcher: cosmetic
        }
    }

    /** ACTION_SEND / SEND_MULTIPLE: keep the text and the file URIs for the page. */
    String sharedType;

    boolean takeShare(Intent in) {
        if (in == null) return false;
        String act = in.getAction();
        if (!Intent.ACTION_SEND.equals(act) && !Intent.ACTION_SEND_MULTIPLE.equals(act)) return false;
        sharedUris.clear();
        sharedType = in.getType();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(act)) {
                java.util.ArrayList<Uri> l = in.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (l != null) for (Uri u : l) if (u != null && sharedUris.size() < 10) sharedUris.add(u);
            } else {
                Uri u = in.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) sharedUris.add(u);
            }
        } catch (Exception ignored) {
        }
        CharSequence subject = in.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        CharSequence text = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
        StringBuilder t = new StringBuilder();
        // A shared link often comes with the page title as subject; skip it when the text already has it.
        if (subject != null && subject.length() > 0 && (text == null || !text.toString().contains(subject))) t.append(subject).append("\n");
        if (text != null) t.append(text);
        pendingShareText = t.length() > 100_000 ? t.substring(0, 100_000) : t.toString();
        shareWaiting = true;
        // Handled: a later recreation of the activity must not share the same thing again.
        in.setAction(Intent.ACTION_MAIN);
        return true;
    }

    void deliverShare() {
        if (!pageReady || !shareWaiting) return;
        shareWaiting = false;
        String js = "window.hermesShared && window.hermesShared(" + sharedUris.size() + "," + JSONObject.quote(pendingShareText == null ? "" : pendingShareText) + ")";
        pendingShareText = null;
        web.evaluateJavascript(js, null);
    }

    /** One shared file as {name, mime, b64} (≤ 20 MB), or {name, error}. */
    String readShared(int i) {
        JSONObject o = new JSONObject();
        try {
            if (i < 0 || i >= sharedUris.size()) return o.put("error", "gone").toString();
            Uri u = sharedUris.get(i);
            String name = null;
            long size = -1;
            try (android.database.Cursor c = getContentResolver().query(u, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int ni = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    int si = c.getColumnIndex(android.provider.OpenableColumns.SIZE);
                    if (ni >= 0) name = c.getString(ni);
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
                }
            } catch (Exception ignored) {
            }
            if (name == null) name = u.getLastPathSegment();
            if (name == null || name.isEmpty()) name = "shared";
            name = name.replaceAll("[/\\\\\\x00-\\x1f]", "_");
            o.put("name", name);
            final long max = 20L * 1024 * 1024;
            if (size > max) return o.put("error", "too large (max 20 MB)").toString();
            // Some providers (Termux, file managers) report no type or a generic one: guess from the name, then
            // take the share's own type when it names one kind (image/png, not image/* or */*).
            String mime = getContentResolver().getType(u);
            if (mime == null || mime.equals("application/octet-stream")) {
                String guess = java.net.URLConnection.guessContentTypeFromName(name);
                if (guess != null) mime = guess;
                else if (sharedType != null && !sharedType.contains("*")) mime = sharedType;
            }
            o.put("mime", mime == null ? "application/octet-stream" : mime);
            try (InputStream in = getContentResolver().openInputStream(u)) {
                if (in == null) return o.put("error", "unreadable").toString();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int r;
                while ((r = in.read(buf)) > 0) {
                    out.write(buf, 0, r);
                    if (out.size() > max) return o.put("error", "too large (max 20 MB)").toString();
                }
                o.put("b64", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP));
            }
            return o.toString();
        } catch (Exception e) {
            try {
                return o.put("error", "unreadable").toString();
            } catch (Exception ignored) {
                return "{\"error\":\"unreadable\"}";
            }
        }
    }

    void openPendingSession() {
        if (!pageReady || pendingSession == null) return;
        String id = pendingSession.replaceAll("[^A-Za-z0-9_.:-]", "");
        pendingSession = null;
        String draft = pendingDraft == null ? "" : pendingDraft;
        pendingDraft = null;
        web.evaluateJavascript("window.hermesOpenSession && window.hermesOpenSession('" + id + "'," + JSONObject.quote(draft) + ")", null);
    }

    /** An answer typed into a notification (HermesService): the page owns the connection Hermes asked on.
     *  `done` gets true when the page took it. Main thread only. */
    void deliverAnswer(String kind, String session, String text, java.util.function.Consumer<Boolean> done) {
        if (!pageReady) {
            done.accept(false);
            return;
        }
        wakePage(30_000);
        String js = "window.hermesAnswer ? window.hermesAnswer(" + JSONObject.quote(kind) + "," + JSONObject.quote(session == null ? "" : session)
                + "," + JSONObject.quote(text) + ") : 'n'";
        web.evaluateJavascript(js, v -> done.accept("\"y\"".equals(v)));
    }

    /** About a minute after the app is hidden, Chromium freezes the page: no timers, network or socket events
     *  until it is shown again, so an answer typed into a notification would sit there. Tell the WebView its
     *  window is visible for a while (that unfreezes the page), then let it sleep again. */
    void wakePage(long ms) {
        if (visible) return;
        web.dispatchWindowVisibilityChanged(View.VISIBLE);
        handler.removeCallbacks(sleepPage);
        handler.postDelayed(sleepPage, ms);
    }

    final Runnable sleepPage = () -> {
        if (!visible) web.dispatchWindowVisibilityChanged(View.GONE);
    };

    String token(boolean refresh) {
        if (refresh || cachedToken.isEmpty()) {
            String html = httpGet(BASE_URL + "/");
            Matcher m = html == null ? null : TOKEN.matcher(html);
            cachedToken = (m != null && m.find()) ? m.group(1) : "";
        }
        return cachedToken;
    }

    /** Minimal HTTP/1.1 client for the local dashboard: any method may carry a body (DELETE too). */
    /** Only dashboard REST calls: a known verb and a plain /api/ path (no CR/LF or spaces: header injection). */
    static boolean safeRequest(String method, String path) {
        if (method == null || path == null) return false;
        switch (method) {
            case "GET": case "POST": case "PUT": case "DELETE": case "PATCH": break;
            default: return false;
        }
        if (!path.startsWith("/api/") || path.length() > 4096) return false;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c <= ' ' || c == 127) return false;
        }
        return true;
    }

    /** Links we hand to other apps: web pages, mail and phone numbers only (no intent:, file:, content:, market:…). */
    static boolean safeLink(Uri u) {
        String sc = u == null ? null : u.getScheme();
        return "http".equals(sc) || "https".equals(sc) || "mailto".equals(sc) || "tel".equals(sc);
    }

    static String[] rawHttp(String method, String path, String token, String body) throws Exception {
        if (!safeRequest(method, path)) return new String[]{"400", "blocked request"};
        try (Socket sock = new Socket()) {
            sock.connect(new InetSocketAddress("127.0.0.1", 9119), 3000);
            sock.setSoTimeout(120000);
            byte[] payload = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
            StringBuilder h = new StringBuilder();
            h.append(method).append(' ').append(path).append(" HTTP/1.1\r\n")
             .append("Host: 127.0.0.1:9119\r\nConnection: close\r\nAccept: application/json\r\n");
            if (token != null && !token.isEmpty()) h.append("X-Hermes-Session-Token: ").append(token).append("\r\n");
            if (body != null) h.append("Content-Type: application/json\r\nContent-Length: ").append(payload.length).append("\r\n");
            h.append("\r\n");
            OutputStream out = sock.getOutputStream();
            out.write(h.toString().getBytes(StandardCharsets.UTF_8));
            out.write(payload);
            out.flush();
            InputStream in = new BufferedInputStream(sock.getInputStream());
            ByteArrayOutputStream all = new ByteArrayOutputStream();
            byte[] buf = new byte[32768];
            int r;
            while ((r = in.read(buf)) > 0) all.write(buf, 0, r);
            byte[] data = all.toByteArray();
            int sep = -1;
            for (int k = 0; k + 3 < data.length; k++)
                if (data[k] == 13 && data[k + 1] == 10 && data[k + 2] == 13 && data[k + 3] == 10) { sep = k; break; }
            if (sep < 0) return new String[]{"502", "bad response"};
            String head = new String(data, 0, sep, StandardCharsets.ISO_8859_1);
            String status = head.split(" ", 3).length > 1 ? head.split(" ", 3)[1] : "502";
            byte[] rest = java.util.Arrays.copyOfRange(data, sep + 4, data.length);
            if (head.toLowerCase().contains("transfer-encoding: chunked")) rest = dechunk(rest);
            return new String[]{status, new String(rest, StandardCharsets.UTF_8)};
        }
    }

    // ── media streaming: <img>/<video>/<audio> load https://hm-media.invalid/m?k=<key>&p=<path>; we fetch it from
    // the plugin's /media (with the session token and the player's Range header) and hand the socket's stream
    // straight to the WebView. The per-page key keeps canvas frames (which could also request the URL) out.
    static final String MEDIA_HOST = "hm-media.invalid";
    /** Dashboard calls from the page: idle threads are reused (a new one only when all are busy, so a slow call never queues others). */
    static final java.util.concurrent.ExecutorService HTTP_POOL = java.util.concurrent.Executors.newCachedThreadPool();
    private volatile String mediaKey = "";

    WebResourceResponse media(Uri u, java.util.Map<String, String> reqHeaders) {
        String k = u.getQueryParameter("k"), path = u.getQueryParameter("p");
        if (k == null || mediaKey.isEmpty() || !java.security.MessageDigest.isEqual(
                mediaKey.getBytes(StandardCharsets.UTF_8), k.getBytes(StandardCharsets.UTF_8)))
            return plain(403, "Forbidden");
        if (path == null || !path.startsWith("/") || path.contains("..") || path.indexOf('\0') >= 0) return plain(400, "Bad Request");
        String range = null;
        if (reqHeaders != null) for (java.util.Map.Entry<String, String> h : reqHeaders.entrySet())
            if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        if (range != null && !range.matches("bytes=\\d*-\\d*")) range = null;
        try {
            String q = "/api/plugins/hermes-mobile/media?path=" + java.net.URLEncoder.encode(path, "UTF-8").replace("+", "%20");
            WebResourceResponse r = streamGet(q, token(false), range);
            if (r.getStatusCode() == 401 || r.getStatusCode() == 403) r = streamGet(q, token(true), range);
            return r;
        } catch (Exception e) {
            return plain(502, "Bad Gateway");
        }
    }

    static WebResourceResponse plain(int code, String reason) {
        java.util.Map<String, String> h = new java.util.HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, h, new java.io.ByteArrayInputStream(new byte[0]));
    }

    /** GET on the dashboard whose body stays a live stream (the socket closes with it). */
    static WebResourceResponse streamGet(String path, String token, String range) throws Exception {
        if (!safeRequest("GET", path)) return plain(400, "Bad Request");
        Socket sock = new Socket();
        try {
            sock.connect(new InetSocketAddress("127.0.0.1", 9119), 3000);
            sock.setSoTimeout(60000);
            StringBuilder h = new StringBuilder("GET ").append(path).append(" HTTP/1.1\r\nHost: 127.0.0.1:9119\r\nConnection: close\r\n");
            if (token != null && !token.isEmpty()) h.append("X-Hermes-Session-Token: ").append(token).append("\r\n");
            if (range != null) h.append("Range: ").append(range).append("\r\n");
            h.append("\r\n");
            OutputStream out = sock.getOutputStream();
            out.write(h.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            final InputStream in = new BufferedInputStream(sock.getInputStream(), 65536);
            // Status line and headers, byte by byte up to the blank line.
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            int c;
            while ((c = in.read()) >= 0) {
                head.write(c);
                if (head.size() > 32768) throw new java.io.IOException("headers too large");
                int sz = head.size();
                byte[] b = head.toByteArray();
                if (sz >= 4 && b[sz - 4] == 13 && b[sz - 3] == 10 && b[sz - 2] == 13 && b[sz - 1] == 10) break;
            }
            String[] lines = head.toString("ISO-8859-1").split("\r\n");
            String[] st = lines[0].split(" ", 3);
            int code = Integer.parseInt(st[1]);
            String reason = st.length > 2 && !st[2].trim().isEmpty() ? st[2].trim() : (code == 206 ? "Partial Content" : "OK");
            java.util.Map<String, String> hs = new java.util.HashMap<>();
            String type = "application/octet-stream";
            boolean chunked = false;
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon <= 0) continue;
                String name = lines[i].substring(0, colon).trim(), val = lines[i].substring(colon + 1).trim();
                String ln = name.toLowerCase();
                if (ln.equals("content-type")) type = val.split(";")[0].trim();
                else if (ln.equals("transfer-encoding")) chunked = val.toLowerCase().contains("chunked");
                else if (ln.equals("content-length") || ln.equals("content-range") || ln.equals("accept-ranges")) hs.put(name, val);
            }
            hs.put("Cache-Control", "no-store");
            if (code < 200 || code >= 300) {
                sock.close();
                return plain(code, code == 404 ? "Not Found" : "Error");
            }
            InputStream body = chunked ? new java.io.ByteArrayInputStream(dechunk(readAll(in))) : in;
            final Socket s = sock;
            InputStream closing = new java.io.FilterInputStream(body) {
                @Override
                public void close() throws java.io.IOException {
                    try {
                        super.close();
                    } finally {
                        s.close();
                    }
                }
            };
            return new WebResourceResponse(type, null, code, reason, hs, closing);
        } catch (Exception e) {
            sock.close();
            throw e;
        }
    }

    static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        byte[] buf = new byte[32768];
        int r;
        while ((r = in.read(buf)) > 0) all.write(buf, 0, r);
        return all.toByteArray();
    }

    static byte[] dechunk(byte[] b) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int i = 0;
        while (i < b.length) {
            int eol = i;
            while (eol + 1 < b.length && !(b[eol] == 13 && b[eol + 1] == 10)) eol++;
            String hex = new String(b, i, eol - i, StandardCharsets.ISO_8859_1).split(";")[0].trim();
            int n;
            try { n = Integer.parseInt(hex, 16); } catch (Exception e) { break; }
            if (n == 0) break;
            out.write(b, eol + 2, Math.min(n, b.length - eol - 2));
            i = eol + 2 + n + 2;
        }
        return out.toByteArray();
    }

    /** Map a path Hermes sees (Debian) to one Termux can open. */
    static String hostPath(String p) {
        if (p.startsWith("/root/") || p.equals("/root"))
            return "/data/data/com.termux/files/usr/var/lib/proot-distro/containers/debian/rootfs" + p;
        if (p.startsWith("/sdcard")) return "/storage/emulated/0" + p.substring(7);
        return p;
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        visible = true;
        handler.removeCallbacks(sleepPage);
        if (!HermesService.running) HermesService.start(this);
        // Pinned approval popups: the in-app sheet takes over, so none can be left stuck.
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications())
            if (n.getId() == 2 && n.getTag() != null && n.getTag().startsWith("approval:")) nm.cancel(n.getTag(), 2);
        web.evaluateJavascript("window.hermesResume && window.hermesResume()", null);
    }

    /** Dark icons on light bars and the reverse, decided from the page background. */
    void setBarIcons(int bg) {
        boolean lightBg = (0.299 * Color.red(bg) + 0.587 * Color.green(bg) + 0.114 * Color.blue(bg)) > 153;
        int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        try {
            android.view.WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) c.setSystemBarsAppearance(lightBg ? mask : 0, mask);
        } catch (RuntimeException ignored) {
            // icon colours are cosmetic: never let them take the app down
        }
    }

    /** The phone switched light/dark: let the page re-resolve the "System" theme. */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration cfg) {
        super.onConfigurationChanged(cfg);
        if (web != null) web.evaluateJavascript("window.__hmSystemTheme && window.__hmSystemTheme()", null);
    }

    @Override
    protected void onPause() {
        foreground = false;
        visible = false;
        voice.stopListening(); // never leave the microphone open in the background
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.hermesBack && window.hermesBack()) ? 'y' : 'n'", v -> {
            if (!"\"y\"".equals(v)) moveTaskToBack(true);
        });
    }

    /** Composer → Camera (`<input capture>`): the camera app writes a full-size photo into our cache. */
    boolean takePhoto() {
        try {
            java.io.File dir = CameraProvider.dir(this);
            java.io.File[] old = dir.listFiles();
            if (old != null) for (java.io.File f : old) f.delete(); // the page already read the last one
            cameraFile = new java.io.File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
            Uri out = CameraProvider.uriFor(cameraFile);
            Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, out)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri("photo", out)); // carries the grant to the camera app
            startActivityForResult(i, REQ_CAMERA);
            return true;
        } catch (Exception e) {
            cameraFile = null;
            return false; // no camera app: fall back to the normal picker
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ_CAMERA && fileCallback != null) {
            java.io.File f = cameraFile;
            cameraFile = null;
            boolean got = result == RESULT_OK && f != null && f.length() > 0;
            fileCallback.onReceiveValue(got ? new Uri[]{Uri.fromFile(f)} : null);
            fileCallback = null;
            return;
        }
        if (req == REQ_FILES && fileCallback != null) {
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    uris = new Uri[n];
                    for (int k = 0; k < n; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, result, data);
    }

    static String httpGet(String url) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(4000);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int r;
                while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
                return out.toString(StandardCharsets.UTF_8.name());
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return null;
        }
    }

    final Voice voice = new Voice(this);

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        voice.destroy();
        super.onDestroy();
    }

    // The bridge object is injected into EVERY frame of the WebView, including sandboxed iframes that show
    // untrusted HTML (the canvas). So every call needs a per-page-load secret that only the app's own page
    // receives, once, through handshake(). Frames that merely see the object can't use it.
    private volatile String bridgeKey = "";
    private volatile boolean keyTaken = true;

    void newBridgeKey() {
        byte[] b = new byte[24];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        bridgeKey = sb.toString();
        keyTaken = false;
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder mk = new StringBuilder();
        for (byte x : b) mk.append(String.format("%02x", x));
        mediaKey = mk.toString();
    }

    boolean ok(String key) {
        return key != null && !bridgeKey.isEmpty() && java.security.MessageDigest.isEqual(
                bridgeKey.getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8));
    }

    // ---- In-app update: download the release APK from this project's GitHub releases, check it, hand it to the system installer ----
    static final String UPDATE_ACTION = "com.omarqaterge.hermesmobile.UPDATE_RESULT";
    final java.util.concurrent.atomic.AtomicBoolean updating = new java.util.concurrent.atomic.AtomicBoolean();
    boolean updateReceiverOn;

    /** Only this project's release assets (https), nothing else is ever downloaded and installed. */
    static boolean updateUrlOk(Uri u) {
        String path = u == null ? null : u.getPath();
        return u != null && "https".equals(u.getScheme()) && "github.com".equals(u.getHost()) && path != null
                && path.startsWith("/omarqaterge/hermes-mobile-app/releases/download/") && path.endsWith(".apk") && !path.contains("..");
    }

    void updateState(String state, int pct, String msg) {
        String js = "window.hermesUpdate && window.hermesUpdate(" + JSONObject.quote(state) + "," + pct + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    void startUpdate(String url) {
        Uri u = Uri.parse(url == null ? "" : url);
        if (!updateUrlOk(u)) { updateState("error", 0, "That isn't an official Hermes Mobile download."); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            updateState("permission", 0, "Allow Hermes to install updates, then tap Update again.");
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {
                }
            });
            return;
        }
        if (!updating.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                java.io.File dir = new java.io.File(getCacheDir(), "update");
                dir.mkdirs();
                java.io.File apk = new java.io.File(dir, "hermes-mobile.apk");
                updateState("downloading", 0, "");
                download(u, apk);
                // Must be this app, newer than what is installed. The installer also refuses a different signing key.
                android.content.pm.PackageInfo got = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
                android.content.pm.PackageInfo mine = getPackageManager().getPackageInfo(getPackageName(), 0);
                if (got == null || !getPackageName().equals(got.packageName)) throw new Exception("The download isn't a Hermes Mobile app file.");
                if (got.versionCode <= mine.versionCode) throw new Exception("You already have this version.");
                updateState("installing", 100, "");
                commitInstall(apk);
            } catch (Exception e) {
                updateState("error", 0, e.getMessage() == null ? "Update failed." : e.getMessage());
            } finally {
                updating.set(false);
            }
        }, "hm-update").start();
    }

    void download(Uri start, java.io.File out) throws Exception {
        URL url = new URL(start.toString());
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Download failed (redirect).");
                URL next = new URL(url, loc);
                String h = next.getHost();
                if (!"https".equals(next.getProtocol()) || !(h.equals("github.com") || h.endsWith(".githubusercontent.com") || h.equals("githubusercontent.com")))
                    throw new Exception("Download failed (unexpected host).");
                url = next;
                continue;
            }
            if (code != 200) { c.disconnect(); throw new Exception("Download failed (HTTP " + code + ")."); }
            long total = c.getContentLengthLong();
            if (total > 150L * 1024 * 1024) { c.disconnect(); throw new Exception("Download is too large."); }
            long done = 0;
            int lastPct = -1;
            try (InputStream in = new BufferedInputStream(c.getInputStream()); java.io.FileOutputStream fo = new java.io.FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    fo.write(buf, 0, n);
                    done += n;
                    if (done > 150L * 1024 * 1024) throw new Exception("Download is too large.");
                    int pct = total > 0 ? (int) (done * 100 / total) : 0;
                    if (pct != lastPct) { lastPct = pct; updateState("downloading", pct, ""); }
                }
            } finally {
                c.disconnect();
            }
            return;
        }
        throw new Exception("Download failed (too many redirects).");
    }

    void commitInstall(java.io.File apk) throws Exception {
        if (!updateReceiverOn) {
            android.content.BroadcastReceiver rx = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent in) {
                    int st = in.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -1);
                    if (st == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent confirm = in.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (confirm != null) {
                            try {
                                startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                            } catch (Exception e) {
                                updateState("error", 0, "Couldn't open the installer.");
                            }
                        }
                    } else if (st != android.content.pm.PackageInstaller.STATUS_SUCCESS) {
                        String m = in.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE);
                        updateState("error", 0, st == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED ? "Update cancelled." : (m == null ? "Install failed." : m));
                    }
                }
            };
            IntentFilter f = new IntentFilter(UPDATE_ACTION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(rx, f);
            updateReceiverOn = true;
        }
        android.content.pm.PackageInstaller pi = getPackageManager().getPackageInstaller();
        int id = pi.createSession(new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL));
        try (android.content.pm.PackageInstaller.Session ses = pi.openSession(id)) {
            try (InputStream in = new java.io.FileInputStream(apk); OutputStream o = ses.openWrite("hermes-mobile.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                ses.fsync(o);
            }
            PendingIntent pend = PendingIntent.getBroadcast(this, id, new Intent(UPDATE_ACTION).setPackage(getPackageName()),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            ses.commit(pend.getIntentSender());
        }
    }

    final class Bridge {
        /** First caller after a page load gets the key (the app's own script runs first); later callers get nothing. */
        @JavascriptInterface
        public synchronized String handshake() {
            if (keyTaken) return "";
            keyTaken = true;
            return bridgeKey;
        }

        @JavascriptInterface
        public void speak(String key, String text, String cfg) {
            if (!ok(key)) return;
            runOnUiThread(() -> voice.speak(text, cfg));
        }

        /** Read-aloud mode for the background service: {"global":bool,"sessions":{id:bool},"tts":{…}}. */
        @JavascriptInterface
        public void setReadAloud(String key, String json) {
            if (!ok(key)) return;
            if (json == null || json.length() > 200_000) return;
            try {
                new JSONObject(json); // must be valid JSON
            } catch (Exception e) {
                return;
            }
            getSharedPreferences("hm", MODE_PRIVATE).edit().putString("readaloud", json).apply();
        }

        /** Whether Hermes is the phone's digital assistant app (the assist gesture opens Live mode). */
        @JavascriptInterface
        public boolean isAssistant(String key) {
            if (!ok(key)) return false;
            if (Build.VERSION.SDK_INT < 29) return false;
            try {
                android.app.role.RoleManager rm = getSystemService(android.app.role.RoleManager.class);
                return rm != null && rm.isRoleHeld(android.app.role.RoleManager.ROLE_ASSISTANT);
            } catch (Exception e) {
                return false;
            }
        }

        /** A provider login that Hermes only does in a terminal: run it in Termux (false = couldn't start it). */
        @JavascriptInterface
        public boolean signInTermux(String key, String provider, String profile) {
            if (!ok(key)) return false;
            return MainActivity.this.signInTermux(provider, profile);
        }

        /** Opens the system page where the digital assistant app is chosen (the role can't be requested directly). */
        @JavascriptInterface
        public void openAssistantSettings(String key) {
            if (!ok(key)) return;
            runOnUiThread(() -> {
                for (String a : new String[] {android.provider.Settings.ACTION_VOICE_INPUT_SETTINGS, android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, android.provider.Settings.ACTION_SETTINGS}) {
                    try {
                        startActivity(new Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        return;
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** Opens the app of an installed text-to-speech engine (only real engines), e.g. ElevenReader, to pick its voice. */
        @JavascriptInterface
        public void openTtsEngineApp(String key, String pkg) {
            if (!ok(key)) return;
            if (pkg == null || pkg.length() > 200) return;
            runOnUiThread(() -> {
                try {
                    boolean isEngine = false;
                    for (android.content.pm.ResolveInfo ri : getPackageManager().queryIntentServices(new Intent("android.intent.action.TTS_SERVICE"), 0))
                        if (ri.serviceInfo != null && pkg.equals(ri.serviceInfo.packageName)) isEngine = true;
                    if (!isEngine) return;
                    Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                    if (i != null) startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception ignored) {
                }
            });
        }

        /** Android share sheet for a text (a canvas document). */
        @JavascriptInterface
        public void shareText(String key, String title, String text) {
            if (!ok(key)) return;
            if (text == null || text.length() > 400_000) return;
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title);
                    startActivity(Intent.createChooser(i, title == null ? "Share" : title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void listVoices(String key, String cfg) {
            if (!ok(key)) return;
            runOnUiThread(() -> voice.listVoices(cfg));
        }

        @JavascriptInterface
        public void stopSpeaking(String key) {
            if (!ok(key)) return;
            runOnUiThread(voice::stopSpeaking);
        }

        @JavascriptInterface
        public void startListening(String key) {
            if (!ok(key)) return;
            runOnUiThread(voice::startListening);
        }

        @JavascriptInterface
        public void stopListening(String key) {
            if (!ok(key)) return;
            runOnUiThread(voice::stopListening);
        }

        /** getToken without blocking the page: the answer comes back as window.__hmToken(id, token). */
        @JavascriptInterface
        public void getTokenAsync(String key, final int id) {
            if (!ok(key)) return;
            new Thread(() -> {
                String t = token(true);
                String js = "window.__hmToken && window.__hmToken(" + id + "," + JSONObject.quote(t) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }, "hermes-token").start();
        }

        @JavascriptInterface
        public String getToken(String key) {
            if (!ok(key)) return "";
            String html = httpGet(BASE_URL + "/");
            if (html == null) return "";
            Matcher m = TOKEN.matcher(html);
            return m.find() ? m.group(1) : "";
        }


        @JavascriptInterface
        public void httpAsync(String key, final int id, final String method, final String path, final String body) {
            if (!ok(key)) return;
            HTTP_POOL.execute(() -> {
                String[] res;
                try {
                    res = rawHttp(method, path, token(false), body);
                    if ("401".equals(res[0]) || "403".equals(res[0])) res = rawHttp(method, path, token(true), body);
                } catch (Exception e) {
                    res = new String[]{"0", String.valueOf(e.getMessage())};
                }
                final String js = "window.__hmHttp && window.__hmHttp(" + id + "," + res[0] + "," + JSONObject.quote(res[1]) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            });
        }

        @JavascriptInterface
        public void openFile(String key, String path) {
            if (!ok(key)) return;
            if (path == null || !path.startsWith("/") || path.contains("..") || path.indexOf('\0') >= 0) return;
            runTermux("/data/data/com.termux/files/usr/bin/termux-open", new String[]{hostPath(path)});
        }

        @JavascriptInterface
        public String getBaseUrl(String key) {
            if (!ok(key)) return "";
            return BASE_URL;
        }

        @JavascriptInterface
        public void startHermes(String key) {
            if (!ok(key)) return;
            runOnUiThread(MainActivity.this::startHermes);
        }

        @JavascriptInterface
        public void notify(String key, String title, String body, String tag) {
            if (!ok(key)) return;
            Intent open = new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            // "needs_you": the old "hermes" channel is deleted by HermesService, and posts to it were dropped.
            Notification n = new Notification.Builder(MainActivity.this, HermesService.CH_ALERT)
                    .setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setColor(Color.parseColor("#D9A441"))
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            getSystemService(NotificationManager.class).notify(tag, 1, n);
        }

        @JavascriptInterface
        public void setBackground(String key, String hex) {
            if (!ok(key)) return;
            final int c;
            try {
                c = Color.parseColor(hex);
            } catch (IllegalArgumentException e) {
                return;
            }
            getSharedPreferences("hm", MODE_PRIVATE).edit().putInt("bg", c).apply();
            runOnUiThread(() -> {
                getWindow().setStatusBarColor(c);
                getWindow().setNavigationBarColor(c);
                setBarIcons(c);
                root.setBackgroundColor(c);
                web.setBackgroundColor(c);
            });
        }

        /** Is the phone in dark mode? (The "System" theme follows it.) */
        @JavascriptInterface
        public boolean isSystemDark(String key) {
            if (!ok(key)) return false;
            return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public void cancelNotification(String key, String tag) {
            if (!ok(key)) return;
            getSystemService(NotificationManager.class).cancel(tag, 1);
        }

        @JavascriptInterface
        public void openExternal(String key, String url) {
            if (!ok(key)) return;
            Uri u = Uri.parse(url);
            if (!safeLink(u)) return;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void copyText(String key, String text) {
            if (!ok(key)) return;
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Hermes", text));
        }

        @JavascriptInterface
        public void copyRich(String key, String text, String html) {
            if (!ok(key)) return;
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newHtmlText("Hermes", text, html));
        }

        @JavascriptInterface
        public void haptic(String key) {
            if (!ok(key)) return;
            runOnUiThread(() -> web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP));
        }

        @JavascriptInterface
        public boolean isInForeground(String key) {
            if (!ok(key)) return false;
            return foreground;
        }

        /** Prefix of streamed media URLs for this page load; append the URL-encoded phone path. */
        @JavascriptInterface
        public String mediaBase(String key) {
            if (!ok(key)) return "";
            return "https://" + MEDIA_HOST + "/m?k=" + mediaKey + "&p=";
        }

        @JavascriptInterface
        public void setLastChat(String key, String id, String title) {
            if (!ok(key)) return;
            if (id != null && (id.length() > 200 || !id.matches("[A-Za-z0-9_.:-]*"))) return;
            final String t = title == null ? "" : title.length() > 200 ? title.substring(0, 200) : title;
            runOnUiThread(() -> MainActivity.this.setLastChat(id, t));
        }

        @JavascriptInterface
        public String sharedItem(String key, int index) {
            if (!ok(key)) return "";
            return readShared(index);
        }

        @JavascriptInterface
        public String setupState(String key) {
            if (!ok(key)) return "{}";
            return MainActivity.this.setupState();
        }

        @JavascriptInterface
        public void setupFix(String key, final String what) {
            if (!ok(key) || what == null) return;
            runOnUiThread(() -> MainActivity.this.setupFix(what));
        }

        @JavascriptInterface
        public void installUpdate(String key, final String url) {
            if (!ok(key)) return;
            MainActivity.this.startUpdate(url);
        }

        @JavascriptInterface
        public String appVersion(String key) {
            if (!ok(key)) return "";
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }
    }
}
