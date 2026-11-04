package com.omarqaterge.hermesmobile;

import java.util.ArrayDeque;
import java.util.Iterator;

/**
 * The one place that decides whether the page may fetch from the internet while the chat on screen has read phone data
 * (docs/decisions/phone-data-read-only.md, "Chats that have read phone data"). The page's own guards are the friendly part;
 * this is the enforcement: MainActivity's shouldInterceptRequest asks {@link #blocks} for every request the page, its
 * canvas frames and its video players make (images, media, scripts, styles, frames, fonts, fetch), and answers an empty 403
 * when it says yes. Stricter than the page on purpose: it does not trust what the page renders.
 *
 * <p>Fail closed: the state starts BLOCKED, and is reset to BLOCKED each time a page starts loading; the page then reports the
 * active chat's state with {@code remoteBlock}. The one exception the user can make is a tap on "Tap to load": the page calls
 * {@code remoteAllowOnce(url)} and exactly that URL passes once, within {@link #TTL_MS}. Plain Java (no Android classes) so
 * tools/test_remote_guard.sh tests it with a JDK.
 */
final class RemoteGuard {
    private RemoteGuard() {}

    /** An allowance for one tapped address lives this long. */
    static final long TTL_MS = 60_000L;
    /** Allowances kept; the oldest is dropped for a new one. */
    static final int MAX_ALLOWED = 16;
    /** Longest address kept (a longer one is never allowed). */
    static final int MAX_URL = 4096;

    interface Clock { long now(); }
    static Clock clock = System::currentTimeMillis;

    private static final Object LOCK = new Object();
    private static boolean blocked = true;
    private static final ArrayDeque<Object[]> allowed = new ArrayDeque<>(); // {url, expiry}

    /** A new page: blocked until it says otherwise, and no allowance outlives the page that asked. */
    static void reset() {
        synchronized (LOCK) {
            blocked = true;
            allowed.clear();
        }
    }

    /** The page's report of the active chat: true when it has read phone data. */
    static void setBlocked(boolean on) {
        synchronized (LOCK) {
            blocked = on;
            if (on) allowed.clear(); // an allowance from an earlier state is not carried into a new block
        }
    }

    static boolean isBlocked() {
        synchronized (LOCK) { return blocked; }
    }

    /** The user tapped "Tap to load" for exactly this address: let that one request through, once. */
    static boolean allowOnce(String url) {
        String k = key(url);
        if (k == null || k.length() > MAX_URL || !isNetwork(scheme(k))) return false;
        synchronized (LOCK) {
            prune();
            for (Iterator<Object[]> it = allowed.iterator(); it.hasNext(); ) if (k.equals(it.next()[0])) it.remove();
            allowed.addLast(new Object[]{k, clock.now() + TTL_MS});
            while (allowed.size() > MAX_ALLOWED) allowed.pollFirst();
            return true;
        }
    }

    /** Should this request be answered with a 403? {@code url} is the full address, as the WebView gives it. */
    static boolean blocks(String url) {
        synchronized (LOCK) {
            if (!blocked) return false;
            String k = key(url);
            if (k == null) return true; // unreadable: closed
            String scheme = scheme(k);
            if (scheme.equals("file") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("about")) return false;
            if (isNetwork(scheme) && isLocalHost(hostOf(k))) return false;
            prune();
            for (Iterator<Object[]> it = allowed.iterator(); it.hasNext(); ) {
                if (k.equals(it.next()[0])) { it.remove(); return false; } // single use
            }
            return true;
        }
    }

    static int liveAllowances() {
        synchronized (LOCK) { prune(); return allowed.size(); }
    }

    private static void prune() {
        long now = clock.now();
        for (Iterator<Object[]> it = allowed.iterator(); it.hasNext(); ) if ((Long) it.next()[1] <= now) it.remove();
    }

    /** The address without its #fragment (the WebView never sends one), or null when empty. */
    static String key(String url) {
        if (url == null) return null;
        String u = url.trim();
        int h = u.indexOf('#');
        if (h >= 0) u = u.substring(0, h);
        return u.isEmpty() ? null : u;
    }

    private static boolean isNetwork(String scheme) {
        return scheme.equals("http") || scheme.equals("https");
    }

    /** Lower-case scheme, "" when there is none. */
    static String scheme(String url) {
        int c = url.indexOf(':');
        if (c <= 0) return "";
        String s = url.substring(0, c).toLowerCase(java.util.Locale.ROOT);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '+' || ch == '-' || ch == '.')) return "";
        }
        return s;
    }

    /** Lower-case host of an authority-form address (user info and port removed); IPv6 keeps its brackets. */
    static String hostOf(String url) {
        int s = url.indexOf("://");
        if (s < 0) return "";
        int a = s + 3, e = a;
        while (e < url.length() && "/?#\\".indexOf(url.charAt(e)) < 0) e++;
        String auth = url.substring(a, e);
        int at = auth.lastIndexOf('@');
        if (at >= 0) auth = auth.substring(at + 1);
        if (auth.startsWith("[")) {
            int r = auth.indexOf(']');
            return r < 0 ? "" : auth.substring(0, r + 1).toLowerCase(java.util.Locale.ROOT);
        }
        int colon = auth.indexOf(':');
        if (colon >= 0) auth = auth.substring(0, colon);
        return auth.toLowerCase(java.util.Locale.ROOT);
    }

    /**
     * Would opening this address as the page itself (a main-frame navigation, a tapped bare link) reach the internet? Any
     * {@code http:} or {@code https:} prefix in any case, with whitespace and control characters ignored (a browser drops
     * them), with or without the slashes ({@code https:evil.example} loads), and scheme-relative {@code //host} (or with
     * backslashes) all count; only an address whose host is localhost, 127.0.0.1 or [::1] does not.
     */
    static boolean isRemoteTarget(String url) {
        if (url == null) return false;
        StringBuilder b = new StringBuilder(url.length());
        for (int i = 0; i < url.length(); i++) {
            char ch = url.charAt(i);
            if (ch > ' ' && ch != 0x7f && !Character.isWhitespace(ch) && !Character.isISOControl(ch)) b.append(ch);
        }
        String n = b.toString();
        String low = n.toLowerCase(java.util.Locale.ROOT);
        boolean rel = n.length() >= 2 && (n.charAt(0) == '/' || n.charAt(0) == '\\') && (n.charAt(1) == '/' || n.charAt(1) == '\\');
        if (!rel && !low.startsWith("http:") && !low.startsWith("https:")) return false;
        String full = rel ? "https:" + n.replace('\\', '/') : n;
        if (full.toLowerCase(java.util.Locale.ROOT).startsWith("http:") || full.toLowerCase(java.util.Locale.ROOT).startsWith("https:")) {
            String rest = full.substring(full.indexOf(':') + 1);
            int k = 0;
            while (k < rest.length() && (rest.charAt(k) == '/' || rest.charAt(k) == '\\')) k++;
            if (k >= 2 && isLocalHost(hostOf("x://" + rest.substring(k).replace('\\', '/')))) return false;
        }
        return true;
    }

    static boolean isLocalHost(String host) {
        return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
    }
}
