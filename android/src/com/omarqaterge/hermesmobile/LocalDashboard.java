package com.omarqaterge.hermesmobile;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The app as a client of the dashboard on {@code 127.0.0.1:9119} after local authentication ({@link LocalAuth}): REST
 * calls whose answers must prove they come from the server holding the shared key, and the decision of what the app
 * shows when the dashboard can't be verified. The session token itself comes from {@link LocalClient#dashboardToken}.
 *
 * <p><b>REST.</b> {@link #open} sends one request with the session token, and {@code X-Hermux-Nonce: <fresh nonce>};
 * the answer's head must carry {@code X-Hermux-Proof: 1 <kid> <proof>} exactly once, the {@code answer} proof over that
 * nonce, the address dialled and {@code rest <status>} (the body is not covered, so it streams as before). Without a
 * valid proof the answer is dropped unread and {@link NotVerified} ("Hermes isn't answering") is thrown; the caller
 * then drops its token, so the next call says hello again. Without a token nothing is sent at all.
 *
 * <p><b>What the user sees</b> is decided by {@link Watch}, a pure function of the failure reasons. Plain Java (no
 * Android classes) so {@code tools/test_local_dashboard.sh} tests it with a JDK. Nothing here logs.
 */
final class LocalDashboard {
    private LocalDashboard() {}

    static final int PORT = 9119;
    static final int CONNECT_MS = 3000;
    /** The status line and headers of a REST answer. */
    static final int MAX_HEAD = 32768;
    static final String NONCE_HEADER = "X-Hermux-Nonce";
    static final String PROOF_HEADER = "x-hermux-proof";
    /**
     * The hello before an answer from a notification (Approve, Stop) may take this long (each read too): the guard
     * answers it on the dashboard's event loop, which a busy Hermes can hold for a while, and such an answer should wait
     * for that, not fail at once. (Before local authentication a REST call waited up to 120 s for its answer; that wait
     * is unchanged.) Every other call (the page's REST, media) has the token step's 5 s and one try, so a port that
     * answers nothing holds a request only briefly.
     */
    static final int REST_HELLO_MS = 30_000;
    /** Hellos before such an answer gives up when none is answered: each on a new connection, never a body resent. */
    static final int REST_HELLO_TRIES = 2;

    /** The hello of a REST call: {deadline in ms, tries}; the long wait only for answers from a notification. */
    static int[] helloPlan(boolean waitLong) {
        return waitLong ? new int[] {REST_HELLO_MS, REST_HELLO_TRIES} : new int[] {LocalClient.HELLO_DEADLINE_MS, 1};
    }

    // ---- what the user sees (spec 4.3) ----

    static final String ALERT_TITLE = "Hermux stopped talking to Hermes";
    static final String ALERT_TEXT = "Something else on this phone answered instead of Hermes, so Hermux sent it nothing. "
            + "Restart the phone to fix it.";
    static final String ALERT_MORE = "If this comes back, an app installed recently may be the cause.";
    static final String UPDATE_TITLE = "Update the Hermux plugin";
    static final String UPDATE_TEXT = "This Hermux needs the newer plugin in Hermes. Hermux is updating it.";
    /** A plugin the app won't replace by itself (held, or changed by hand). */
    static final String UPDATE_HELD_TEXT = "This Hermux needs the newer plugin in Hermes. Settings → About → Plugin → Update anyway.";
    /**
     * The plugin notice's text: "Hermux is updating it" only while {@code PluginSync} will update by itself
     * ({@code wanted}: the plugin is older and the automatic tries are not used up), and never for a plugin held or
     * changed by hand; otherwise it points at Update anyway.
     */
    static String updateText(String state, boolean wanted) {
        if ("held".equals(state) || "modified".equals(state)) return UPDATE_HELD_TEXT;
        return wanted ? UPDATE_TEXT : UPDATE_HELD_TEXT;
    }

    /**
     * What to do with the plugin notice: {@code post} it when it should be up and isn't, or is up with another text;
     * {@code cancel} it when it is up and shouldn't be; else {@code none}.
     */
    static String noticeAction(boolean shown, String shownText, boolean on, String text) {
        if (on) return !shown || shownText == null || !shownText.equals(text) ? "post" : "none";
        return shown ? "cancel" : "none";
    }

    /** The page's callback for the alert banner, and the two alerts it can show. */
    static final String ALERT_CALLBACK = "__hmLocalAlert";
    static final String ALERT_EVENTS = "events", ALERT_DASHBOARD = "dashboard";

    /**
     * The script that tells the page which alert to show: {@code window.__hmLocalAlert && window.__hmLocalAlert('<kind>')},
     * or {@code (null)} for none. Anything but {@link #ALERT_EVENTS} or {@link #ALERT_DASHBOARD} counts as none.
     */
    static String alertJs(String kind) {
        String arg = ALERT_EVENTS.equals(kind) || ALERT_DASHBOARD.equals(kind) ? "'" + kind + "'" : "null";
        return "window." + ALERT_CALLBACK + " && window." + ALERT_CALLBACK + "(" + arg + ")";
    }

    /** The one alert the page shows: the app's own port first (nothing reaches the app), then the dashboard. */
    static String alertKind(boolean events, boolean dashboard) {
        return events ? ALERT_EVENTS : dashboard ? ALERT_DASHBOARD : null;
    }

    // ---- which plugin is installed ----

    /**
     * The {@code BUILD_STAMP} of the first released plugin that answers the hello, or 0 while that release is not cut.
     * While 0, only a plugin at least as new as this APK's own (which answers it) counts as known to.
     *
     * <p>RELEASE-CHECKLIST: before the first release with local authentication, set this to the commit time
     * ({@code git log -1 --format=%ct}) of the merge that brought local authentication into {@code main}: a plugin
     * stamp is its build's last commit time, so every plugin built from that merge on answers the hello and none built
     * before it does. Leaving it at 0 is safe (nothing is sent either way), only less precise.
     */
    static final long P_HELLO = 0;

    /** What the app knows of the installed plugin: it answers the hello, it is too old to, or it isn't known yet. */
    enum Plugin { HELLO, OLD, UNKNOWN }

    /**
     * From the app's own knowledge only (the stamp {@code PluginSync} last read from disk in Debian, and the stamp of the
     * plugin inside this APK), never from what a port says: {@link Plugin#HELLO} when the installed stamp is at least
     * {@link #P_HELLO} (once set) or at least the APK's; {@link Plugin#UNKNOWN} when no stamp is known.
     */
    static Plugin plugin(String installed, String apk) {
        long i = stamp(installed), a = stamp(apk);
        if (i <= 0) return Plugin.UNKNOWN;
        if ((P_HELLO > 0 && i >= P_HELLO) || (a > 0 && i >= a)) return Plugin.HELLO;
        return Plugin.OLD;
    }

    private static long stamp(String s) {
        if (s == null || s.isEmpty() || s.length() > 12) return -1;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return -1;
        return Long.parseLong(s);
    }

    // ---- REST with a proof over each answer ----

    /**
     * Not sent, or the answer dropped, with the same words as a dashboard that is down: {@code why} is one of
     * {@link LocalClient#REASONS} ({@code no_answer} also when there was no token, so nothing was sent), and
     * {@code helloFailed} says the connection's hello did not verify (then nothing but the hello was sent).
     */
    static final class NotVerified extends IOException {
        final String why;
        final boolean helloFailed;
        NotVerified(String why, boolean helloFailed) {
            super("Hermes isn't answering");
            this.why = LocalClient.REASONS.contains(why) ? why : "no_hello";
            this.helloFailed = helloFailed;
        }
    }

    /**
     * The session token cache of one caller (the activity, the service): a token is fetched again when asked to, when
     * none is held, or when {@link #dropAll} was called since it was fetched (an answer without a valid proof). Every
     * cache shares that one generation, so one drop reaches all of them. Thread-safe.
     */
    static final class Tokens {
        private static final java.util.concurrent.atomic.AtomicInteger GEN = new java.util.concurrent.atomic.AtomicInteger();
        private String token = "";
        private int gen = -1;

        /** Every cached token is dropped: the next {@link #get} of every cache fetches again. */
        static void dropAll() { GEN.incrementAndGet(); }

        /** The cached token, or a fresh one from {@code fetch} ("" for none). */
        synchronized String get(boolean refresh, java.util.function.Supplier<String> fetch) {
            int g = GEN.get();
            if (refresh || token.isEmpty() || g != gen) {
                String t = fetch.get();
                token = t == null ? "" : t;
                gen = g; // a drop during the fetch makes the next get fetch again
            }
            return token;
        }
    }

    /**
     * True when {@code values} (every {@code X-Hermux-Proof} header of the answer) is exactly one {@code 1 <kid> <proof>}
     * whose proof is the {@code answer} MAC under the key {@code keys} knows by that kid, over {@code nc}, the address
     * dialled and {@code rest <status>}. Anything else, a key that can't be used included, is false.
     */
    static boolean proofOk(LocalClient.KeySet keys, int port, String nc, int status, List<String> values) {
        if (keys == null || values == null || values.size() != 1 || status < 100 || status > 999) return false;
        String v = values.get(0);
        if (v == null || v.length() > 256) return false;
        String[] p = v.split(" ", -1);
        if (p.length != 3 || !"1".equals(p[0]) || !LocalAuth.isKid(p[1]) || !LocalAuth.isHash(p[2])) return false;
        try {
            String key = keys.byKid(p[1]);
            if (key == null) return false;
            String want = LocalAuth.mac(key, "answer", "dashboard", LocalAuth.addr(port), nc, LocalAuth.NO_NONCE,
                    "rest " + status, LocalAuth.EMPTY_HASH);
            return LocalAuth.same(want, p[2]);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** A verified answer: status, reason, headers (in their order, names as sent) and the body as a live stream. */
    static final class Reply implements Closeable {
        final int status;
        final String reason;
        final List<String[]> headers;
        final InputStream body;
        private final Socket sock;

        private Reply(int status, String reason, List<String[]> headers, InputStream body, Socket sock) {
            this.status = status; this.reason = reason; this.headers = headers; this.body = body; this.sock = sock;
        }

        /** A header's value (any case) when it is there exactly once; null otherwise. */
        String header(String name) {
            String found = null;
            int n = 0;
            for (String[] h : headers) if (h[0].equalsIgnoreCase(name)) { found = h[1]; n++; }
            return n == 1 ? found : null;
        }

        boolean chunked() {
            String te = header("transfer-encoding");
            return te != null && te.toLowerCase(Locale.ROOT).contains("chunked");
        }

        @Override public void close() {
            try { sock.close(); } catch (IOException ignored) { }
        }
    }

    /**
     * Sends one request to {@code 127.0.0.1:port} on a connection whose hello verified, and returns its answer once the
     * head's proof checks out too ({@link #proofOk} over this request's own fresh nonce). The hello comes first, on the
     * same socket ({@link LocalClient#open}, role {@code dashboard}: the dashboard guard answers it with a length and
     * keeps the connection open), so the token and the body go only to the server that has just proved it holds the key.
     * {@code token} is the session token: without one nothing is sent at all. {@code accept} and {@code range} are
     * optional headers; a body goes as {@code application/json}. The head must arrive within {@code readMs} in all (the
     * body afterwards gets {@code readMs} per read, so a long stream keeps going). The body stays on the socket; closing
     * the returned stream (or the {@link Reply}) closes it. A failed hello, or a head without a valid proof, malformed or
     * over {@link #MAX_HEAD}: the socket is closed and {@link NotVerified} says why.
     */
    static Reply open(int port, LocalClient.KeySet keys, String method, String path, String token, byte[] body,
                      String accept, String range, int readMs) throws IOException {
        return open(port, keys, method, path, token, body, accept, range, readMs, false);
    }

    /** As above; {@code waitLong} gives the hello {@link #helloPlan}'s long wait (answers from a notification). */
    static Reply open(int port, LocalClient.KeySet keys, String method, String path, String token, byte[] body,
                      String accept, String range, int readMs, boolean waitLong) throws IOException {
        if (token == null || token.isEmpty() || !LocalClient.isToken(token)) throw new NotVerified("no_answer", false);
        int[] plan = helloPlan(waitLong);
        LocalClient.Session session = null;
        for (int attempt = 1; session == null; attempt++) {
            try {
                session = LocalClient.open("dashboard", port, keys, plan[0]);
            } catch (LocalClient.Unverified u) {
                // Nothing but the hello was sent. With the long wait, a hello without an answer (a busy dashboard, or
                // none) gets one more try on a new connection with a new hello; any other failure is final.
                if (!"no_answer".equals(u.why) || attempt >= plan[1]) throw new NotVerified(u.why, true);
            }
        }
        Socket sock = session.handOff();
        String nc = LocalAuth.nonce();
        boolean ok = false;
        try {
            StringBuilder h = new StringBuilder();
            h.append(method).append(' ').append(path).append(" HTTP/1.1\r\nHost: ").append(LocalAuth.addr(port))
             .append("\r\nConnection: close\r\n");
            if (accept != null) h.append("Accept: ").append(accept).append("\r\n");
            h.append("X-Hermes-Session-Token: ").append(token).append("\r\n");
            h.append(NONCE_HEADER).append(": ").append(nc).append("\r\n");
            if (range != null) h.append("Range: ").append(range).append("\r\n");
            if (body != null) h.append("Content-Type: application/json\r\nContent-Length: ").append(body.length).append("\r\n");
            h.append("\r\n");
            sock.setSoTimeout(readMs);
            OutputStream out = sock.getOutputStream();
            out.write(h.toString().getBytes(StandardCharsets.UTF_8));
            if (body != null) out.write(body);
            out.flush();
            InputStream in = new BufferedInputStream(sock.getInputStream(), 65536);
            String head = readHead(in, sock, System.nanoTime() + readMs * 1_000_000L, readMs);
            if (head == null) throw new NotVerified("no_hello", false);
            sock.setSoTimeout(readMs);
            String[] lines = head.split("\r\n", -1);
            int status = statusOf(lines[0]);
            if (status < 0) throw new NotVerified("no_hello", false);
            String[] st = lines[0].split(" ", 3);
            String reason = st.length > 2 ? st[2].trim() : "";
            List<String[]> hs = new ArrayList<>();
            List<String> proofs = new ArrayList<>();
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon <= 0) throw new NotVerified("no_hello", false);
                String name = lines[i].substring(0, colon).trim(), val = lines[i].substring(colon + 1).trim();
                hs.add(new String[] {name, val});
                if (name.equalsIgnoreCase(PROOF_HEADER)) proofs.add(val);
            }
            if (!proofOk(keys, port, nc, status, proofs)) throw new NotVerified("bad_proof", false);
            final Socket s = sock;
            InputStream closing = new FilterInputStream(in) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { s.close(); }
                }
            };
            ok = true;
            return new Reply(status, reason, Collections.unmodifiableList(hs), closing, sock);
        } finally {
            if (!ok) try { sock.close(); } catch (IOException ignored) { }
        }
    }

    /** One request, its whole answer read: {status, body as UTF-8} (a chunked body joined). As {@link #open}. */
    static String[] call(int port, LocalClient.KeySet keys, String method, String path, String token, String body,
                         int readMs) throws IOException {
        return call(port, keys, method, path, token, body, readMs, false);
    }

    /** As above; {@code waitLong} as in {@link #open}. */
    static String[] call(int port, LocalClient.KeySet keys, String method, String path, String token, String body,
                         int readMs, boolean waitLong) throws IOException {
        byte[] payload = body == null ? null : body.getBytes(StandardCharsets.UTF_8);
        try (Reply r = open(port, keys, method, path, token, payload, "application/json", null, readMs, waitLong)) {
            byte[] rest;
            if (r.chunked()) rest = dechunk(readAll(r.body));
            else rest = readLength(r.body, r.header("content-length"));
            return new String[] {String.valueOf(r.status), new String(rest, StandardCharsets.UTF_8)};
        }
    }

    /** {@code HTTP/1.x NNN[ reason]}: the status, or -1. */
    static int statusOf(String line) {
        if (line == null || !line.startsWith("HTTP/1.") || line.length() < 12 || line.charAt(8) != ' ') return -1;
        String code = line.substring(9, 12);
        for (int i = 0; i < 3; i++) if (code.charAt(i) < '0' || code.charAt(i) > '9') return -1;
        if (line.length() > 12 && line.charAt(12) != ' ') return -1;
        return Integer.parseInt(code);
    }

    /**
     * The head up to (not including) the blank line; null when it ends early or passes {@link #MAX_HEAD}. The whole head
     * must arrive by {@code deadline} (System.nanoTime): each read waits only for what is left of it (at most
     * {@code readMs}), so a server sending a byte at a time can't stretch it.
     */
    static String readHead(InputStream in, Socket sock, long deadline, int readMs) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int a = -1, b = -1, c = -1;
        while (true) {
            long left = (deadline - System.nanoTime()) / 1_000_000L;
            if (left <= 0) throw new java.net.SocketTimeoutException("head");
            if (in.available() == 0) sock.setSoTimeout((int) Math.max(1, Math.min(readMs, left)));
            int x = in.read();
            if (x < 0) return null;
            if (head.size() >= MAX_HEAD) return null;
            head.write(x);
            if (a == '\r' && b == '\n' && c == '\r' && x == '\n') {
                byte[] all = head.toByteArray();
                return new String(all, 0, all.length - 4, StandardCharsets.ISO_8859_1);
            }
            a = b; b = c; c = x;
        }
    }

    /**
     * The body by its {@code Content-Length} (plain digits; fewer bytes when the stream ends first), so the call doesn't
     * wait for the server to close; to the end of the stream without one.
     */
    static byte[] readLength(InputStream in, String length) throws IOException {
        if (length == null || length.isEmpty() || length.length() > 10) return readAll(in);
        for (int i = 0; i < length.length(); i++) if (length.charAt(i) < '0' || length.charAt(i) > '9') return readAll(in);
        long n = Long.parseLong(length);
        if (n > Integer.MAX_VALUE - 8) return readAll(in);
        ByteArrayOutputStream all = new ByteArrayOutputStream((int) Math.min(n, 1 << 20));
        byte[] buf = new byte[32768];
        long left = n;
        while (left > 0) {
            int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r <= 0) break;
            all.write(buf, 0, r);
            left -= r;
        }
        return all.toByteArray();
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        byte[] buf = new byte[32768];
        for (int r; (r = in.read(buf)) > 0; ) all.write(buf, 0, r);
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
            if (n <= 0) break;
            out.write(b, eol + 2, Math.max(0, Math.min(n, b.length - eol - 2)));
            i = eol + 2 + n + 2;
        }
        return out.toByteArray();
    }

    // ---- what to do when the dashboard isn't verified ----

    /**
     * The app's reaction to each try at the dashboard's token (a pure function of the reasons, the app's knowledge of
     * the plugin and the time): nothing answering ({@code no_answer}) is Hermes starting, no alert; something answering
     * without a valid hello ({@code no_hello}, {@code old_version}) is an older plugin when the app knows it is
     * ({@link Plugin#OLD}: the "Update the Hermux plugin" notice), nothing while it is being updated, and otherwise the key
     * is shared again once (a dashboard of ours whose key file is missing answers without a hello too) and, with a
     * plugin known to answer the hello, an alert once it was seen twice at least {@link #NO_HELLO_GAP_MS} apart; a hello
     * naming another address ({@code bad_addr}) is an alert at once; a wrong proof or an unknown key id ({@code bad_proof},
     * {@code unknown_kid}) may be Termux's copy of the key being out of date, so the key is shared again (once in an
     * episode, through Termux, never to the port), the dashboard is tried again after {@link #STALE_RETRY_MS} and once
     * more at {@link #STALE_LAST_MS} after the share (a slow Termux start), and a failure after that is an alert only
     * when the share was handed over; {@code refused} after a good hello is our own dashboard, no alert. A verified hello
     * ends the episode and clears everything. Each {@link Step} asks for at most one later try. Before an alert an
     * episode asks for a few (the 10 s no-hello try, the wait until 20 s after a share, the 5 s and 20 s tries after a
     * stale key), and a no-hello first seen again after {@link #NO_HELLO_WINDOW_MS} asks for one more 10 s try; once an
     * alert is up, at most {@link #ALERT_TRIES} more, spaced 30 s doubling to 5 min, counted only when one is due. So the
     * tries are bounded and spread out, and nothing loops. Thread-safe.
     */
    static final class Watch {
        enum Act { NONE, CLEAR, UPDATE_PLUGIN, SHARE_KEY, ALERT }

        /** What to do now, and when to try again ({@code recheckMs}; -1 for no later try). */
        static final class Step {
            final Act act;
            final long recheckMs;
            Step(Act act, long recheckMs) { this.act = act; this.recheckMs = recheckMs; }
            @Override public String toString() { return act + (recheckMs >= 0 ? "+" + recheckMs : ""); }
        }

        static final long NO_HELLO_GAP_MS = 10_000;
        /** A first {@code no_hello} older than this no longer counts towards a second one. */
        static final long NO_HELLO_WINDOW_MS = 300_000;
        /** After the key was shared: the first try again, and the last one before an alert. */
        static final long STALE_RETRY_MS = 5_000, STALE_LAST_MS = 20_000;
        /** While an alert is up the dashboard is tried again, so it can clear: 30 s, then doubling to 5 min, 8 times. */
        static final long ALERT_FIRST_MS = 30_000, ALERT_CAP_MS = 300_000;
        static final int ALERT_TRIES = 8;

        private static final Step NONE = new Step(Act.NONE, -1), CLEAR = new Step(Act.CLEAR, -1),
                UPDATE = new Step(Act.UPDATE_PLUGIN, -1),
                SHARE = new Step(Act.SHARE_KEY, -1);

        private long firstNoHello = -1, sharedAt = -1;
        private boolean handed, lastAsked;
        private int alerts;
        /** When the alert's later try is due (monotonic ms); -1 while none is scheduled. */
        private long alertDueAt = -1;

        /**
         * An alert, with the next later try while it is up (bounded: {@link #ALERT_TRIES}, then none). A failure before
         * the scheduled try is due (the page's own calls, say) neither counts as a try nor moves it (it asks again for the
         * same due time, so a try the caller replaced meanwhile is restored): only a failure at or after the due time
         * counts, so the tries stay spread out for as long as they last.
         */
        private Step alert(long nowMs) {
            if (alertDueAt >= 0 && nowMs < alertDueAt) return new Step(Act.ALERT, alertDueAt - nowMs);
            int n = alerts++;
            if (n >= ALERT_TRIES) {
                alertDueAt = -1;
                return new Step(Act.ALERT, -1);
            }
            long d = Math.min(ALERT_CAP_MS, ALERT_FIRST_MS << Math.min(n, 10));
            alertDueAt = nowMs + d;
            return new Step(Act.ALERT, d);
        }

        /** A hello verified (and a token came back): alerts and notices go, and every count starts again. */
        synchronized Step verified() {
            firstNoHello = -1;
            sharedAt = -1;
            handed = false;
            lastAsked = false;
            alerts = 0;
            alertDueAt = -1;
            return CLEAR;
        }

        /** After {@link Act#SHARE_KEY}: whether the key's command reached Termux (else a later failure alerts nobody). */
        synchronized void shared(boolean handedOver) { handed = handedOver; }

        /** The key is shared now when it wasn't in this episode yet. */
        private boolean shareNow(long nowMs) {
            if (sharedAt >= 0) return false;
            sharedAt = nowMs;
            handed = false;
            lastAsked = false;
            return true;
        }

        /** One try failed with {@code why} (one of {@link LocalClient#REASONS}) at {@code nowMs} (a monotonic clock). */
        synchronized Step failed(String why, long nowMs, Plugin plugin, boolean updating) {
            if (why == null) why = "no_hello";
            switch (why) {
                case "no_answer":
                    firstNoHello = -1; // starting (or restarting): a no_hello on either side of it is not "twice"
                    return NONE;
                case "refused":
                    return NONE; // the hello proved our key: our dashboard, which refused this one token step
                case "bad_addr":
                    return alert(nowMs);
                case "unknown_kid":
                case "bad_proof": {
                    if (shareNow(nowMs)) return new Step(Act.SHARE_KEY, STALE_RETRY_MS);
                    long since = nowMs - sharedAt;
                    if (since < STALE_RETRY_MS) return NONE; // the key may still be on its way
                    if (since < STALE_LAST_MS) {
                        if (lastAsked) return NONE;
                        lastAsked = true;
                        return new Step(Act.NONE, STALE_LAST_MS - since); // Termux may be slow to start: one more try
                    }
                    return handed ? alert(nowMs) : NONE;
                }
                default: { // no_hello, old_version
                    if (plugin == Plugin.OLD) return UPDATE;
                    if (updating) {
                        firstNoHello = -1;
                        return NONE;
                    }
                    boolean share = shareNow(nowMs); // sharing never touches the port
                    if (plugin != Plugin.HELLO) {
                        firstNoHello = -1;
                        return share ? SHARE : NONE;
                    }
                    if (firstNoHello < 0 || nowMs - firstNoHello > NO_HELLO_WINDOW_MS) {
                        firstNoHello = nowMs;
                        return new Step(share ? Act.SHARE_KEY : Act.NONE, NO_HELLO_GAP_MS);
                    }
                    if (nowMs - firstNoHello >= NO_HELLO_GAP_MS) {
                        // The key was shared in this episode: give Termux until STALE_LAST_MS after it, once.
                        long since = nowMs - sharedAt;
                        if (sharedAt >= 0 && since < STALE_LAST_MS) {
                            if (lastAsked) return NONE;
                            lastAsked = true;
                            return new Step(Act.NONE, STALE_LAST_MS - since);
                        }
                        return alert(nowMs);
                    }
                    return share ? SHARE : NONE;
                }
            }
        }
    }

    /** Builds a header map for {@code WebResourceResponse}: the headers a media answer passes on, plus no-store. */
    static Map<String, String> mediaHeaders(Reply r) {
        Map<String, String> hs = new LinkedHashMap<>();
        for (String[] h : r.headers) {
            String ln = h[0].toLowerCase(Locale.ROOT);
            if (ln.equals("content-length") || ln.equals("content-range") || ln.equals("accept-ranges")) hs.put(h[0], h[1]);
        }
        hs.put("Cache-Control", "no-store");
        return hs;
    }
}
