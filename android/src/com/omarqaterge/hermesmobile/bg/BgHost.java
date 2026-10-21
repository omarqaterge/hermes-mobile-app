package com.omarqaterge.hermesmobile.bg;

import android.app.Application;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
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
import android.view.accessibility.AccessibilityNodeInfo;
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
import java.util.List;
import java.util.Locale;

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
public final class BgHost {
    static final long IDLE_MS = 120_000, MAX_MS = 30 * 60_000;
    static final int W = 720, H = 1600, DPI = 320, MAX_ELEMENTS = 300;

    // DisplayManager.VIRTUAL_DISPLAY_FLAG_* (hidden ones by value)
    static final int FLAGS = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            | (1 << 6) /* SUPPORTS_TOUCH */ | (1 << 7) /* ROTATES_WITH_CONTENT */ | (1 << 8) /* DESTROY_CONTENT_ON_REMOVAL */
            | (1 << 10) /* TRUSTED */ | (1 << 11) /* OWN_DISPLAY_GROUP */ | (1 << 12) /* ALWAYS_UNLOCKED */
            | (1 << 13) /* TOUCH_FEEDBACK_DISABLED */ | (1 << 14) /* OWN_FOCUS */ | (1 << 16) /* STEAL_TOP_FOCUS_DISABLED */;

