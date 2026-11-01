package com.omarqaterge.hermesmobile.bg;

import android.app.Application;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.AttributionSource;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.SparseArray;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction;
import android.view.accessibility.AccessibilityWindowInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Background host: runs as the SHELL user (started by the Hermes plugin through Shizuku's rish:
 * {@code HM_TOKEN=… CLASSPATH=<this apk> app_process / com.omarqaterge.hermesmobile.bg.BgHost <port>}), never inside the
 * app. It owns one hidden virtual display, launches an app on it and lets Hermes read and drive that app while the
 * owner keeps using the real screen. Uses no app classes, resources or Context.
 *
 * Safety: listens on 127.0.0.1 only, every request needs the X-HM-Token header, a fixed command set (no shell
 * passthrough). Battery: exits after IDLE_MS without a request or MAX_MS in total, and releases the display on every
 * exit path. Requires Android 14 (VIRTUAL_DISPLAY_FLAG_STEAL_TOP_FOCUS_DISABLED keeps focus on the owner's screen).
 */
@android.annotation.TargetApi(34) // main() exits below Android 14, so every call here may assume it
public final class BgHost {
    static final long IDLE_MS = 120_000, MAX_MS = 30 * 60_000;
    static final int W = 720, H = 1600, DPI = 320, MAX_ELEMENTS = 300;
    /** settle(): the screen counts as done QUIET_MS after its last change, or NO_CHANGE_MS after an action that changed
     *  nothing, and never later than SETTLE_MAX_MS. */
    static final long QUIET_MS = 200, NO_CHANGE_MS = 500, SETTLE_MAX_MS = 1500;

    // DisplayManager.VIRTUAL_DISPLAY_FLAG_* (hidden ones by value)
    static final int FLAGS = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            | (1 << 6) /* SUPPORTS_TOUCH */ | (1 << 7) /* ROTATES_WITH_CONTENT */ | (1 << 8) /* DESTROY_CONTENT_ON_REMOVAL */
            | (1 << 10) /* TRUSTED */ | (1 << 11) /* OWN_DISPLAY_GROUP */ | (1 << 12) /* ALWAYS_UNLOCKED */
            | (1 << 13) /* TOUCH_FEEDBACK_DISABLED */ | (1 << 14) /* OWN_FOCUS */ | (1 << 16) /* STEAL_TOP_FOCUS_DISABLED */;

    /** Intent actions open() accepts from the android.* namespace (an app's own actions only reach that app): ones that
     *  show a screen. No CALL, DELETE, INSTALL or anything else that acts without one. */
    static final Set<String> SAFE_ACTIONS = new HashSet<>(Arrays.asList(Intent.ACTION_VIEW, Intent.ACTION_SEND,
            Intent.ACTION_SENDTO, Intent.ACTION_INSERT, Intent.ACTION_EDIT, Intent.ACTION_SEARCH, Intent.ACTION_WEB_SEARCH,
            Intent.ACTION_DIAL, Intent.ACTION_MAIN, "android.intent.action.SET_ALARM", "android.intent.action.SET_TIMER",
            "android.intent.action.SHOW_ALARMS", "android.intent.action.SHOW_TIMERS"));

    static Context ctx;
    static String token;
    static VirtualDisplay vd;
    static ImageReader reader;
    static Image last;
    static byte[] jpg; static int jpgW; static long jpgTs = -1; // frame()'s last picture, sent again while nothing changed
    static int displayId = -1;
    static String pkg = "";
    static UiAutomation ua;
    static HandlerThread uaThread;
    static volatile long lastChange = 0; // uptime of the last screen event from the hidden display
    static Scan shown = new Scan();      // the last capture: element numbers refer to it
    static int extraFlags = 0; // test hook: HM_BG_FLAGS env adds/removes nothing by default

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9131;
        token = System.getenv("HM_TOKEN");
        if (token == null || token.length() < 16) { System.out.println("HM_TOKEN missing"); System.exit(2); }
        String ef = System.getenv("HM_BG_FLAGS");
        if (ef != null && !ef.isEmpty()) extraFlags = Integer.parseInt(ef);
        if (android.os.Build.VERSION.SDK_INT < 34) { System.out.println("needs Android 14+"); System.exit(3); }
        detachFromRish();
        Looper.prepareMainLooper();
        ctx = shellContext();
        Runtime.getRuntime().addShutdownHook(new Thread(BgHost::release));

        ServerSocket ss = new ServerSocket(port, 4, InetAddress.getByName("127.0.0.1"));
        ss.setSoTimeout(1000);
        long start = SystemClock.elapsedRealtime(), lastReq = start;
        System.out.println("LISTENING " + port);
        System.out.flush();
        boolean quit = false;
        while (!quit) {
            long now = SystemClock.elapsedRealtime();
            if (now - lastReq > IDLE_MS || now - start > MAX_MS) { System.out.println("timeout"); break; }
            Socket s;
            try { s = ss.accept(); } catch (SocketTimeoutException e) { continue; }
            lastReq = SystemClock.elapsedRealtime();
            try (Socket so = s) {
                so.setSoTimeout(15_000);
                quit = handle(so);
                if (quit) System.out.println("quit by request");
            } catch (Throwable t) { System.out.println("request failed: " + t); }
        }
        release();
        System.out.println("EXIT");
        System.exit(0);
    }

    /**
     * Shizuku hands the rish shell's pipes down to every child (as high fd numbers), and rish only returns once they are
     * all closed. Close inherited pipes above fd 20 (ART's own are low) so the starter returns while the host runs.
     */
    static void detachFromRish() {
        java.io.File[] fds = new java.io.File("/proc/self/fd").listFiles();
        if (fds == null) return;
        for (java.io.File f : fds) {
            try {
                int n = Integer.parseInt(f.getName());
                if (n <= 20) continue;
                String link = android.system.Os.readlink(f.getPath());
                if (!link.startsWith("pipe:")) continue;
                java.io.FileDescriptor fd = new java.io.FileDescriptor();
                java.io.FileDescriptor.class.getMethod("setInt$", int.class).invoke(fd, n);
                android.system.Os.close(fd);
            } catch (Throwable ignored) {}
        }
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    /** Returns true when the host should exit. */
    static boolean handle(Socket so) throws Exception {
        InputStream in = so.getInputStream();
        String reqLine = readLine(in);
        if (reqLine == null) return false;
        String[] rl = reqLine.split(" ");
        System.out.println("req " + rl[0] + " " + (rl.length > 1 ? rl[1].split("\\?")[0] : ""));
        String method = rl[0], target = rl.length > 1 ? rl[1] : "/";
        int len = 0; String tok = "";
        for (String h; (h = readLine(in)) != null && !h.isEmpty(); ) {
            int c = h.indexOf(':'); if (c < 0) continue;
            String k = h.substring(0, c).trim().toLowerCase(Locale.ROOT), v = h.substring(c + 1).trim();
            if (k.equals("content-length")) len = Math.min(Integer.parseInt(v), 1 << 20);
            else if (k.equals("x-hm-token")) tok = v;
        }
        byte[] body = new byte[len];
        for (int r = 0; r < len; ) { int n = in.read(body, r, len - r); if (n < 0) break; r += n; }
        OutputStream out = so.getOutputStream();
        if (!MessageDigest.isEqual(tok.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
            send(out, 403, "application/json", "{\"ok\":false,\"error\":\"forbidden\"}".getBytes(StandardCharsets.UTF_8));
            return false;
        }
        String path = target, query = "";
        int q = target.indexOf('?'); if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
        if (path.equals("/frame")) {
            int w = 540;
            for (String p : query.split("&")) if (p.startsWith("w=")) try { w = Integer.parseInt(p.substring(2)); } catch (Exception ignored) {}
            byte[] jpg = frame(Math.max(120, Math.min(w, W)));
            if (jpg == null) send(out, 204, "text/plain", new byte[0]); else send(out, 200, "image/jpeg", jpg);
            return false;
        }
        JSONObject a = len > 0 ? new JSONObject(new String(body, StandardCharsets.UTF_8)) : new JSONObject();
        JSONObject r;
        boolean quit = false;
        try {
            switch (path) {
                case "/status": r = status(); break;
                case "/apps": r = apps(); break;
                case "/resolve": r = resolve(a.getJSONObject("intent"), a.optString("pkg", "")); break;
                case "/open": r = open(a.getString("pkg"), a.optJSONObject("intent")); break;
                case "/capture": r = capture(a.optBoolean("tree", true), a.optBoolean("image", false), a.optBoolean("marks", false), a.optInt("max_w", W)); break;
                case "/tap": r = tap(a, false); break;
                case "/long_press": r = tap(a, true); break;
                case "/swipe": r = swipeReq(a); break;
                case "/set_text": r = setText(a); break;
                case "/type": r = type(a.getString("text")); break;
                case "/key": r = key(a.getString("name")); break;
                case "/submit": r = submit(a); break;
                case "/toggle": r = toggle(a); break;
                case "/scroll": r = scroll(a); break;
                case "/scroll_to": r = scrollTo(a); break;
                case "/wait_for": r = waitFor(a); break;
                case "/hand_over": r = handOver(); quit = true; break;
                case "/close": r = ok(); quit = true; break;
                default: send(out, 404, "application/json", "{\"ok\":false,\"error\":\"not found\"}".getBytes(StandardCharsets.UTF_8)); return false;
            }
        } catch (IllegalArgumentException t) { // our own messages for the model ("element 4 has changed…")
            r = err(t.getMessage());
        } catch (Throwable t) {
            r = err(t.getClass().getSimpleName() + ": " + t.getMessage());
        }
        send(out, 200, "application/json", r.toString().getBytes(StandardCharsets.UTF_8));
        return quit;
    }

    static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        boolean any = false;
        for (int c; (c = in.read()) >= 0; ) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) break;
        }
        return any ? b.toString("UTF-8") : null;
    }

    static void send(OutputStream out, int code, String type, byte[] body) throws Exception {
        String head = "HTTP/1.0 " + code + (code == 200 ? " OK" : " X") + "\r\nContent-Type: " + type
                + "\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    static JSONObject ok() throws Exception { return new JSONObject().put("ok", true); }
    static JSONObject err(String m) { try { return new JSONObject().put("ok", false).put("error", m); } catch (Exception e) { return new JSONObject(); } }

    // ── shell context (the scrcpy way: a system context that reports the shell package) ─────────────────────

    static final class ShellCtx extends ContextWrapper {
        ShellCtx(Context base) { super(base); }
        @Override public String getPackageName() { return "com.android.shell"; }
        @Override public String getOpPackageName() { return "com.android.shell"; }
        @Override public AttributionSource getAttributionSource() {
            return new AttributionSource.Builder(2000).setPackageName("com.android.shell").build();
        }
        @Override public Context getApplicationContext() { return this; }
    }

    static Context shellContext() throws Exception {
        Class<?> atc = Class.forName("android.app.ActivityThread");
        Constructor<?> c = atc.getDeclaredConstructor(); c.setAccessible(true);
        Object at = c.newInstance();
        Field f = atc.getDeclaredField("sCurrentActivityThread"); f.setAccessible(true); f.set(null, at);
        f = atc.getDeclaredField("mSystemThread"); f.setAccessible(true); f.setBoolean(at, true);
        try {
            Class<?> cc = Class.forName("android.app.ConfigurationController");
            Constructor<?> k = cc.getDeclaredConstructor(Class.forName("android.app.ActivityThreadInternal")); k.setAccessible(true);
            f = atc.getDeclaredField("mConfigurationController"); f.setAccessible(true); f.set(at, k.newInstance(at));
        } catch (Throwable ignored) {}
        Context sys = (Context) atc.getDeclaredMethod("getSystemContext").invoke(at);
        Context sc = new ShellCtx(sys);
        try {
            Application app = Instrumentation.newApplication(Application.class, sc);
            f = atc.getDeclaredField("mInitialApplication"); f.setAccessible(true); f.set(at, app);
        } catch (Throwable ignored) {}
        return sc;
    }

    static Object service(String name, String iface) throws Exception {
        Object b = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, name);
        return Class.forName(iface + "$Stub").getMethod("asInterface", android.os.IBinder.class).invoke(null, b);
    }

    static Object atm() throws Exception {
        return Class.forName("android.app.ActivityTaskManager").getMethod("getService").invoke(null);
    }

    // ── display + app ────────────────────────────────────────────────────────────────────────────────────

    static void ensureDisplay() throws Exception {
        if (vd != null) return;
        reader = ImageReader.newInstance(W, H, PixelFormat.RGBA_8888, 2);
        Constructor<DisplayManager> dmc = DisplayManager.class.getDeclaredConstructor(Context.class);
        dmc.setAccessible(true);
        DisplayManager dm = dmc.newInstance(ctx);
        vd = dm.createVirtualDisplay("hermes-bg", W, H, DPI, reader.getSurface(), FLAGS ^ extraFlags);
        displayId = vd.getDisplay().getDisplayId();
        try { // No keyboard on the hidden display: text goes in through accessibility (set_text) or key events, so a
              // keyboard would only cost drawing and cover half the app. DISPLAY_IME_POLICY_HIDE = 2; if a build refuses
              // it, LOCAL = 0 at least keeps the keyboard off the owner's screen.
            Object wm = service("window", "android.view.IWindowManager");
            Method m = wm.getClass().getMethod("setDisplayImePolicy", int.class, int.class);
            try { m.invoke(wm, displayId, 2); } catch (Throwable t) { System.out.println("ime hide: " + t); m.invoke(wm, displayId, 0); }
        } catch (Throwable t) { System.out.println("ime policy: " + t); }
        System.out.println("DISPLAY " + displayId);
    }

    static synchronized void release() {
        try { if (ua != null) { Method m = UiAutomation.class.getDeclaredMethod("disconnect"); m.setAccessible(true); m.invoke(ua); } } catch (Throwable ignored) {}
        ua = null;
        if (uaThread != null) { uaThread.quitSafely(); uaThread = null; }
        if (last != null) { last.close(); last = null; }
        jpg = null; jpgTs = -1;
        if (vd != null) { vd.release(); vd = null; System.out.println("RELEASED " + displayId); }
        if (reader != null) { reader.close(); reader = null; }
    }

    static JSONObject status() throws Exception {
        return ok().put("display", displayId).put("pkg", pkg).put("sdk", android.os.Build.VERSION.SDK_INT);
    }

    static JSONObject apps() throws Exception {
        PackageManager pm = ctx.getPackageManager();
        Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
            String p = ri.activityInfo.packageName;
            if (!seen.add(p)) continue;
            out.put(new JSONObject().put("pkg", p).put("label", String.valueOf(ri.loadLabel(pm))));
        }
        return ok().put("apps", out);
    }

    static String appLabel(String p) {
        PackageManager pm = ctx.getPackageManager();
        try { return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(p, 0))); } catch (Throwable t) { return p; }
    }

    /** An intent from the model: {action (default VIEW), data, type, extras}. Only SAFE_ACTIONS, android.settings.*
     *  pages or an app's own actions; no file:, intent: or javascript: links. */
    static Intent buildIntent(JSONObject j) throws Exception {
        String act = j.optString("action", "");
        if (act.isEmpty()) act = Intent.ACTION_VIEW;
        if (act.startsWith("android.") && !SAFE_ACTIONS.contains(act) && !act.startsWith("android.settings."))
            throw new IllegalArgumentException("the intent action " + act + " isn't allowed here");
        Intent it = new Intent(act);
        String data = j.optString("data", ""), type = j.optString("type", "");
        if (!data.isEmpty()) {
            Uri u = Uri.parse(data);
            String sch = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (sch.isEmpty() || sch.equals("file") || sch.equals("intent") || sch.equals("javascript") || sch.equals("android-app"))
                throw new IllegalArgumentException("links like " + (sch.isEmpty() ? data : sch + ":") + " can't be opened here");
            if (type.isEmpty()) it.setData(u); else it.setDataAndType(u, type);
        } else if (!type.isEmpty()) it.setType(type);
        JSONObject ex = j.optJSONObject("extras");
        if (ex != null) for (Iterator<String> ks = ex.keys(); ks.hasNext(); ) {
            String k = ks.next(); Object v = ex.get(k);
            if (v instanceof String) it.putExtra(k, (String) v);
            else if (v instanceof Boolean) it.putExtra(k, (boolean) (Boolean) v);
            else if (v instanceof Integer) it.putExtra(k, (int) (Integer) v);
            else if (v instanceof Long) it.putExtra(k, (long) (Long) v);
            else if (v instanceof Number) it.putExtra(k, ((Number) v).doubleValue());
            else throw new IllegalArgumentException("the extra " + k + " must be text, a number or true/false");
        }
        return it;
    }

    /** Which app an intent opens (in package p when given). Several candidates are an error that names them. */
    static JSONObject resolve(JSONObject j, String p) throws Exception {
        Intent it = buildIntent(j);
        if (!p.isEmpty()) it.setPackage(p);
        Set<String> pkgs = new LinkedHashSet<>();
        for (ResolveInfo ri : ctx.getPackageManager().queryIntentActivities(it, PackageManager.MATCH_DEFAULT_ONLY))
            pkgs.add(ri.activityInfo.packageName);
        if (pkgs.isEmpty()) return err(p.isEmpty() ? "no app on the phone can open this" : appLabel(p) + " can't open this");
        if (pkgs.size() > 1) {
            StringBuilder sb = new StringBuilder("several apps can open this; say which with app: ");
            int i = 0;
            for (String c : pkgs) {
                if (i++ == 8) break;
                sb.append(i > 1 ? ", " : "").append(appLabel(c)).append(" (").append(c).append(')');
            }
            return err(sb.toString());
        }
        String only = pkgs.iterator().next();
        return ok().put("pkg", only).put("label", appLabel(only));
    }

    /** The package of the app the user is looking at (top task of display 0), or "" if unknown. */
    static String ownerForeground() {
        try { // public-ish API first: works the same on every vendor build
            Object atm = atm();
            List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, 0);
            for (Object info : infos) {
                if (!info.getClass().getField("visible").getBoolean(info)) continue;
                Object cn = info.getClass().getField("topActivity").get(info);
                if (cn instanceof ComponentName) return ((ComponentName) cn).getPackageName();
            }
        } catch (Throwable t) { System.out.println("ownerForeground: " + t); }
        try { // fallback: dumpsys text (format differs between versions/vendors, so only a fallback)
            String d = exec("dumpsys", "window", "displays");
            int i = d.indexOf("Display: mDisplayId=0");
            if (i < 0) return "";
            int j = d.indexOf("Display: mDisplayId=", i + 10);
            String sec = j > 0 ? d.substring(i, j) : d.substring(i);
            int k = sec.indexOf("mFocusedApp=ActivityRecord{");
            if (k < 0) return "";
            String[] parts = sec.substring(k, sec.indexOf('}', k)).split(" ");
            for (String p : parts) if (p.contains("/")) return p.substring(0, p.indexOf('/'));
        } catch (Throwable ignored) {}
        return "";
    }

    /**
     * Start the app on the hidden display. IActivityTaskManager.startActivity's parameter list changes between Android
     * versions and some vendors add overloads, so fall back to `am start --display` (also shell) when it isn't the
     * 11-argument form we know.
     */
    static String launch(Intent it) throws Exception {
        android.app.ActivityOptions o = android.app.ActivityOptions.makeBasic().setLaunchDisplayId(displayId);
        try {
            Object atm = atm();
            for (Method m : atm.getClass().getMethods()) {
                Class<?>[] t = m.getParameterTypes();
                if (!m.getName().equals("startActivity") || t.length != 11 || t[3] != Intent.class || t[10] != Bundle.class) continue;
                int res = (Integer) m.invoke(atm, null, "com.android.shell", null, it, null, null, null, 0, 0, null, o.toBundle());
                return res >= 0 ? "" : "launch failed (" + res + ")";
            }
        } catch (Throwable t) { System.out.println("startActivity: " + t + " -> am start"); }
        ComponentName cn = it.getComponent();
        if (cn == null) return "no launch activity";
        List<String> cmd = new ArrayList<>(Arrays.asList("am", "start", "--display", String.valueOf(displayId), "-f", String.valueOf(it.getFlags())));
        if (it.getAction() != null) { cmd.add("-a"); cmd.add(it.getAction()); }
        if (it.getDataString() != null) { cmd.add("-d"); cmd.add(it.getDataString()); }
        if (it.getType() != null) { cmd.add("-t"); cmd.add(it.getType()); }
        Bundle ex = it.getExtras();
        if (ex != null) for (String k : ex.keySet()) {
            Object v = ex.get(k);
            cmd.add(v instanceof Boolean ? "--ez" : v instanceof Integer ? "--ei" : v instanceof Long ? "--el" : v instanceof Double ? "--ed" : "--es");
            cmd.add(k);
            cmd.add(String.valueOf(v));
        }
        cmd.add("-n"); cmd.add(cn.flattenToShortString());
        String out = exec(cmd.toArray(new String[0]));
        return out.contains("Error") ? out.trim() : "";
    }

    /** Open app p on the hidden display: its first screen, or the screen an intent leads to (a link, a share…). */
    static JSONObject open(String p, JSONObject intent) throws Exception {
        if (p == null || !p.matches("[A-Za-z0-9_.]+")) return err("bad package name");
        PackageManager pm = ctx.getPackageManager();
        Intent it;
        if (intent != null) {
            it = buildIntent(intent);
            it.setPackage(p);
            ResolveInfo ri = pm.resolveActivity(it, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri == null) return err(appLabel(p) + " can't open this");
            it.setComponent(new ComponentName(p, ri.activityInfo.name));
        } else {
            it = pm.getLaunchIntentForPackage(p);
            if (it == null) return err("no launchable app " + p);
            it.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        }
        if (p.equals(ownerForeground())) return err("the user has " + p + " open on the screen right now; ask them before taking it");
        String label = appLabel(p);
        ensureDisplay();
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String failed = launch(it);
        if (!failed.isEmpty()) return err(failed);
        pkg = p;
        // Wait (bounded) until the app shows something readable: slow starters (browsers, first-run screens) have a
        // window long before they have content.
        long end = SystemClock.elapsedRealtime() + 10000;
        while (SystemClock.elapsedRealtime() < end) {
            if (hasContent()) break;
            SystemClock.sleep(250);
        }
        settle();
        String top = topPackage();
        if (!top.isEmpty() && !top.equals(p)) {
            // Usually the phone's own app lock (each vendor has one) or a sign-in/permission screen of another package.
            String why = "another app (" + top + ") opened instead of " + label + ": most likely the phone's app lock or a "
                    + "sign-in screen. The user has to open " + label + " once themselves, or take it out of the app lock.";
            release();
            pkg = "";
            return err(why);
        }
        return ok().put("display", displayId).put("label", label).put("pkg", p);
    }

    /** True once a window on the hidden display shows text, or anything but a bare scroll container. */
    static boolean hasContent() {
        try {
            JSONArray els = scan().els;
            for (int i = 0; i < els.length(); i++) {
                JSONObject e = els.getJSONObject(i);
                String role = e.optString("role");
                if (e.has("text") || !(role.equals("list") || role.equals("pager"))) return true;
            }
        } catch (Throwable ignored) {}
        return false;
    }

    /** The top activity on the hidden display, or null. */
    static ComponentName topComponent() {
        try {
            Object atm = atm();
            List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, displayId);
            for (Object info : infos) {
                Object cn = info.getClass().getField("topActivity").get(info);
                if (cn instanceof ComponentName) return (ComponentName) cn;
            }
        } catch (Throwable t) { System.out.println("topComponent: " + t); }
        return null;
    }

    /** Package of the top activity on the hidden display, or "" if none/unknown. */
    static String topPackage() {
        ComponentName cn = topComponent();
        return cn == null ? "" : cn.getPackageName();
    }

    /** The top activity's class name without its package ("EditNoteActivity"): which screen of the app this is. */
    static String screenName() {
        ComponentName cn = topComponent();
        if (cn == null) return "";
        String c = cn.getClassName();
        return c.substring(c.lastIndexOf('.') + 1);
    }

    static JSONObject handOver() throws Exception {
        if (vd == null) return err("no app open");
        Object atm = atm();
        List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, displayId);
        if (infos.isEmpty()) return gone();
        int moved = 0;
        for (Object info : infos) {
            int taskId = info.getClass().getField("taskId").getInt(info);
            atm.getClass().getMethod("moveRootTaskToDisplay", int.class, int.class).invoke(atm, taskId, 0);
            moved++;
        }
        try { atm.getClass().getMethod("focusTopTask", int.class).invoke(atm, 0); } catch (Throwable ignored) {}
        return ok().put("moved", moved);
    }

    // ── frames ───────────────────────────────────────────────────────────────────────────────────────────

    /** The newest picture of the hidden screen (the previous one while nothing new was drawn), or null. */
    static synchronized Image latest() {
        if (reader == null) return null;
        Image n = reader.acquireLatestImage();
        if (n != null) { if (last != null) last.close(); last = n; }
        return last;
    }

    /** A mutable W×H copy of a picture (its buffer rows can be wider than the display). */
    static Bitmap toBitmap(Image img) {
        Image.Plane p = img.getPlanes()[0];
        int rs = p.getRowStride(), ps = p.getPixelStride();
        Bitmap bm = Bitmap.createBitmap(rs / ps, H, Bitmap.Config.ARGB_8888);
        ByteBuffer buf = p.getBuffer(); buf.rewind(); bm.copyPixelsFromBuffer(buf);
        if (rs / ps == W) return bm;
        Bitmap c = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        new Canvas(c).drawBitmap(bm, 0, 0, null);
        bm.recycle();
        return c;
    }

    static synchronized Bitmap snapshot() {
        Image img = latest();
        return img == null ? null : toBitmap(img);
    }

    /** The live view's picture, w pixels wide. While the hidden screen draws nothing new, the last JPEG is sent again
     *  instead of copying and compressing the same picture every half second. */
    static synchronized byte[] frame(int w) {
        Image img = latest();
        if (img == null) return null;
        if (jpg != null && jpgW == w && jpgTs == img.getTimestamp()) return jpg;
        jpg = jpeg(toBitmap(img), w);
        jpgW = w;
        jpgTs = img.getTimestamp();
        return jpg;
    }

    static byte[] jpeg(Bitmap bm, int w) {
        Bitmap s = w >= W ? bm : Bitmap.createScaledBitmap(bm, w, Math.round(H * (w / (float) W)), true);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        s.compress(Bitmap.CompressFormat.JPEG, 70, bo);
        return bo.toByteArray();
    }

    /** True when the picture is black all over: the app marked its screen secure (FLAG_SECURE), so pictures of it are
     *  black while its elements can still be read. */
    static boolean allBlack(Bitmap bm) {
        for (int y = H / 48; y < H; y += H / 24)
            for (int x = W / 24; x < W; x += W / 12) {
                int c = bm.getPixel(x, y);
                if (Color.red(c) > 8 || Color.green(c) > 8 || Color.blue(c) > 8) return false;
            }
        return true;
    }

    static final int[] MARK = {0xFFE53935, 0xFF1E88E5, 0xFF43A047, 0xFFFB8C00, 0xFF8E24AA, 0xFF00897B};

    /** Set-of-marks: a numbered box around every element that can be used (plain text and whole lists stay unmarked,
     *  so the picture stays readable), so a vision model can match the list's numbers to what it sees. */
    static void drawMarks(Bitmap bm, Scan s) throws Exception {
        Canvas c = new Canvas(bm);
        Paint box = new Paint(); box.setStyle(Paint.Style.STROKE); box.setStrokeWidth(3);
        Paint tag = new Paint();
        Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG); ink.setColor(Color.WHITE); ink.setStrokeWidth(3); ink.setStrokeCap(Paint.Cap.ROUND);
        for (int i = 0; i < s.els.length(); i++) {
            String role = s.els.getJSONObject(i).optString("role");
            if (role.equals("text") || role.equals("list") || role.equals("pager")) continue;
            Rect b = s.boxes.get(i);
            int col = MARK[i % MARK.length];
            box.setColor(col);
            c.drawRect(b, box);
            String num = String.valueOf(i + 1);
            float tw = num.length() * 15 + 7, x = Math.max(0, Math.min(b.left, W - tw)), y = Math.max(0, Math.min(b.top, H - 26));
            tag.setColor(col);
            c.drawRect(x, y, x + tw, y + 26, tag);
            for (int k = 0; k < num.length(); k++) digit(c, ink, num.charAt(k) - '0', x + 5 + k * 15, y + 4);
        }
    }

    /** Segments a-g (top, top right, bottom right, bottom, bottom left, top left, middle) lit for each digit. */
    static final int[] SEGMENTS = {0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101,
            0b0000111, 0b1111111, 0b1101111};

    /** A 10x18 digit drawn with lines: the host runs in app_process, where no font is loaded and drawText crashes. */
    static void digit(Canvas c, Paint p, int d, float x, float y) {
        int s = SEGMENTS[d];
        float r = x + 10, m = y + 9, bt = y + 18;
        if ((s & 1) != 0) c.drawLine(x, y, r, y, p);
        if ((s & 2) != 0) c.drawLine(r, y, r, m, p);
        if ((s & 4) != 0) c.drawLine(r, m, r, bt, p);
        if ((s & 8) != 0) c.drawLine(x, bt, r, bt, p);
        if ((s & 16) != 0) c.drawLine(x, m, x, bt, p);
        if ((s & 32) != 0) c.drawLine(x, y, x, m, p);
        if ((s & 64) != 0) c.drawLine(x, m, r, m, p);
    }

    // ── accessibility tree ───────────────────────────────────────────────────────────────────────────────

    static UiAutomation ua() throws Exception {
        if (ua != null) return ua;
        Class<?> conn = Class.forName("android.app.UiAutomationConnection");
        Constructor<?> cc = conn.getDeclaredConstructor(); cc.setAccessible(true);
        Constructor<?> uc = UiAutomation.class.getDeclaredConstructor(Looper.class, Class.forName("android.app.IUiAutomationConnection"));
        uc.setAccessible(true);
        uaThread = new HandlerThread("hm-ua"); uaThread.start();
        UiAutomation u = (UiAutomation) uc.newInstance(uaThread.getLooper(), cc.newInstance());
        Method cm = UiAutomation.class.getDeclaredMethod("connect", int.class); cm.setAccessible(true);
        cm.invoke(u, UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
        AccessibilityServiceInfo si = u.getServiceInfo();
        si.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        // UiAutomation subscribes to every event of every app by default, so each scroll, tap or text change on the
        // owner's screen would be sent here too. Only "a screen changed" is used: settle() waits for the hidden one.
        si.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                | AccessibilityEvent.TYPE_WINDOWS_CHANGED | AccessibilityEvent.TYPE_VIEW_SCROLLED;
        u.setServiceInfo(si);
        u.setOnAccessibilityEventListener(e -> { if (e.getDisplayId() == displayId) lastChange = SystemClock.uptimeMillis(); });
        SystemClock.sleep(200);
        ua = u;
        return u;
    }

    static List<AccessibilityWindowInfo> windows() throws Exception {
        SparseArray<List<AccessibilityWindowInfo>> all = ua().getWindowsOnAllDisplays();
        List<AccessibilityWindowInfo> ws = all.get(displayId);
        return ws == null ? new ArrayList<>() : ws;
    }

    /** One reading of the hidden screen. Element n is index n-1 of every list. */
    static final class Scan {
        final List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        final List<Rect> boxes = new ArrayList<>();
        final List<String> names = new ArrayList<>();
        final JSONArray els = new JSONArray();
        String title = "";
        int appWindows;
        boolean keyboard;
    }

    /** Reads every window of the hidden display, topmost first (a dialog's elements come before the screen under it).
     *  A keyboard window is left out: its keys are not the app. */
    static Scan scan() throws Exception {
        Scan s = new Scan();
        for (AccessibilityWindowInfo wi : windows()) {
            if (wi.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) { s.keyboard = true; continue; }
            if (wi.getType() == AccessibilityWindowInfo.TYPE_APPLICATION) {
                s.appWindows++;
                CharSequence t = wi.getTitle();
                if (t != null && s.title.isEmpty()) s.title = t.toString();
            }
            walk(wi.getRoot(), 0, s);
        }
        return s;
    }

    static JSONObject capture(boolean tree, boolean image, boolean marks, int maxW) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        JSONObject r = ok().put("w", W).put("h", H).put("pkg", pkg).put("screen", screenName());
        Scan s = null;
        if (tree || marks) {
            s = scan();
            shown = s;
            r.put("elements", s.els);
            if (!s.title.isEmpty()) r.put("title", s.title);
            if (s.appWindows > 1) r.put("popup", true);
            if (s.keyboard) r.put("keyboard", true);
        }
        if (image) {
            Bitmap bm = snapshot();
            if (bm != null) {
                if (allBlack(bm)) r.put("black", true);
                else if (marks) drawMarks(bm, s);
                r.put("image_b64", Base64.encodeToString(jpeg(bm, Math.max(240, Math.min(maxW, W))), Base64.NO_WRAP));
            }
        }
        return r;
    }

    static boolean actionable(AccessibilityNodeInfo n) {
        return n.isClickable() || n.isLongClickable() || n.isEditable() || n.isCheckable() || n.isScrollable();
    }

    /** A button, row or switch, named with the text inside it. Not a node covering half the screen or more: some apps
     *  make a whole page clickable, and folding it would hide everything on it. */
    static boolean folds(AccessibilityNodeInfo n) {
        if (!actionable(n) || n.isScrollable() || n.isEditable()) return false;
        Rect b = new Rect(); n.getBoundsInScreen(b);
        return (long) b.width() * b.height() < (long) W * H / 2;
    }

    /** The node's own words: its text and description ("Send", "Photo (Sunset)"). A field's hint is not its text. */
    static String label(AccessibilityNodeInfo n) {
        CharSequence t = n.getText(), d = n.getContentDescription();
        String a = t == null || (n.isEditable() && n.isShowingHintText()) ? "" : t.toString().trim();
        String b = d == null ? "" : d.toString().trim();
        if (a.isEmpty()) return b;
        if (b.isEmpty() || b.equals(a)) return a;
        return a + " (" + b + ")";
    }

    /** The name the model sees. A folding node's name also has the words of the plain nodes inside it ("Wi-Fi,
     *  Connected"); the usable nodes inside it (a switch in a row) go to `inner` and stay elements of their own. */
    static String nameOf(AccessibilityNodeInfo n, int depth, List<AccessibilityNodeInfo> inner) {
        StringBuilder name = new StringBuilder(label(n));
        if (folds(n)) for (int i = 0; i < n.getChildCount(); i++) gather(n.getChild(i), depth + 1, name, inner);
        return name.toString();
    }

    static void gather(AccessibilityNodeInfo c, int depth, StringBuilder name, List<AccessibilityNodeInfo> inner) {
        if (c == null || depth > 60 || !c.isVisibleToUser()) return;
        if (actionable(c)) { inner.add(c); return; }
        String t = label(c);
        if (!t.isEmpty() && name.indexOf(t) < 0 && name.length() < 300) { if (name.length() > 0) name.append(", "); name.append(t); }
        for (int i = 0; i < c.getChildCount(); i++) gather(c.getChild(i), depth + 1, name, inner);
    }

    static void walk(AccessibilityNodeInfo n, int depth, Scan s) throws Exception {
        if (n == null || depth > 60 || s.nodes.size() >= MAX_ELEMENTS || !n.isVisibleToUser()) return;
        if (folds(n)) {
            List<AccessibilityNodeInfo> inner = new ArrayList<>();
            add(s, n, nameOf(n, depth, inner));
            for (AccessibilityNodeInfo c : inner) walk(c, depth + 1, s);
            return;
        }
        String own = label(n);
        if (actionable(n) || !own.isEmpty()) add(s, n, own);
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), depth + 1, s);
    }

    static String role(AccessibilityNodeInfo n) {
        String c = n.getClassName() == null ? "" : n.getClassName().toString();
        if (n.isEditable()) return "field";
        if (n.isCheckable()) return c.contains("Switch") || c.contains("Toggle") ? "switch" : c.contains("Radio") ? "radio" : "checkbox";
        if (n.isScrollable()) return c.contains("Pager") ? "pager" : "list";
        if (c.endsWith("SeekBar") || c.contains("Slider")) return "slider";
        if (n.isClickable() || n.isLongClickable()) return c.contains("Tab") ? "tab" : c.contains("Image") ? "image button" : "button";
        if (c.contains("Image")) return "image";
        return "text";
    }

    static void add(Scan s, AccessibilityNodeInfo n, String name) throws Exception {
        Rect b = new Rect(); n.getBoundsInScreen(b);
        s.nodes.add(n);
        s.boxes.add(b);
        s.names.add(name);
        JSONObject e = new JSONObject().put("n", s.nodes.size()).put("role", role(n));
        if (!name.isEmpty()) e.put("text", clip(name));
        if (n.isEditable()) { CharSequence h = n.getHintText(); if (h != null && h.length() > 0) e.put("hint", clip(h)); }
        String id = n.getViewIdResourceName();
        if (id != null) e.put("id", id.contains(":id/") ? id.substring(id.indexOf(":id/") + 4) : id);
        if (n.isCheckable()) e.put("checked", n.isChecked());
        if (n.isSelected()) e.put("selected", true);
        if (n.isFocused()) e.put("focused", true);
        if (!n.isEnabled()) e.put("disabled", true);
        if (n.isScrollable()) {
            List<AccessibilityAction> acts = n.getActionList();
            boolean fwd = acts.contains(AccessibilityAction.ACTION_SCROLL_FORWARD), back = acts.contains(AccessibilityAction.ACTION_SCROLL_BACKWARD);
            e.put("more", fwd && back ? "both" : fwd ? "after" : back ? "before" : "none");
            if (b.width() > 2 * b.height()) e.put("horizontal", true);
        }
        e.put("x", b.centerX()).put("y", b.centerY());
        s.els.put(e);
    }

    static String clip(CharSequence s) { String v = s.toString().replace('\n', ' '); return v.length() > 160 ? v.substring(0, 160) + "…" : v; }

    /** Element n of the last capture, if it is still on the screen and still the same thing. A list row the app reused
     *  for other content, or an element that left the screen, is refused instead of acting on the wrong thing. */
    static AccessibilityNodeInfo node(int n) {
        if (n < 1 || n > shown.nodes.size()) throw new IllegalArgumentException("no element " + n + " (capture again)");
        AccessibilityNodeInfo x = shown.nodes.get(n - 1);
        if (!x.refresh() || !x.isVisibleToUser()) throw new IllegalArgumentException("element " + n + " is no longer on the screen (capture again)");
        if (!x.isEditable()) { // a field's text is what the model types, so it may differ
            String now = nameOf(x, 0, new ArrayList<>());
            if (!now.equals(shown.names.get(n - 1)))
                throw new IllegalArgumentException("element " + n + " has changed (it now says \"" + clip(now) + "\"); capture again");
        }
        return x;
    }

    /** What an action works on: {n} from the last capture, or {target}: words on the screen, matched on a fresh reading
     *  (so the numbers of the last capture stay valid). */
    static final class Pick { AccessibilityNodeInfo node; Rect box; String what = ""; }

    static Pick pick(JSONObject a, String kind) throws Exception {
        Pick p = new Pick();
        if (a.has("n")) {
            p.node = node(a.getInt("n"));
            p.box = new Rect(); p.node.getBoundsInScreen(p.box);
            return p;
        }
        String want = a.optString("target", "").trim();
        if (want.isEmpty()) throw new IllegalArgumentException("say which element: its number, or its text as target");
        Scan s = scan();
        int i = find(s, want, kind);
        if (i < 0) throw new IllegalArgumentException("nothing on the screen says \"" + want + "\" (capture to see what is there)");
        JSONObject e = s.els.getJSONObject(i);
        p.node = s.nodes.get(i);
        p.box = s.boxes.get(i);
        String name = e.optString("text", e.optString("hint", ""));
        p.what = e.optString("role") + (name.isEmpty() ? "" : " \"" + name + "\"");
        return p;
    }

    /** Index of the element in s that best matches `want`, or -1: the exact name (or one comma part of a folded name),
     *  then a name starting with it, then one containing it, ignoring case; usable elements beat plain text. kind
     *  "field" or "check" prefers text fields or switches, and takes the one right after a matching label (a settings
     *  row whose switch is a separate element). */
    static int find(Scan s, String want, String kind) throws Exception {
        String w = want.toLowerCase(Locale.ROOT);
        int best = -1, bestScore = 0;
        for (int i = 0; i < s.els.length(); i++) {
            JSONObject e = s.els.getJSONObject(i);
            int score = 0;
            for (String f : new String[]{e.optString("text"), e.optString("hint"), e.optString("id")}) {
                String v = f.toLowerCase(Locale.ROOT);
                if (v.isEmpty()) continue;
                score = Math.max(score, v.equals(w) ? 30 : Arrays.asList(v.split(", ")).contains(w) ? 25 : v.startsWith(w) ? 20 : v.contains(w) ? 10 : 0);
            }
            if (score == 0) continue;
            if (!e.optString("role").equals("text")) score += 3;
            if (kind != null && isKind(e, kind)) score += 15;
            if (score > bestScore) { best = i; bestScore = score; }
        }
        if (best >= 0 && kind != null && !isKind(s.els.getJSONObject(best), kind))
            for (int j = best + 1; j < Math.min(s.els.length(), best + 5); j++)
                if (isKind(s.els.getJSONObject(j), kind)) return j;
        return best;
    }

    static boolean isKind(JSONObject e, String kind) {
        return kind.equals("field") ? e.optString("role").equals("field") : e.has("checked");
    }

    // ── input ────────────────────────────────────────────────────────────────────────────────────────────

    /** The app on the hidden display closed itself (back on its first screen, a crash, a finished flow). */
    static boolean appGone() {
        try {
            Object atm = atm();
            List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, displayId);
            return infos.isEmpty();
        } catch (Throwable t) { return false; }
    }

    static JSONObject gone() { return err("the app closed itself (or left the hidden screen); open it again"); }

    /** Null while an app is open on the hidden display, else the error to answer with. */
    static JSONObject notOpen() {
        if (vd == null) return err("no app open: use open first");
        return appGone() ? gone() : null;
    }

    static void inject(InputEvent ev) throws Exception {
        Method sd = ev.getClass().getMethod("setDisplayId", int.class);
        sd.invoke(ev, displayId);
        if (!ua().injectInputEvent(ev, true)) throw new IllegalStateException("input was not delivered");
    }

    static void touch(int action, long down, long at, float x, float y) throws Exception {
        MotionEvent e = MotionEvent.obtain(down, at, action, x, y, 0);
        e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        inject(e);
    }

    /** A finger down for ms milliseconds: 60 is a tap, 650 a long press. */
    static void pressXY(int x, int y, long ms) throws Exception {
        long t = SystemClock.uptimeMillis();
        touch(MotionEvent.ACTION_DOWN, t, t, x, y);
        if (ms > 100) SystemClock.sleep(ms);
        touch(MotionEvent.ACTION_UP, t, Math.max(SystemClock.uptimeMillis(), t + ms), x, y);
    }

    static void swipe(int x1, int y1, int x2, int y2, int ms) throws Exception {
        long t = SystemClock.uptimeMillis();
        touch(MotionEvent.ACTION_DOWN, t, t, x1, y1);
        int steps = 10;
        for (int i = 1; i <= steps; i++) {
            float f = i / (float) steps;
            touch(MotionEvent.ACTION_MOVE, t, t + (long) (ms * f), x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
            SystemClock.sleep(ms / steps);
        }
        touch(MotionEvent.ACTION_UP, t, t + ms, x2, y2);
    }

    static JSONObject tap(JSONObject a, boolean longPress) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        long ms = longPress ? 650 : 60;
        if (a.has("x")) {
            pressXY(a.getInt("x"), a.getInt("y"), ms);
            settle();
            return ok().put("via", "touch");
        }
        Pick p = pick(a, null);
        int action = longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
        for (AccessibilityNodeInfo c = p.node; c != null; c = c.getParent()) {
            if ((longPress ? c.isLongClickable() : c.isClickable()) && c.performAction(action)) {
                settle();
                return ok().put("via", "node").put("target", p.what);
            }
        }
        pressXY(p.box.centerX(), p.box.centerY(), ms);
        settle();
        return ok().put("via", "touch").put("target", p.what);
    }

    static JSONObject swipeReq(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        int x1 = a.getInt("x1"), y1 = a.getInt("y1"), x2 = a.getInt("x2"), y2 = a.getInt("y2");
        for (int[] pt : new int[][]{{x1, y1}, {x2, y2}})
            if (pt[0] < 0 || pt[0] >= W || pt[1] < 0 || pt[1] >= H) return err("swipe points must be on the " + W + "x" + H + " screen");
        swipe(x1, y1, x2, y2, Math.max(100, Math.min(a.optInt("ms", 300), 3000)));
        settle();
        return ok();
    }

    static AccessibilityNodeInfo focusedInput() throws Exception {
        for (AccessibilityWindowInfo wi : windows()) {
            AccessibilityNodeInfo r = wi.getRoot();
            if (r == null) continue;
            AccessibilityNodeInfo f = r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (f != null && f.isEditable()) return f;
        }
        return null;
    }

    static boolean setNodeText(AccessibilityNodeInfo n, String text) {
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
    }

    static JSONObject setText(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        Pick p = pick(a, "field");
        AccessibilityNodeInfo n = p.node;
        if (!n.isEditable()) {
            n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            SystemClock.sleep(300);
            AccessibilityNodeInfo f = focusedInput();
            if (f == null) return err((p.what.isEmpty() ? "that element" : p.what) + " is not a text field");
            n = f;
        } else {
            n.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        }
        if (!setNodeText(n, a.getString("text"))) return err("the field refused the text");
        settle();
        return ok().put("target", p.what);
    }

    static JSONObject type(String text) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        AccessibilityNodeInfo f = focusedInput();
        if (f != null) {
            CharSequence cur = f.getText();
            String base = cur == null || (f.isShowingHintText()) ? "" : cur.toString();
            if (setNodeText(f, base + text)) { settle(); return ok().put("via", "field"); }
        }
        KeyCharacterMap km = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD);
        KeyEvent[] evs = km.getEvents(text.toCharArray());
        if (evs == null) return err("no focused text field, and the text can't be typed as keys");
        for (KeyEvent e : evs) inject(KeyEvent.changeTimeRepeat(e, SystemClock.uptimeMillis(), 0));
        settle();
        return ok().put("via", "keys");
    }

    static JSONObject key(String name) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        int code;
        switch (name.toLowerCase(Locale.ROOT)) {
            case "back": code = KeyEvent.KEYCODE_BACK; break;
            case "enter": case "return": code = KeyEvent.KEYCODE_ENTER; break;
            case "del": case "backspace": code = KeyEvent.KEYCODE_DEL; break;
            case "tab": code = KeyEvent.KEYCODE_TAB; break;
            case "search": code = KeyEvent.KEYCODE_SEARCH; break;
            case "menu": code = KeyEvent.KEYCODE_MENU; break;
            case "up": code = KeyEvent.KEYCODE_DPAD_UP; break;
            case "down": code = KeyEvent.KEYCODE_DPAD_DOWN; break;
            case "left": code = KeyEvent.KEYCODE_DPAD_LEFT; break;
            case "right": code = KeyEvent.KEYCODE_DPAD_RIGHT; break;
            case "space": code = KeyEvent.KEYCODE_SPACE; break;
            default: return err("unknown key " + name + " (back, enter, del, tab, search, menu, up, down, left, right, space)");
        }
        pressKey(code);
        settle();
        return ok();
    }

    static void pressKey(int code) throws Exception {
        long t = SystemClock.uptimeMillis();
        inject(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0));
        inject(new KeyEvent(t, t + 30, KeyEvent.ACTION_UP, code, 0));
    }

    /** The keyboard's action button (Search, Send, Go, Done) of a field: the one given or the focused one. Many search
     *  fields ignore a plain Enter key; the field's own action works without a keyboard. Enter is the fallback. */
    static JSONObject submit(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        AccessibilityNodeInfo f = a.has("n") || a.has("target") ? pick(a, "field").node : focusedInput();
        if (f != null && f.performAction(AccessibilityAction.ACTION_IME_ENTER.getId())) { settle(); return ok().put("via", "field"); }
        pressKey(KeyEvent.KEYCODE_ENTER);
        settle();
        return ok().put("via", "enter");
    }

    /** Switch or checkbox. With `on`, it is only tapped when it isn't in that state already. */
    static JSONObject toggle(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        Pick p = pick(a, "check");
        AccessibilityNodeInfo n = p.node;
        if (!n.isCheckable()) return err((p.what.isEmpty() ? "that element" : p.what) + " is not a switch or checkbox");
        if (a.has("on") && n.isChecked() == a.getBoolean("on")) return ok().put("checked", n.isChecked()).put("changed", false).put("target", p.what);
        boolean done = false;
        for (AccessibilityNodeInfo c = n; c != null && !done; c = c.getParent())
            done = c.isClickable() && c.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (!done) pressXY(p.box.centerX(), p.box.centerY(), 60);
        settle();
        n.refresh();
        return ok().put("checked", n.isChecked()).put("changed", true).put("target", p.what);
    }

    /** The list to scroll when none is named: the biggest one in s that can still move that way. */
    static AccessibilityNodeInfo mainList(Scan s, boolean fwd) {
        AccessibilityAction want = fwd ? AccessibilityAction.ACTION_SCROLL_FORWARD : AccessibilityAction.ACTION_SCROLL_BACKWARD;
        AccessibilityNodeInfo best = null;
        long area = -1;
        for (int i = 0; i < s.nodes.size(); i++) {
            AccessibilityNodeInfo n = s.nodes.get(i);
            if (!n.isScrollable() || !n.getActionList().contains(want)) continue;
            Rect b = s.boxes.get(i);
            long ar = (long) b.width() * b.height();
            if (ar > area) { area = ar; best = n; }
        }
        return best;
    }

    /** One scroll, settled. Through the list's own scroll action first; some lists (seen in a vendor's Settings) say
     *  yes to it and don't move, so when the screen didn't change a finger swipe does it. */
    static String scrollOnce(String dir, AccessibilityNodeInfo target) throws Exception {
        boolean fwd = dir.equals("down") || dir.equals("right");
        Scan before = scan();
        if (target == null) target = mainList(before, fwd);
        if (target != null && target.performAction(fwd ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) {
            settle();
            if (!scan().names.equals(before.names)) return "node";
        }
        int cx = W / 2, cy = H / 2, d = H / 3;
        switch (dir) {
            case "down": swipe(cx, cy + d / 2, cx, cy - d / 2, 300); break;
            case "up": swipe(cx, cy - d / 2, cx, cy + d / 2, 300); break;
            case "right": swipe(cx + W / 4, cy, cx - W / 4, cy, 300); break;
            default: swipe(cx - W / 4, cy, cx + W / 4, cy, 300);
        }
        settle();
        return "swipe";
    }

    static JSONObject scroll(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        int n = a.optInt("n", 0);
        return ok().put("via", scrollOnce(a.optString("direction", "down"), n > 0 ? node(n) : null));
    }

    /** Scroll until an element saying `target` is on the screen: at most 15 scrolls, or until the list stops moving. */
    static JSONObject scrollTo(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        String want = a.optString("target", "").trim(), dir = a.optString("direction", "down");
        if (want.isEmpty()) return err("scroll_to needs the text to look for (target)");
        List<String> before = null;
        for (int i = 0; i <= 15; i++) {
            Scan s = scan();
            int k = find(s, want, null);
            if (k >= 0) {
                s.nodes.get(k).performAction(AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
                settle();
                return ok().put("found", s.els.getJSONObject(k).optString("text", want)).put("scrolls", i);
            }
            if (s.names.equals(before) || i == 15) break; // nothing moved: the end of the list
            before = s.names;
            scrollOnce(dir, null);
        }
        return err("\"" + want + "\" isn't in this list (scrolled " + dir + " to the end)");
    }

    /** Wait until `target` shows (with gone: until it is no longer there), at most `seconds` (up to 12). */
    static JSONObject waitFor(JSONObject a) throws Exception {
        JSONObject no = notOpen(); if (no != null) return no;
        String want = a.optString("target", "").trim();
        if (want.isEmpty()) return err("wait_for needs the text to wait for (target)");
        boolean gone = a.optBoolean("gone", false);
        long start = SystemClock.uptimeMillis(), end = start + (long) (1000 * Math.max(0.5, Math.min(a.optDouble("seconds", 8), 12)));
        while (true) {
            if ((find(scan(), want, null) >= 0) != gone) return ok().put("waited_ms", SystemClock.uptimeMillis() - start);
            if (SystemClock.uptimeMillis() >= end) break;
            SystemClock.sleep(300);
        }
        return err("\"" + want + "\" " + (gone ? "is still there" : "didn't show") + " after " + (SystemClock.uptimeMillis() - start) / 1000 + " s");
    }

    /** Wait until the hidden screen stops changing. Fast by default: QUIET_MS after its last change, NO_CHANGE_MS when
     *  nothing changes, never more than SETTLE_MAX_MS. Slower things (a download, a search) are the model's to wait for
     *  (wait_after, wait_for), since only it knows what it expects. */
    static void settle() {
        long start = SystemClock.uptimeMillis();
        while (true) {
            long now = SystemClock.uptimeMillis(), changed = lastChange;
            if (now - start >= SETTLE_MAX_MS) return;
            if (changed > start ? now - changed >= QUIET_MS : now - start >= NO_CHANGE_MS) return;
            SystemClock.sleep(40);
        }
    }

    static String exec(String... cmd) throws Exception {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
            for (String l; (l = r.readLine()) != null; ) sb.append(l).append('\n');
        }
        p.waitFor();
        return sb.toString();
    }
}
