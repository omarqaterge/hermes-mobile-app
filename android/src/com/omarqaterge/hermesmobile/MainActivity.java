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
        // Start-up timing (logcat tag hmboot; the page's own marks are in Settings → About → Last start-up).
        bootT0 = 0; // each launch counts from its own create
        bootLog("create");
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
                bootLog("page-started");
                newBridgeKey();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bootLog("page-finished");
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
        startUpdateFromIntent(getIntent());
        if (getIntent().getBooleanExtra("clearDone", false)) { getIntent().removeExtra("clearDone"); HermesService.clearDoneChip(); }
        pendingSession = getIntent().getStringExtra("session");
        pendingDraft = getIntent().getStringExtra("draft");
        takeShare(getIntent());
        pendingShortcut = shortcutOf(getIntent());
        requestRuntimePermissions();
        startHermes(); // no-op if already running; the supervisor script is idempotent
        bootLog("load-url");
        web.loadUrl("file:///android_asset/www/index.html");
    }

    private static long bootT0 = 0;

    /** One start-up stage to logcat (`adb logcat -s hmboot`): ms since this process's first mark, plus uptime. */
    static void bootLog(String stage) {
        long now = android.os.SystemClock.uptimeMillis();
        if (bootT0 == 0) bootT0 = now;
        android.util.Log.i("hmboot", stage + " +" + (now - bootT0) + "ms (uptime " + now + ")");
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
        setupChanged();
    }

    /** Ask Termux to run ~/bin/hermes-services (sshd + dashboard + memory sync; idempotent). Automatic starts (launch,
     *  permission answer, the page's reconnects) wait until Termux has accepted a command once: on a fresh phone before
     *  the installer, Termux refuses each one with an error notification. None either while the installer runs. */
    void startHermes() {
        if (!termuxOk(this) || HermesService.setup(this).installing()) return;
        startHermesNow();
    }

    void startHermesNow() {
        if (Uninstall.started(this)) return; // Settings → Uninstall Hermes removed (or is removing) it
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
            // Shizuku is exempt from battery limits (Android may otherwise stop its server in the background)
            o.put("batteryShizuku", pm != null && installed(SHIZUKU) && pm.isIgnoringBatteryOptimizations(SHIZUKU));
            o.put("sdk", Build.VERSION.SDK_INT); // Wireless debugging (Shizuku start on the phone itself) needs 30
            o.put("termuxApi", installed("com.termux.api"));
            o.put("shizuku", installed(SHIZUKU));
            o.put("shizukuRunning", ShizukuProvider.running()); // the binder Shizuku's server sent to ShizukuProvider is alive
            // "Shizuku starts by itself": Android 11+, WRITE_SECURE_SETTINGS granted, Termux's adb paired, the keeper's last outcome
            o.put("shizukuAuto", ShizukuKeeper.state(this));
            o.put("maker", Build.MANUFACTURER.toLowerCase(java.util.Locale.ROOT));
            // The Autostart step: "" = this phone has no such switch (step hidden); list/app/settings = the kind of page
            // the button opens; "info" = a maker with the switch but none of its pages opens (App info fallback).
            Autostart.Vendor av = Autostart.vendor(Build.MANUFACTURER, Build.BRAND);
            Autostart.Page ap = av == null ? null : autostartPage(av);
            o.put("autostart", av == null ? "" : ap == null ? "info" : ap.kind);
            o.put("autostartName", av == null ? "" : av.name);
            o.put("autostartWhere", av == null ? "" : av.where);
            o.put("startError", startError);
            // App-first setup
            o.put("termuxBoot", installed(TERMUX_BOOT));
            o.put("termuxBootStopped", stopped(TERMUX_BOOT));
            o.put("termuxSigner", installed("com.termux") ? (FDROID_SIGNER.equals(signer("com.termux")) ? "fdroid" : "other") : "");
            o.put("termuxVersion", versionName("com.termux"));
            o.put("canInstall", getPackageManager().canRequestPackageInstalls());
            o.put("installing", helperInFlight()); // a helper app download/prompt in flight
            o.put("devOptions", android.provider.Settings.Global.getInt(getContentResolver(), android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1);
            o.put("wirelessDebugging", android.provider.Settings.Global.getInt(getContentResolver(), "adb_wifi_enabled", 0) == 1);
            o.put("probe", true);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    static final String TERMUX_BOOT = "com.termux.boot";

    /** Installed but never opened (Android keeps such an app from getting BOOT_COMPLETED). */
    boolean stopped(String pkg) {
        try {
            return (getPackageManager().getApplicationInfo(pkg, 0).flags & android.content.pm.ApplicationInfo.FLAG_STOPPED) != 0;
        } catch (Exception e) {
            return false;
        }
    }

    String versionName(String pkg) {
        try {
            String v = getPackageManager().getPackageInfo(pkg, 0).versionName;
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }

    /** SHA-256 of an installed app's signing certificate (hex), "" if unknown. */
    String signer(String pkg) {
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                return certSha(pi.signingInfo.getApkContentsSigners());
            }
            return certSha(getPackageManager().getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures);
        } catch (Exception e) {
            return "";
        }
    }

    static String certSha(android.content.pm.Signature[] sigs) throws Exception {
        if (sigs == null || sigs.length != 1) return ""; // one signer expected for all four apps
        byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(sigs[0].toByteArray());
        StringBuilder b = new StringBuilder();
        for (byte x : d) b.append(String.format("%02x", x));
        return b.toString();
    }

    // ── app-first setup: Termux accepts commands? (gates every automatic RUN_COMMAND) ──

    /** True once Termux has run one of our commands (a probe, the dashboard answering, installer DONE). A fresh install
     *  starts false; an update from a build that predates this flag starts true (that phone was set up already). */
    static boolean termuxOk(Context c) {
        android.content.SharedPreferences p = c.getSharedPreferences("hermes", MODE_PRIVATE);
        if (!p.contains("termux_ok")) {
            boolean updated = false;
            try {
                android.content.pm.PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
                updated = pi.firstInstallTime != pi.lastUpdateTime;
            } catch (Exception ignored) {
            }
            p.edit().putBoolean("termux_ok", updated).apply();
            return updated;
        }
        return p.getBoolean("termux_ok", false);
    }

    static void setTermuxOk(Context c) {
        android.content.SharedPreferences p = c.getSharedPreferences("hermes", MODE_PRIVATE);
        if (p.getBoolean("termux_ok", false)) return;
        p.edit().putBoolean("termux_ok", true).apply();
        HermesService.shareKeyAgain(); // the one try at service start was refused (or skipped) on an app-first install
    }

    // ── app-first setup: the probe (what is installed in Termux) ──
    static final String PROBE_ACTION = "com.omarqaterge.hermesmobile.PROBE_RESULT";
    /** Fixed: nothing from the page reaches it. installed = the marker bootstrap writes at DONE. */
    static final String PROBE_SCRIPT = "test -x ~/bin/hermes-services && echo services=yes; test -f ~/.hermes-mobile/installed && echo installed=yes; "
            + "curl -s -m 2 -o /dev/null -w 'dash=%{http_code}' http://127.0.0.1:9119/ 2>/dev/null; true";
    boolean probeReceiverOn = false;
    long probeSentAt = 0;

    void probeAnswer(String json) {
        String js = "window.hermesTermuxProbe && window.hermesTermuxProbe(" + JSONObject.quote(json) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    /** RUN_COMMAND with a result PendingIntent: Termux answers in ~30-200 ms. At most one in flight (10 s).
     *  Not sent until Termux has accepted a command once (termuxOk: installer DONE, the dashboard answering, an earlier
     *  probe): before the installer has set allow-external-apps, Termux refuses it with an error notification
     *  ("RunCommandService requires allow-external-apps") on every return to the app. The answer is then "not-allowed"
     *  without asking, which is what Termux would say. `force` = the user tapped "Already installed? Check". */
    void probeTermux(boolean force) {
        if (!installed("com.termux")) { probeAnswer("{\"result\":\"error\"}"); return; }
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) { probeAnswer("{\"result\":\"denied\"}"); return; }
        if (!force && !termuxOk(this)) { probeAnswer("{\"result\":\"not-allowed\",\"asked\":false}"); return; }
        long now = System.currentTimeMillis();
        if (now - probeSentAt < 10_000) return;
        probeSentAt = now;
        if (!probeReceiverOn) {
            android.content.BroadcastReceiver rx = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent in) {
                    probeSentAt = 0;
                    Bundle b = in.getBundleExtra("result");
                    String out = b == null ? "" : String.valueOf(b.getString("stdout", ""));
                    String errmsg = b == null ? "" : String.valueOf(b.getString("errmsg", ""));
                    int err = b == null ? 1 : b.getInt("err", -1);
                    org.json.JSONObject o = new org.json.JSONObject();
                    try {
                        if (b == null || err > 0 || errmsg.contains("allow-external-apps")) {
                            o.put("result", "not-allowed");
                        } else {
                            o.put("result", "ran");
                            o.put("services", out.contains("services=yes"));
                            o.put("installed", out.contains("installed=yes"));
                            Matcher m = Pattern.compile("dash=(\\d{3})").matcher(out);
                            o.put("dash", m.find() ? Integer.parseInt(m.group(1)) : 0);
                            setTermuxOk(MainActivity.this);
                        }
                    } catch (Exception ignored) {
                    }
                    probeAnswer(o.toString());
                }
            };
            IntentFilter f = new IntentFilter(PROBE_ACTION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(rx, f);
            probeReceiverOn = true;
        }
        try {
            PendingIntent pend = PendingIntent.getBroadcast(this, 4711, new Intent(PROBE_ACTION).setPackage(getPackageName()),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", PROBE_SCRIPT});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            i.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pend);
            startForegroundService(i);
        } catch (SecurityException e) {
            probeSentAt = 0;
            probeAnswer("{\"result\":\"denied\"}");
        } catch (Exception e) {
            probeSentAt = 0;
            probeAnswer("{\"result\":\"error\"}");
        }
    }

    // ── app-first setup: the installer command and its progress ──
    static final String BOOTSTRAP_URL = "https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh";

    /** The bootstrap URL. Emulator test builds only (android/build.sh HM_TEST_BOOTSTRAP_URL): a URL on the emulator's
     *  host (10.0.2.2) serving a working tree. Release builds have no such resource. */
    String bootstrapUrl() {
        try {
            int id = getResources().getIdentifier("hm_test_bootstrap", "string", getPackageName());
            if (id != 0) {
                String u = getString(id);
                if (u.matches("http://10\\.0\\.2\\.2:[0-9]{2,5}/[A-Za-z0-9._/-]+")) return u;
            }
        } catch (Exception ignored) {
        }
        return BOOTSTRAP_URL;
    }

    /** A new one-time token (24 random bytes), registered with the service, and the command on the clipboard. */
    boolean copySetupCommand() {
        byte[] r = new byte[24];
        new java.security.SecureRandom().nextBytes(r);
        StringBuilder t = new StringBuilder();
        for (byte x : r) t.append(String.format("%02x", x));
        HermesService.startSetup(this, t.toString());
        String cmd = "curl -fsSL " + bootstrapUrl() + " -o hm.sh && HM_APP_TOKEN=" + t + " bash hm.sh";
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Hermes installer", cmd);
            if (Build.VERSION.SDK_INT >= 33) {
                android.os.PersistableBundle extras = new android.os.PersistableBundle();
                extras.putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true); // no preview of the token
                clip.getDescription().setExtras(extras);
            }
            cm.setPrimaryClip(clip);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void pushSetupLine(String line) {
        String js = "window.hermesSetupLine && window.hermesSetupLine(" + JSONObject.quote(line) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    // ── app-first setup: the helper apps (fixed sources and signers; the page only names one of four) ──
    static final String FDROID_SIGNER = "228fb2cfe90831c1499ec3ccaf61e96e8e1ce70766b9474672ce427334d41c42";
    static final String SHIZUKU_SIGNER = "268b5590e868fb08bae7e0ac413564cd1ff88f5ccff74af9dbd0dc918e30db30";
    /** Same file as phone/phone-access.sh and tools/setup-phone.sh. */
    static final String SHIZUKU_APK = "https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk";
    static final String HELPER_ACTION = "com.omarqaterge.hermesmobile.HELPER_RESULT";
    boolean helperReceiverOn;
    /** The helper app being installed, from its download until Android's final answer (null = none). Main thread. One
     *  at a time: a second session while the first prompt is open would stack two installers. */
    volatile String helperWhich;
    volatile int helperSession = -1;
    /** Android's "Install" prompt for helperWhich, kept until the final answer, and whether it was put on screen. Android
     *  10+ refuses to open an activity from an app that isn't on screen ("Background activity launch blocked"): when
     *  the prompt arrives while the user is elsewhere (a full-screen installer still showing the previous app, Home), it
     *  waits here and opens when Hermes Mobile comes back (onResume). */
    Intent helperConfirm;
    boolean helperPromptShown;

    void helperFinished() {
        helperWhich = null;
        helperSession = -1;
        helperConfirm = null;
        helperPromptShown = false;
        handler.removeCallbacks(helperPromptCheck);
    }

    void showHelperPrompt() {
        if (helperConfirm == null || helperWhich == null) return;
        try {
            startActivity(new Intent(helperConfirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            helperPromptShown = true;
        } catch (Exception e) {
            String w = helperWhich;
            abandonHelperSession();
            helperFinished();
            helperState(w, "error", 0, "Couldn't open Android's installer.");
        }
    }

    void abandonHelperSession() {
        int id = helperSession;
        if (id < 0) return;
        try {
            getPackageManager().getPackageInstaller().abandonSession(id);
        } catch (Exception ignored) { // already finished or gone
        }
    }

    /** Back in the app with the prompt shown earlier and still no answer: the user left it (Home, another app) or it
     *  closed without telling us. The page offers Retry, which opens the same prompt again. Runs once per return. */
    final Runnable helperPromptCheck = () -> {
        if (foreground && helperWhich != null && helperConfirm != null && helperPromptShown)
            helperState(helperWhich, "prompt", 100, "");
    };

    /** onResume: open a prompt that arrived while the app was in the background, or check on one shown earlier. */
    void resumeHelperInstall() {
        handler.removeCallbacks(helperPromptCheck);
        finishIfInstalled();
        if (helperWhich == null) return;
        if (helperSession >= 0 && helperConfirm == null && !helperDownloading) {
            // committed but no answer at all: if Android dropped the session, nothing is in flight any more
            android.content.pm.PackageInstaller.SessionInfo si = null;
            try {
                si = getPackageManager().getPackageInstaller().getSessionInfo(helperSession);
            } catch (Exception ignored) {
            }
            if (si == null) {
                String w = helperWhich;
                helperFinished();
                if (!installed(helperPackage(w))) helperState(w, "error", 0, "Android didn't finish the install.");
                return;
            }
        }
        if (helperConfirm == null) return;
        if (!helperPromptShown) showHelperPrompt();
        else handler.postDelayed(helperPromptCheck, 4000);
    }

    volatile boolean helperDownloading;
    /** Asked for by the page but not yet started on the main thread: a re-check in between must not call it stopped. */
    volatile String helperRequested;

    /** The helper app still in flight for the page ('' = none). Its package already installed means Android's answer is
     *  only late (it can arrive after onResume when the app was in the background): that one counts as finished. */
    String helperInFlight() {
        String w = helperWhich;
        if (w != null && !(!helperDownloading && installed(helperPackage(w)))) return w;
        String r = helperRequested;
        return r == null ? "" : r;
    }

    /** helperWhich got installed but its result hasn't arrived (yet): let the next one start. Main thread. */
    void finishIfInstalled() {
        if (helperWhich != null && !helperDownloading && installed(helperPackage(helperWhich))) {
            helperFinished();
        }
    }

    static String helperPackage(String which) {
        switch (which == null ? "" : which) {
            case "termux": return "com.termux";
            case "termux-api": return "com.termux.api";
            case "termux-boot": return TERMUX_BOOT;
            case "shizuku": return SHIZUKU;
            default: return null;
        }
    }

    void helperState(String which, String state, int pct, String msg) {
        String js = "window.hermesSetupInstall && window.hermesSetupInstall(" + JSONObject.quote(which) + "," + JSONObject.quote(state) + "," + pct + ","
                + JSONObject.quote(msg == null ? "" : msg) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    static boolean fdroidHost(String h) {
        return h.equals("f-droid.org") || h.endsWith(".f-droid.org");
    }

    static boolean githubHost(String h) {
        return h.equals("github.com") || h.endsWith(".githubusercontent.com") || h.equals("githubusercontent.com");
    }

    /** F-Droid's suggested version of a package (not the newest: that may be a beta). */
    static long fdroidVersion(String pkg) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("https://f-droid.org/api/v1/packages/" + pkg).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("F-Droid didn't answer (HTTP " + c.getResponseCode() + ").");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bo.write(buf, 0, n);
                    if (bo.size() > 256 * 1024) throw new Exception("F-Droid's answer is too large.");
                }
            }
            long v = new JSONObject(bo.toString("UTF-8")).optLong("suggestedVersionCode", 0);
            if (v <= 0) throw new Exception("F-Droid has no version of " + pkg + ".");
            return v;
        } finally {
            c.disconnect();
        }
    }

    void installHelper(final String which) {
        final String pkg = helperPackage(which);
        if (pkg == null) return; // not one of the four: ignored
        if (which.equals(helperRequested)) helperRequested = null;
        if (!getPackageManager().canRequestPackageInstalls()) {
            helperState(which, "permission", 0, "Allow Hermes Mobile to install apps, then come back.");
            runOnUiThread(() -> setupFix("install-permission"));
            return;
        }
        finishIfInstalled();
        if (helperWhich != null) {
            // One at a time. The same app again (the page's Retry): open its prompt again instead of a new download.
            if (helperWhich.equals(which) && helperConfirm != null) showHelperPrompt();
            else helperState(helperWhich, helperDownloading ? "downloading" : "installing", 0, "");
            return;
        }
        helperWhich = which;
        helperDownloading = true;
        new Thread(() -> {
            java.io.File apk = null;
            try {
                boolean shizuku = SHIZUKU.equals(pkg);
                Uri src = Uri.parse(shizuku ? SHIZUKU_APK : "https://f-droid.org/repo/" + pkg + "_" + fdroidVersion(pkg) + ".apk");
                java.io.File dir = new java.io.File(getCacheDir(), "helpers");
                dir.mkdirs();
                apk = new java.io.File(dir, pkg + ".apk");
                helperState(which, "downloading", 0, "");
                final java.io.File out = apk;
                download(src, out, shizuku ? MainActivity::githubHost : MainActivity::fdroidHost, pct -> helperState(which, "downloading", pct, ""));
                // The right app from the right signer, or nothing is installed.
                int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
                android.content.pm.PackageInfo got = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), flags);
                if (got == null || !pkg.equals(got.packageName)) throw new Exception("The download isn't the expected app.");
                String sha = Build.VERSION.SDK_INT >= 28 ? (got.signingInfo == null ? "" : certSha(got.signingInfo.getApkContentsSigners())) : certSha(got.signatures);
                if (!(shizuku ? SHIZUKU_SIGNER : FDROID_SIGNER).equals(sha)) throw new Exception("The download isn't signed by its maker.");
                helperState(which, "installing", 100, "");
                commitHelper(which, pkg, apk);
                helperDownloading = false;
            } catch (Exception e) {
                final String msg = e.getMessage() == null ? "Install failed." : e.getMessage();
                runOnUiThread(() -> {
                    if (which.equals(helperWhich)) {
                        abandonHelperSession();
                        helperFinished();
                    }
                    helperDownloading = false;
                    helperState(which, "error", 0, msg);
                });
            } finally {
                if (apk != null) apk.delete();
            }
        }, "hm-helper").start();
    }

    void commitHelper(String which, String pkg, java.io.File apk) throws Exception {
        if (!helperReceiverOn) {
            android.content.BroadcastReceiver rx = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent in) {
                    String w = in.getStringExtra("which");
                    if (helperPackage(w) == null) return;
                    int st = in.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -1);
                    if (st == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent confirm = in.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (confirm == null || !w.equals(helperWhich)) return;
                        helperConfirm = confirm;
                        helperPromptShown = false;
                        // Only from the screen: Android blocks it from the background, and onResume opens it then.
                        if (foreground) showHelperPrompt();
                    } else if (st == android.content.pm.PackageInstaller.STATUS_SUCCESS) {
                        if (w.equals(helperWhich)) helperFinished();
                        helperState(w, "done", 100, "");
                    } else {
                        if (w.equals(helperWhich)) helperFinished();
                        String m = in.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE);
                        helperState(w, "error", 0, st == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED ? "Cancelled." : (m == null ? "Install failed." : m));
                    }
                }
            };
            IntentFilter f = new IntentFilter(HELPER_ACTION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(rx, f);
            helperReceiverOn = true;
        }
        android.content.pm.PackageInstaller pi = getPackageManager().getPackageInstaller();
        android.content.pm.PackageInstaller.SessionParams params = new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(pkg);
        int id = pi.createSession(params);
        helperSession = id;
        try (android.content.pm.PackageInstaller.Session ses = pi.openSession(id)) {
            try (InputStream in = new java.io.FileInputStream(apk); OutputStream o = ses.openWrite(pkg + ".apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                ses.fsync(o);
            }
            PendingIntent pend = PendingIntent.getBroadcast(this, 5000 + id % 1000, new Intent(HELPER_ACTION).setPackage(getPackageName()).putExtra("which", which),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            ses.commit(pend.getIntentSender());
        }
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
                    startHermesNow(); // the user asked: no gate
                    return;
                case "install-permission":
                    i = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    break;
                case "about-phone":
                    i = new Intent(android.provider.Settings.ACTION_DEVICE_INFO_SETTINGS);
                    break;
                case "dev-options":
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
                    break;
                case "open-termux-boot":
                    i = getPackageManager().getLaunchIntentForPackage(TERMUX_BOOT);
                    if (i == null) i = new Intent().setClassName(TERMUX_BOOT, TERMUX_BOOT + ".BootActivity");
                    break;
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
                case "battery-shizuku":
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + SHIZUKU));
                    break;
                case "app-settings":
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    break;
                case "autostart":
                    openAutostart(getPackageName());
                    return;
                case "autostart-termux":
                    openAutostart("com.termux");
                    return;
                case "open-termux":
                    i = getPackageManager().getLaunchIntentForPackage("com.termux");
                    if (i == null) return;
                    break;
                case "get-termux":
                    i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux/"));
                    break;
                case "replace-termux":
                    // Termux from another source (Play Store, GitHub): Android's own uninstall prompt; the page then installs
                    // F-Droid's set. Never for F-Droid's Termux, never without the user's tap (the page asks first).
                    if (!installed("com.termux") || FDROID_SIGNER.equals(signer("com.termux"))) return;
                    i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:com.termux"));
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
                case "shizuku-pair":
                    // "Shizuku starts by itself" → Set up: Termux pairs its own adb with Wireless debugging (opens Settings
                    // for a few seconds through Shizuku; the script reports back with a shizuku-auto event). User tap only.
                    if (Uninstall.started(this)) return;
                    runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c", KeeperPlan.PAIR_SCRIPT});
                    return;
                case "storage":
                    // Termux asks Android for the files permission ("y": it asks before rebuilding an existing ~/storage).
                    runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c", "echo y | termux-setup-storage"});
                    return;
                case "restart-hermes":
                    // The hermes-services loop starts the dashboard again within ~10 s; a new one sees what Termux may
                    // reach now (e.g. files granted after Hermes started). Exact match, like install.sh; ~/bin/hermes-debian
                    // also knows a chroot-distro Debian, whose root-owned dashboard Termux can't see.
                    runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c",
                            "if [ -x ~/bin/hermes-debian ]; then exec ~/bin/hermes-debian --restart; fi; "
                            + "pids=$(pgrep -f 'hermes dashboard --host 127.0.0.1 --port 9119'); [ -n \"$pids\" ] && kill -9 $pids"});
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


    /** The intent for one of Autostart's pages; an "app" page gets the package it is for. */
    static Intent autostartIntent(Autostart.Page p, String pkg) {
        Intent i = p.cls != null ? new Intent().setClassName(p.pkg, p.cls) : new Intent(p.action);
        if (p.cls == null && p.pkg != null) i.setPackage(p.pkg);
        if ("app".equals(p.kind)) i.putExtra("packageName", pkg).putExtra("package_name", pkg);
        return i;
    }

    /** Android has this page and lets us open it (exported, no permission we lack). A Settings action counts as there. */
    boolean canOpen(Autostart.Page p) {
        if (p.pkg == null) return true;
        try {
            android.content.pm.ResolveInfo ri = getPackageManager().resolveActivity(autostartIntent(p, getPackageName()), PackageManager.MATCH_DEFAULT_ONLY);
            if (ri == null || ri.activityInfo == null || !ri.activityInfo.exported) return false;
            String perm = ri.activityInfo.permission;
            return perm == null || checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    /** The first page of this maker's that opens, or null. */
    Autostart.Page autostartPage(Autostart.Vendor v) {
        for (Autostart.Page p : v.pages) if (canOpen(p)) return p;
        return null;
    }

    /** Open this phone's Autostart page (for pkg, where the page is per app); else pkg's App info page. */
    void openAutostart(String pkg) {
        Autostart.Vendor v = Autostart.vendor(Build.MANUFACTURER, Build.BRAND);
        if (v != null) {
            for (Autostart.Page p : v.pages) {
                if (!canOpen(p)) continue;
                try {
                    startActivity(autostartIntent(p, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    return;
                } catch (Exception ignored) {
                    // listed but refused (SecurityException) or gone: try the next one
                }
            }
        }
        try {
            startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {
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
                + "if " + DEBIAN + " bash -lc '" + hermes + " auth add " + provider + "'; "
                + "then echo; echo 'Signed in. Go back to Hermes Mobile: it shows the login under Subscriptions & accounts.'; "
                + "else echo; echo 'The sign-in did not finish (see the message above). Go back to Hermes Mobile and try again.'; fi; "
                + "read -r -p 'Press Enter to close. ' _";
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
        startUpdateFromIntent(intent);
        if (intent.getBooleanExtra("clearDone", false)) { intent.removeExtra("clearDone"); HermesService.clearDoneChip(); }
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
            if (!cachedToken.isEmpty()) setTermuxOk(this); // the dashboard answers: Termux runs Hermes
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
        if (!safeMediaPath(path)) return plain(400, "Bad Request");
        String range = null;
        if (reqHeaders != null) for (java.util.Map.Entry<String, String> h : reqHeaders.entrySet())
            if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        if (range != null && !range.matches("bytes=\\d*-\\d*")) range = null;
        try {
            return mediaGet(path, range);
        } catch (Exception e) {
            return plain(502, "Bad Gateway");
        }
    }

    /** A file path the page may ask for: absolute, no "..", no NUL. */
    static boolean safeMediaPath(String path) {
        return path != null && path.startsWith("/") && !path.contains("..") && path.indexOf('\0') < 0;
    }

    /** GET a phone file through the plugin's /media (renewing the session token once on 401/403). */
    WebResourceResponse mediaGet(String path, String range) throws Exception {
        String q = "/api/plugins/hermes-mobile/media?path=" + java.net.URLEncoder.encode(path, "UTF-8").replace("+", "%20");
        WebResourceResponse r = streamGet(q, token(false), range);
        if (r.getStatusCode() == 401 || r.getStatusCode() == 403) r = streamGet(q, token(true), range);
        return r;
    }

    /** A whole phone file (same route and checks as media()), or null when it's missing or over maxBytes. */
    byte[] mediaBytes(String path, int maxBytes) {
        if (!safeMediaPath(path)) return null;
        try {
            WebResourceResponse r = mediaGet(path, null);
            try (InputStream in = r.getData()) {
                if (r.getStatusCode() != 200 || in == null) return null;
                ByteArrayOutputStream all = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    all.write(buf, 0, n);
                    if (all.size() > maxBytes) return null;
                }
                return all.toByteArray();
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ── images from the lightbox: Save (Pictures/Hermes) and Share (a copy in cache/share, served by CameraProvider) ──
    static final int MAX_IMAGE = 30 * 1024 * 1024;

    /** The image's bytes: base64 from the page (blob:/data: images) or the phone file at `path`. */
    byte[] imageBytes(String path, String b64) {
        if (b64 != null && !b64.isEmpty()) {
            if (b64.length() > MAX_IMAGE / 3 * 4 + 8) return null;
            try {
                return android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        return mediaBytes(path, MAX_IMAGE);
    }

    /** "jpg", "png", "webp" or "gif" from the file's first bytes, else from the name; null when it isn't one of those. */
    static String imageExt(byte[] b, String name) {
        if (b != null && b.length >= 12) {
            if ((b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "png";
            if ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) return "jpg";
            if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F') return "gif";
            if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "webp";
        }
        String n = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        Matcher m = Pattern.compile("\\.(jpe?g|png|webp|gif)$").matcher(n);
        return m.find() ? (m.group(1).equals("jpeg") ? "jpg" : m.group(1)) : null;
    }

    static String imageMime(String ext) {
        return "jpg".equals(ext) ? "image/jpeg" : "image/" + ext;
    }

    /** A file name safe for the gallery: letters, digits, dot, dash, underscore, space; ends in `ext`. */
    static String imageName(String name, String ext) {
        String base = name == null ? "" : name.replaceAll("[^A-Za-z0-9._ -]", "_").replaceAll("^[. ]+", "");
        base = base.replaceAll("(?i)\\.(jpe?g|png|webp|gif)$", "");
        if (base.length() > 80) base = base.substring(0, 80);
        if (base.trim().isEmpty()) base = "hermes-" + System.currentTimeMillis();
        return base + "." + ext;
    }

    boolean saveImageNow(String name, String path, String b64) {
        byte[] data = imageBytes(path, b64);
        String ext = imageExt(data, name);
        if (data == null || data.length == 0 || ext == null) return false;
        android.content.ContentResolver cr = getContentResolver();
        android.content.ContentValues v = new android.content.ContentValues();
        v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, imageName(name, ext));
        v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, imageMime(ext));
        v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/Hermes");
        v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = cr.insert(android.provider.MediaStore.Images.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (uri == null) return false;
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new java.io.IOException("no stream");
                out.write(data);
            }
            v.clear();
            v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            return true;
        } catch (Exception e) {
            if (uri != null) try { cr.delete(uri, null, null); } catch (Exception ignored) { }
            return false;
        }
    }

    boolean shareImageNow(String name, String path, String b64) {
        byte[] data = imageBytes(path, b64);
        String ext = imageExt(data, name);
        if (data == null || data.length == 0 || ext == null) return false;
        java.io.File dir = CameraProvider.shareDir(this);
        long now = System.currentTimeMillis();
        java.io.File[] old = dir.listFiles();
        if (old != null) for (java.io.File f : old) if (now - f.lastModified() > 3600_000L) f.delete();
        java.io.File f = new java.io.File(dir, "share-" + now + "." + ext);
        try (OutputStream out = new java.io.FileOutputStream(f)) {
            out.write(data);
        } catch (Exception e) {
            return false;
        }
        Uri uri = CameraProvider.uriFor(f);
        Intent send = new Intent(Intent.ACTION_SEND).setType(imageMime(ext)).putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri("image", uri)); // carries the grant through the chooser
        runOnUiThread(() -> {
            try {
                startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        });
        return true;
    }

    /** Runs Save/Share off the page's thread and answers through window.__hmImage(id, ok). */
    void imageJob(int id, java.util.concurrent.Callable<Boolean> job) {
        HTTP_POOL.execute(() -> {
            boolean done;
            try {
                done = job.call();
            } catch (Exception e) {
                done = false;
            }
            final String js = "window.__hmImage && window.__hmImage(" + id + "," + done + ")";
            runOnUiThread(() -> web.evaluateJavascript(js, null));
        });
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

    /** Runs a command in Debian from a Termux shell: ~/bin/hermes-debian knows proot-distro and chroot-distro; an older
     *  install without it is proot-distro. */
    static final String DEBIAN = "$( [ -x ~/bin/hermes-debian ] && echo ~/bin/hermes-debian || echo proot-distro login debian -- )";

    /** Map a path Hermes sees (Debian) to one Termux can open (proot-distro; hermes-debian --open handles both). */
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
        // Back in the app on the chat that was open: it is seen now (no chat switch tells the service that).
        String shown = HermesService.lastShownChat;
        if (shown != null) {
            HermesService.openChat = shown;
            HermesService.seen(shown);
        }
        if (!HermesService.running) HermesService.start(this);
        // Pinned approval popups: the in-app sheet takes over, so none can be left stuck.
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications())
            if (n.getId() == 2 && n.getTag() != null && n.getTag().startsWith("approval:")) nm.cancel(n.getTag(), 2);
        web.evaluateJavascript("window.hermesResume && window.hermesResume()", null);
        resumeHelperInstall();
        showUpdatePrompt();
        setupChanged();
        pushBg();
    }

    /** The setup flow re-checks (a permission dialog or a settings page may have changed something). */
    void setupChanged() {
        if (web != null) web.evaluateJavascript("window.hermesSetupChanged && window.hermesSetupChanged()", null);
    }

    /** Tell the page which app Hermes drives in the background (state without port/token) or null. Any thread. */
    void pushBg() {
        HermesService.BgApp b = HermesService.bgApp;
        final String js = "window.__hmBg && window.__hmBg(" + (b == null ? "null" : b.pageJson()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /** One request to the background host on 127.0.0.1 with the token in a header (never in the URL, never logged). */
    static byte[] bgRequest(HermesService.BgApp b, String method, String path, int[] status) throws Exception {
        try (Socket sock = new Socket()) {
            sock.connect(new InetSocketAddress("127.0.0.1", b.port), 2000);
            sock.setSoTimeout(8000);
            StringBuilder h = new StringBuilder();
            h.append(method).append(' ').append(path).append(" HTTP/1.1\r\nHost: 127.0.0.1:").append(b.port)
             .append("\r\nConnection: close\r\nX-HM-Token: ").append(b.token).append("\r\n");
            if ("POST".equals(method)) h.append("Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
            else h.append("\r\n");
            OutputStream out = sock.getOutputStream();
            out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            InputStream in = new BufferedInputStream(sock.getInputStream());
            ByteArrayOutputStream all = new ByteArrayOutputStream();
            byte[] buf = new byte[32768];
            int r;
            while ((r = in.read(buf)) > 0) {
                all.write(buf, 0, r);
                if (all.size() > 4_000_000) throw new Exception("response too large");
            }
            byte[] data = all.toByteArray();
            int sep = -1;
            for (int k = 0; k + 3 < data.length; k++)
                if (data[k] == 13 && data[k + 1] == 10 && data[k + 2] == 13 && data[k + 3] == 10) { sep = k; break; }
            if (sep < 0) throw new Exception("bad response");
            String head = new String(data, 0, sep, StandardCharsets.ISO_8859_1);
            String[] parts = head.split(" ", 3);
            status[0] = parts.length > 1 ? Integer.parseInt(parts[1].trim()) : 502;
            byte[] rest = java.util.Arrays.copyOfRange(data, sep + 4, data.length);
            if (head.toLowerCase().contains("transfer-encoding: chunked")) rest = dechunk(rest);
            return rest;
        }
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
        HermesService.openChat = null; // nothing is on screen any more: a chat finishing now counts as unseen
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
    /** The update's "Install" prompt, waiting for the app to be on screen (main thread). */
    Intent updateConfirm;

    void showUpdatePrompt() {
        Intent i = updateConfirm;
        updateConfirm = null;
        if (i == null) return;
        try {
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            updateState("error", 0, "Couldn't open the installer.");
        }
    }

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

    /** The "update available" notification carries the release APK URL; startUpdate re-checks that it is official. */
    void startUpdateFromIntent(Intent in) {
        String url = in == null ? null : in.getStringExtra("updateUrl");
        if (url == null) return;
        in.removeExtra("updateUrl");
        startUpdate(url);
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
                download(u, apk, MainActivity::githubHost, pct -> updateState("downloading", pct, ""));
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

    /** https download with a redirect host allowlist and a 150 MB cap; pct gets the progress (0-100). */
    void download(Uri start, java.io.File out, java.util.function.Predicate<String> hostOk, java.util.function.IntConsumer pct) throws Exception {
        URL url = new URL(start.toString());
        if (!"https".equals(url.getProtocol()) || !hostOk.test(url.getHost())) throw new Exception("Download failed (unexpected host).");
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
                if (!"https".equals(next.getProtocol()) || !hostOk.test(h))
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
                    int p = total > 0 ? (int) (done * 100 / total) : 0;
                    if (p != lastPct) { lastPct = p; pct.accept(p); }
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
                            // Android blocks opening it from the background: the user left during the download, so it
                            // opens when the app is back on screen (onResume).
                            updateConfirm = confirm;
                            if (foreground) showUpdatePrompt();
                        }
                    } else if (st != android.content.pm.PackageInstaller.STATUS_SUCCESS) {
                        updateConfirm = null;
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

        /** The in-app player's pause / play, shared with the "Reading aloud" card: play | pause | toggle | rew | ff | stop. */
        @JavascriptInterface
        public void ttsControl(String key, String cmd) {
            if (!ok(key)) return;
            if (cmd == null || !cmd.matches("play|pause|toggle|rew|ff|stop")) return;
            Voice.control(cmd);
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
                long t0 = android.os.SystemClock.uptimeMillis();
                bootLog("token-start");
                String t = token(true);
                bootLog("token-end " + (android.os.SystemClock.uptimeMillis() - t0) + "ms" + (t == null || t.isEmpty() ? " (none)" : ""));
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

        /** The background app's state (no port/token) as JSON, or "" when none. */
        @JavascriptInterface
        public String bgState(String key) {
            if (!ok(key)) return "";
            HermesService.BgApp b = HermesService.bgApp;
            return b == null ? "" : b.pageJson();
        }

        /** The latest frame of the hidden display as window.__hmBgFrame(id, "data:image/jpeg;base64,…"), "" on none/error. */
        @JavascriptInterface
        public void bgFrameAsync(String key, final int id, final int maxW) {
            if (!ok(key)) return;
            final HermesService.BgApp b = HermesService.bgApp;
            HTTP_POOL.execute(() -> {
                String data = "";
                try {
                    if (b != null) {
                        int[] st = new int[1];
                        byte[] img = bgRequest(b, "GET", "/frame?w=" + Math.max(120, Math.min(maxW, 1080)), st);
                        if (st[0] == 200 && img.length > 0) data = "data:image/jpeg;base64," + android.util.Base64.encodeToString(img, android.util.Base64.NO_WRAP);
                    }
                } catch (Exception ignored) {
                }
                final String js = "window.__hmBgFrame && window.__hmBgFrame(" + id + "," + JSONObject.quote(data) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            });
        }

        /** "stop" closes the hidden display, "take_over" moves the app to the real screen. Returns "ok" at once or "error: …". */
        @JavascriptInterface
        public String bgAction(String key, String what) {
            if (!ok(key)) return "error: denied";
            final String path = "stop".equals(what) ? "/close" : "take_over".equals(what) ? "/hand_over" : null;
            if (path == null) return "error: unknown action";
            final HermesService.BgApp b = HermesService.bgApp;
            if (b == null) return "error: no background app";
            HTTP_POOL.execute(() -> {
                try {
                    int[] st = new int[1];
                    bgRequest(b, "POST", path, st);
                    if (st[0] != 200) return;
                } catch (Exception ignored) {
                    return; // the host did not answer: keep the card, the plugin's "done" clears it
                }
                HermesService s = HermesService.instance;
                if (s != null) s.main.post(() -> s.setBgApp(null));
            });
            return "ok";
        }

        @JavascriptInterface
        public void openFile(String key, String path) {
            if (!ok(key)) return;
            if (path == null || !path.startsWith("/") || path.contains("..") || path.indexOf('\0') >= 0) return;
            // "$1"/"$2" are arguments, never part of the script, so the path can't run anything.
            runTermux("/data/data/com.termux/files/usr/bin/bash", new String[]{"-c",
                    "if [ -x ~/bin/hermes-debian ]; then exec ~/bin/hermes-debian --open \"$1\"; fi; exec termux-open \"$2\"",
                    "hm-open", path, hostPath(path)});
        }

        @JavascriptInterface
        public void saveImage(String key, int id, String name, String path, String b64) {
            if (!ok(key)) return;
            imageJob(id, () -> saveImageNow(name, path, b64));
        }

        @JavascriptInterface
        public void shareImage(String key, int id, String name, String path, String b64) {
            if (!ok(key)) return;
            imageJob(id, () -> shareImageNow(name, path, b64));
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

        /** The page opened this chat: it is on screen (no sticky Done for it) and no longer unseen. */
        @JavascriptInterface
        public void chatSeen(String key, String id) {
            if (!ok(key)) return;
            if (id == null || id.isEmpty()) { // the new-chat screen: no chat on screen
                HermesService.openChat = null;
                HermesService.lastShownChat = null;
                return;
            }
            if (id.length() > 200 || !id.matches("[A-Za-z0-9_.:-]*")) return;
            HermesService.openChat = id;
            HermesService.lastShownChat = id;
            HermesService.seen(id);
        }

        /** The page's unread chats for one profile, [{id,title}] (≤ 500). */
        @JavascriptInterface
        public void setUnseen(String key, String profile, String json) {
            if (!ok(key)) return;
            if (profile == null || profile.length() > 100 || json == null || json.length() > 200_000) return;
            try {
                org.json.JSONArray src = new org.json.JSONArray(json);
                org.json.JSONArray rows = new org.json.JSONArray();
                for (int k = 0; k < src.length() && rows.length() < 500; k++) {
                    org.json.JSONObject o = src.optJSONObject(k);
                    if (o == null) continue;
                    String id = o.optString("id", "");
                    if (id.isEmpty() || id.length() > 200 || !id.matches("[A-Za-z0-9_.:-]*")) continue;
                    String t = o.optString("title", "");
                    rows.put(new org.json.JSONObject().put("id", id).put("title", t.length() > 200 ? t.substring(0, 200) : t));
                }
                HermesService.replaceUnseen(profile, rows);
            } catch (Exception ignored) {
            }
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

        /** App-first setup: install one of four helper apps (anything else is ignored); status via window.hermesSetupInstall. */
        @JavascriptInterface
        public void installHelperApp(String key, final String which) {
            if (!ok(key) || helperPackage(which) == null) return;
            helperRequested = which;
            runOnUiThread(() -> MainActivity.this.installHelper(which));
        }

        /** App-first setup: ask Termux what is installed (fixed script); answer via window.hermesTermuxProbe. */
        @JavascriptInterface
        public void probeTermux(String key) {
            if (!ok(key)) return;
            runOnUiThread(() -> MainActivity.this.probeTermux(false));
        }

        /** The user asked: really send the probe, even before Termux has accepted a command (may show Termux's error). */
        @JavascriptInterface
        public void probeTermuxNow(String key) {
            if (!ok(key)) return;
            runOnUiThread(() -> MainActivity.this.probeTermux(true));
        }

        /** App-first setup: copy the installer command with a new one-time progress token. The page never sees it. */
        @JavascriptInterface
        public boolean setupCommand(String key) {
            if (!ok(key)) return false;
            return MainActivity.this.copySetupCommand();
        }

        /** Settings → Uninstall Hermes: run phone/uninstall.sh in Termux (fixed flags + the app's settings JSON). */
        @JavascriptInterface
        public String uninstallStart(String key, boolean backup, boolean keys, String settings) {
            if (!ok(key)) return "error";
            return Uninstall.run(MainActivity.this, backup, keys, settings);
        }

        /** {started, running, removed, result}; a finished cleanup also calls window.hermesUninstallDone(). */
        @JavascriptInterface
        public String uninstallState(String key) {
            if (!ok(key)) return "";
            return Uninstall.state(MainActivity.this);
        }

        /** Android's uninstall prompt for termux-api, termux-boot, shizuku, termux or self (nothing else). */
        @JavascriptInterface
        public boolean uninstallApp(String key, String which) {
            if (!ok(key)) return false;
            return Uninstall.uninstallApp(MainActivity.this, which);
        }

        /** App-first setup: the installer's progress so far ({active, lines, done, fail}). */
        @JavascriptInterface
        public String setupProgress(String key) {
            if (!ok(key)) return "";
            return HermesService.setup(MainActivity.this).json();
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