    static Context ctx;
    static String token;
    static VirtualDisplay vd;
    static ImageReader reader;
    static Image last;
    static int displayId = -1;
    static String pkg = "";
    static UiAutomation ua;
    static HandlerThread uaThread;
    static final List<AccessibilityNodeInfo> nodes = new ArrayList<>();
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
                case "/open": r = open(a.getString("pkg")); break;
                case "/capture": r = capture(a.optBoolean("tree", true), a.optBoolean("image", false), a.optInt("max_w", W)); break;
                case "/tap": r = tap(a); break;
                case "/set_text": r = setText(a.getInt("n"), a.getString("text")); break;
                case "/type": r = type(a.getString("text")); break;
                case "/key": r = key(a.getString("name")); break;
                case "/scroll": r = scroll(a.optString("direction", "down"), a.optInt("n", 0)); break;
                case "/hand_over": r = handOver(); quit = true; break;
                case "/close": r = ok(); quit = true; break;
                default: send(out, 404, "application/json", "{\"ok\":false,\"error\":\"not found\"}".getBytes(StandardCharsets.UTF_8)); return false;
            }
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
        try { // keyboard (if any shows) stays on the hidden display: DISPLAY_IME_POLICY_LOCAL = 0
            Object wm = service("window", "android.view.IWindowManager");
            wm.getClass().getMethod("setDisplayImePolicy", int.class, int.class).invoke(wm, displayId, 0);
        } catch (Throwable t) { System.out.println("ime policy: " + t); }
        System.out.println("DISPLAY " + displayId);
    }

    static synchronized void release() {
        try { if (ua != null) { Method m = UiAutomation.class.getDeclaredMethod("disconnect"); m.setAccessible(true); m.invoke(ua); } } catch (Throwable ignored) {}
        ua = null;
        if (uaThread != null) { uaThread.quitSafely(); uaThread = null; }
        if (last != null) { last.close(); last = null; }
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
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (android.content.pm.ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
            String p = ri.activityInfo.packageName;
            if (!seen.add(p)) continue;
            out.put(new JSONObject().put("pkg", p).put("label", String.valueOf(ri.loadLabel(pm))));
        }
        return ok().put("apps", out);
    }

    /** The package of the window the owner is looking at (display 0), or "" if unknown. */
    static String ownerForeground() {
        try {
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

    static JSONObject open(String p) throws Exception {
        if (p == null || !p.matches("[A-Za-z0-9_.]+")) return err("bad package name");
        PackageManager pm = ctx.getPackageManager();
        Intent it = pm.getLaunchIntentForPackage(p);
        if (it == null) return err("no launchable app " + p);
        if (p.equals(ownerForeground())) return err("the user has " + p + " open on the screen right now; ask them before taking it");
        String label;
        try { label = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(p, 0))); } catch (Throwable t) { label = p; }
        ensureDisplay();
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        android.app.ActivityOptions o = android.app.ActivityOptions.makeBasic().setLaunchDisplayId(displayId);
        Object atm = atm();
        Method sm = null;
        for (Method m : atm.getClass().getMethods()) if (m.getName().equals("startActivity") && m.getParameterTypes().length == 11) sm = m;
        if (sm == null) return err("startActivity not found");
        int res = (Integer) sm.invoke(atm, null, "com.android.shell", null, it, null, null, null, 0, 0, null, o.toBundle());
        if (res < 0) return err("launch failed (" + res + ")");
        pkg = p;
        // Wait (bounded) until the app has a window on our display.
        long end = SystemClock.elapsedRealtime() + 8000;
        while (SystemClock.elapsedRealtime() < end) {
            if (!windows().isEmpty()) break;
            SystemClock.sleep(200);
        }
        SystemClock.sleep(400);
        String top = topPackage();
        if (!top.isEmpty() && !top.equals(p)) {
            String why = top.contains("securitycenter") || top.contains("applock") || top.contains("lock")
                    ? label + " is protected by an app lock (" + top + "); the user has to unlock it on the real screen or remove it from the app lock"
                    : "another app (" + top + ") opened instead of " + label;
            release();
            pkg = "";
            return err(why);
        }
        return ok().put("display", displayId).put("label", label).put("pkg", p);
    }

    /** Package of the top activity on the hidden display, or "" if none/unknown. */
    static String topPackage() {
        try {
            Object atm = atm();
            List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, displayId);
            for (Object info : infos) {
                Object cn = info.getClass().getField("topActivity").get(info);
                if (cn instanceof android.content.ComponentName) return ((android.content.ComponentName) cn).getPackageName();
            }
        } catch (Throwable t) { System.out.println("topPackage: " + t); }
        return "";
    }

    static JSONObject handOver() throws Exception {
        if (vd == null) return err("no app open");
        Object atm = atm();
        List<?> infos = (List<?>) atm.getClass().getMethod("getAllRootTaskInfosOnDisplay", int.class).invoke(atm, displayId);
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

    static synchronized Bitmap bitmap() {
        if (reader == null) return null;
        Image n = reader.acquireLatestImage();
        if (n != null) { if (last != null) last.close(); last = n; }
        if (last == null) return null;
        Image.Plane p = last.getPlanes()[0];
        int rs = p.getRowStride(), ps = p.getPixelStride();
        Bitmap bm = Bitmap.createBitmap(rs / ps, H, Bitmap.Config.ARGB_8888);
        ByteBuffer buf = p.getBuffer(); buf.rewind(); bm.copyPixelsFromBuffer(buf);
        return rs / ps == W ? bm : Bitmap.createBitmap(bm, 0, 0, W, H);
    }

    static byte[] frame(int w) {
        Bitmap bm = bitmap();
        if (bm == null) return null;
        Bitmap s = w >= W ? bm : Bitmap.createScaledBitmap(bm, w, Math.round(H * (w / (float) W)), true);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        s.compress(Bitmap.CompressFormat.JPEG, 70, bo);
        return bo.toByteArray();
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
        u.setServiceInfo(si);
        SystemClock.sleep(200);
        ua = u;
        return u;
    }

    static List<AccessibilityWindowInfo> windows() throws Exception {
        SparseArray<List<AccessibilityWindowInfo>> all = ua().getWindowsOnAllDisplays();
        List<AccessibilityWindowInfo> ws = all.get(displayId);
        return ws == null ? new ArrayList<>() : ws;
    }

    static JSONObject capture(boolean tree, boolean image, int maxW) throws Exception {
        if (vd == null) return err("no app open: use open first");
        JSONObject r = ok().put("w", W).put("h", H).put("pkg", pkg);
        if (tree) {
            nodes.clear();
            JSONArray els = new JSONArray();
            for (AccessibilityWindowInfo wi : windows()) walk(wi.getRoot(), 0, els);
            r.put("elements", els);
        }
        if (image) {
            byte[] j = frame(Math.max(240, Math.min(maxW, W)));
            if (j != null) r.put("image_b64", Base64.encodeToString(j, Base64.NO_WRAP));
        }
        return r;
    }

    static void walk(AccessibilityNodeInfo n, int depth, JSONArray els) throws Exception {
        if (n == null || depth > 60 || nodes.size() >= MAX_ELEMENTS) return;
        if (!n.isVisibleToUser()) return;
        CharSequence t = n.getText(), d = n.getContentDescription();
        boolean useful = (t != null && t.length() > 0) || (d != null && d.length() > 0) || n.isClickable() || n.isEditable() || n.isScrollable();
        if (useful) {
            Rect b = new Rect(); n.getBoundsInScreen(b);
            nodes.add(n);
            JSONObject e = new JSONObject().put("n", nodes.size());
            if (t != null && t.length() > 0) e.put("text", clip(t));
            if (d != null && d.length() > 0) e.put("desc", clip(d));
            String id = n.getViewIdResourceName();
            if (id != null) e.put("id", id.contains(":id/") ? id.substring(id.indexOf(":id/") + 4) : id);
            CharSequence cls = n.getClassName();
            if (cls != null) { String c = cls.toString(); e.put("cls", c.substring(c.lastIndexOf('.') + 1)); }
            if (n.isClickable()) e.put("click", true);
            if (n.isEditable()) e.put("edit", true);
            if (n.isScrollable()) e.put("scroll", true);
            if (n.isChecked()) e.put("checked", true);
            if (n.isFocused()) e.put("focused", true);
            e.put("x", b.centerX()).put("y", b.centerY());
            els.put(e);
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), depth + 1, els);
    }

    static String clip(CharSequence s) { String v = s.toString().replace('\n', ' '); return v.length() > 160 ? v.substring(0, 160) + "…" : v; }

    static AccessibilityNodeInfo node(int n) {
        if (n < 1 || n > nodes.size()) throw new IllegalArgumentException("no element " + n + " (capture again)");
        AccessibilityNodeInfo x = nodes.get(n - 1);
        x.refresh();
        return x;
    }

    // ── input ────────────────────────────────────────────────────────────────────────────────────────────

    static void inject(InputEvent ev) throws Exception {
        Method sd = ev.getClass().getMethod("setDisplayId", int.class);
        sd.invoke(ev, displayId);
        if (!ua().injectInputEvent(ev, true)) throw new IllegalStateException("input was not delivered");
    }

    static void tapXY(int x, int y) throws Exception {
        long t = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        inject(down);
        MotionEvent up = MotionEvent.obtain(t, t + 60, MotionEvent.ACTION_UP, x, y, 0);
        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        inject(up);
    }

    static void swipe(int x1, int y1, int x2, int y2, int ms) throws Exception {
        long t = SystemClock.uptimeMillis();
        MotionEvent e = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x1, y1, 0);
        e.setSource(InputDevice.SOURCE_TOUCHSCREEN); inject(e);
        int steps = 10;
        for (int i = 1; i <= steps; i++) {
            float f = i / (float) steps;
            MotionEvent m = MotionEvent.obtain(t, t + (long) (ms * f), MotionEvent.ACTION_MOVE, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 0);
            m.setSource(InputDevice.SOURCE_TOUCHSCREEN); inject(m);
            SystemClock.sleep(ms / steps);
        }
        MotionEvent u = MotionEvent.obtain(t, t + ms, MotionEvent.ACTION_UP, x2, y2, 0);
        u.setSource(InputDevice.SOURCE_TOUCHSCREEN); inject(u);
    }

    static JSONObject tap(JSONObject a) throws Exception {
        if (vd == null) return err("no app open: use open first");
        if (a.has("n")) {
            AccessibilityNodeInfo n = node(a.getInt("n"));
            for (AccessibilityNodeInfo c = n; c != null; c = c.getParent()) {
                if (c.isClickable() && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) { settle(); return ok().put("via", "node"); }
            }
            Rect b = new Rect(); n.getBoundsInScreen(b);
            tapXY(b.centerX(), b.centerY());
        } else {
            tapXY(a.getInt("x"), a.getInt("y"));
        }
        settle();
        return ok().put("via", "touch");
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

    static JSONObject setText(int idx, String text) throws Exception {
        if (vd == null) return err("no app open: use open first");
        AccessibilityNodeInfo n = node(idx);
        if (!n.isEditable()) {
            n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            SystemClock.sleep(300);
            AccessibilityNodeInfo f = focusedInput();
            if (f == null) return err("element " + idx + " is not a text field");
            n = f;
        } else {
            n.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        }
        if (!setNodeText(n, text)) return err("the field refused the text");
        settle();
        return ok();
    }

    static JSONObject type(String text) throws Exception {
        if (vd == null) return err("no app open: use open first");
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
        if (vd == null) return err("no app open: use open first");
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
        long t = SystemClock.uptimeMillis();
        inject(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0));
        inject(new KeyEvent(t, t + 30, KeyEvent.ACTION_UP, code, 0));
        settle();
        return ok();
    }

    static JSONObject scroll(String dir, int idx) throws Exception {
        if (vd == null) return err("no app open: use open first");
        boolean fwd = dir.equals("down") || dir.equals("right");
        AccessibilityNodeInfo target = null;
        if (idx > 0) target = node(idx);
        else for (AccessibilityNodeInfo n : nodes) { n.refresh(); if (n.isScrollable()) { target = n; break; } }
        if (target != null && target.performAction(fwd ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) {
            settle(); return ok().put("via", "node");
        }
        int cx = W / 2, cy = H / 2, d = H / 3;
        switch (dir) {
            case "down": swipe(cx, cy + d / 2, cx, cy - d / 2, 300); break;
            case "up": swipe(cx, cy - d / 2, cx, cy + d / 2, 300); break;
            case "right": swipe(cx + W / 4, cy, cx - W / 4, cy, 300); break;
            default: swipe(cx - W / 4, cy, cx + W / 4, cy, 300);
        }
        settle();
        return ok().put("via", "swipe");
    }

    static void settle() { SystemClock.sleep(600); }

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
