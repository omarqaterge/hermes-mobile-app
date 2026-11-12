package com.omarqaterge.hermesmobile;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The client half of local authentication over HTTP ({@link LocalAuth}): verify the local server, then send it one
 * request on the same connection. {@link #open} dials {@code 127.0.0.1:<port>}, sends
 * {@code GET /hermux/hello?v=1&nc=<nonce>} (plus {@code &kid=<kid>} when the {@link KeySet} gives a hint) and checks the answer (status 200, at most {@link #MAX_HELLO} bytes, JSON with
 * {@code hermux} at least {@link #MIN_VERSION}, the expected {@code role}, {@code addr} equal to the address dialled, a
 * {@code kid} the {@link KeySet} knows, a well-formed {@code ns}, and a {@code proof} equal to the server MAC over the
 * client's nonce). Only then does {@link Session#request} send anything, on that same socket, with the header
 * {@code X-Hermux-Auth: 1 <kid> <ns> <mac>}. Any failure throws {@link Unverified} with one reason from
 * {@link #REASONS}, after which nothing is sent and the socket is closed.
 *
 * <p>Bounded: {@link #CONNECT_MS} to connect, {@link #READ_MS} per read, and a whole-exchange deadline
 * ({@link #HELLO_DEADLINE_MS} for the hello, {@link #ANSWER_DEADLINE_MS} for the answer) so a server that sends one byte
 * at a time cannot hold the caller. Writes are bounded by the same deadlines (a watchdog closes the socket when one
 * passes), no length is allocated before it is checked against the budget, and no proxy is used. Exceptions carry only a reason code, never a key, kid, nonce or MAC. Plain Java (no
 * Android classes) so {@code tools/test_local_auth.sh} tests it with a JDK. Also the dashboard's token step
 * ({@link #dashboardToken}) and the cron ticker's line protocol ({@link #poke}).
 */
final class LocalClient {
    private LocalClient() {}

    /** Always the literal loopback address: no name lookup. */
    static final String HOST = "127.0.0.1";
    static final int CONNECT_MS = 2000;
    static final int READ_MS = 3000;
    /** The whole hello, from connect to the last byte of its answer. */
    static final int HELLO_DEADLINE_MS = 5000;
    /** The whole answer to the one request. */
    static final int ANSWER_DEADLINE_MS = 10000;
    /** The hello answer, status line and headers included. */
    static final int MAX_HELLO = 4096;
    /** The status line and headers of an answer. */
    static final int MAX_HEAD = 8192;
    static final int MAX_HEADERS = 64;
    /** The body of an answer. */
    static final int MAX_ANSWER = 1 << 20;
    static final int MAX_PATH = 2000;
    /** The lowest {@code hermux} version this client accepts. */
    static final int MIN_VERSION = 1;
    /**
     * Why a server was not verified: {@code no_answer} (nothing listening, nothing said, or too slow), {@code no_hello}
     * (an answer that is not a hello answer), {@code old_version}, {@code bad_addr} (it names another address),
     * {@code unknown_kid}, {@code bad_proof}, {@code refused} (it rejected our request after a good hello).
     */
    static final List<String> REASONS = Collections.unmodifiableList(Arrays.asList(
            "no_answer", "no_hello", "old_version", "bad_addr", "unknown_kid", "bad_proof", "refused"));

    /** The keys a client may use, by key id; null for an id it does not know. */
    interface KeySet {
        String byKid(String kid);
        /** The key id the hello names as a hint (the current key of a set with several), or null for none. */
        default String hint() { return null; }
    }

    /** The server was not verified (or refused our request). The message is the reason code and nothing else. */
    static final class Unverified extends IOException {
        final String why;
        Unverified(String why) {
            super(REASONS.contains(why) ? why : "no_hello");
            this.why = getMessage();
        }
    }

    /** The answer to a request: its status and body (at most {@link #MAX_ANSWER} bytes). */
    static final class Answer {
        final int status;
        final byte[] body;
        Answer(int status, byte[] body) { this.status = status; this.body = body; }
    }

    /** Verify the server on {@code 127.0.0.1:port} for {@code role}; the returned session may send one request. */
    static Session open(String role, int port, KeySet keys) throws Unverified {
        return open(role, port, keys, HELLO_DEADLINE_MS, READ_MS);
    }

    /**
     * As {@link #open(String, int, KeySet)}, with the whole hello allowed {@code helloMs} (each read may then wait that
     * long too): for a caller whose server may be busy but honest (the dashboard, before a REST call).
     */
    static Session open(String role, int port, KeySet keys, int helloMs) throws Unverified {
        return open(role, port, keys, helloMs, helloMs);
    }

    private static Session open(String role, int port, KeySet keys, int helloMs, int readMs) throws Unverified {
        if (!LocalAuth.ROLES.contains(role) || port < 1 || port > 65535 || keys == null || helloMs <= 0) throw new IllegalArgumentException("open");
        long deadline = System.nanoTime() + helloMs * 1_000_000L;
        // No proxy: the connection goes straight to the loopback address whatever a ProxySelector says.
        Socket s = new Socket(Proxy.NO_PROXY);
        boolean ok = false;
        try {
            Session session = hello(s, role, port, keys, deadline, readMs);
            ok = true;
            return session;
        } catch (Unverified u) {
            throw u;
        } catch (RuntimeException e) {
            // Last resort for anything unexpected. An Error (out of memory, stack overflow) is not hidden: it propagates.
            throw new Unverified("no_hello");
        } finally {
            if (!ok) closeQuietly(s);
        }
    }

    private static Session hello(Socket s, String role, int port, KeySet keys, long deadline, int readMs) throws Unverified {
        String addr = LocalAuth.addr(port);
        String nc = LocalAuth.nonce();
        String target;
        try {
            target = LocalAuth.helloTarget(nc, keys.hint()); // the hint names our key, so a server in a rotation's grace can prove with it
        } catch (RuntimeException e) {
            throw new Unverified("no_answer"); // no usable key to name (not saved, say): nothing is sent, not even a connect
        }
        Wire w;
        try {
            s.setTcpNoDelay(true);
            s.connect(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), port), CONNECT_MS);
            w = new Wire(s, readMs);
            writeBounded(s, ("GET " + target + " HTTP/1.1\r\nHost: " + addr
                    + "\r\nConnection: keep-alive\r\n\r\n").getBytes(StandardCharsets.US_ASCII), null, deadline);
        } catch (IOException e) {
            throw new Unverified("no_answer");
        }
        byte[] body;
        w.limit(deadline, MAX_HELLO);
        try {
            Head h = readHead(w);
            if (h.status != 200 || h.get("transfer-encoding") != null || h.closes()) throw new Malformed();
            int n = h.contentLength();
            if (n < 0 || n > MAX_HELLO) throw new Malformed(); // checked before anything is allocated for it
            body = readExactly(w, n);
            if (w.buffered()) throw new Malformed(); // the server sent more than its answer
        } catch (SocketTimeoutException | Silent e) {
            throw new Unverified("no_answer");
        } catch (IOException e) {
            throw new Unverified(w.taken() == 0 ? "no_answer" : "no_hello");
        }
        Map<?, ?> j;
        try {
            Object v = Json.parse(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body)).toString());
            if (!(v instanceof Map)) throw new IllegalArgumentException("json");
            j = (Map<?, ?>) v;
        } catch (IOException | IllegalArgumentException e) {
            throw new Unverified("no_hello");
        }
        Object ver = j.get("hermux");
        if (!(ver instanceof Long)) throw new Unverified("no_hello");
        if ((Long) ver < MIN_VERSION) throw new Unverified("old_version");
        String sRole = str(j, "role"), kid = str(j, "kid"), ns = str(j, "ns"), sAddr = str(j, "addr"), proof = str(j, "proof");
        if (sRole == null || kid == null || ns == null || sAddr == null || proof == null) throw new Unverified("no_hello");
        if (!role.equals(sRole) || !LocalAuth.isNonce(ns)) throw new Unverified("bad_proof");
        if (!addr.equals(sAddr)) throw new Unverified("bad_addr");
        String key;
        String want;
        try {
            key = LocalAuth.isKid(kid) ? keys.byKid(kid) : null;
            if (key == null) throw new Unverified("unknown_kid");
            // The MAC is over the address this client dialled, not the server's text (equal here, by the check above).
            want = LocalAuth.mac(key, "server", role, addr, nc, ns, "hello", LocalAuth.EMPTY_HASH);
        } catch (RuntimeException e) {
            throw new Unverified("unknown_kid"); // an unusable key in the key set
        }
        if (!LocalAuth.same(want, proof)) throw new Unverified("bad_proof");
        return new Session(s, w, role, port, key, kid, nc, ns);
    }

    // ---- bounded writes: a socket's read timeout does not apply to writes, so a watchdog closes it at the deadline ----

    private static Timer watchdog;

    private static synchronized Timer watchdog() {
        if (watchdog == null) watchdog = new Timer("local-auth-write", true); // one idle daemon thread, no periodic work
        return watchdog;
    }

    /** Arms {@code t}; if the timer was stopped or its thread died, a fresh timer takes over, once. */
    private static synchronized Timer arm(TimerTask t, long ms) throws IOException {
        try {
            watchdog().schedule(t, ms);
        } catch (IllegalStateException dead) {
            watchdog = null;
            try {
                watchdog().schedule(t, ms);
            } catch (IllegalStateException again) {
                throw new IOException("no answer");
            }
        }
        return watchdog;
    }

    /** Writes {@code head} then {@code body}, or fails with a timeout once {@code deadline} (System.nanoTime) passes. */
    private static void writeBounded(final Socket s, byte[] head, byte[] body, long deadline) throws IOException {
        long ms = (deadline - System.nanoTime()) / 1_000_000L;
        if (ms <= 0) throw new SocketTimeoutException();
        final AtomicBoolean fired = new AtomicBoolean();
        TimerTask t = new TimerTask() {
            @Override public void run() { fired.set(true); closeQuietly(s); }
        };
        Timer timer = arm(t, ms);
        try {
            OutputStream out = s.getOutputStream();
            out.write(head);
            if (body != null && body.length > 0) out.write(body);
            out.flush();
        } catch (IOException e) {
            if (fired.get()) throw new SocketTimeoutException();
            throw e;
        } finally {
            t.cancel();
            timer.purge();
        }
        if (fired.get()) throw new SocketTimeoutException();
    }

    /** A verified connection. It sends exactly one request, then closes; it is not shared between threads. */
    static final class Session implements Closeable {
        private final Socket sock;
        private final Wire wire;
        private final String role, key, kid, nc, ns;
        private final int port;
        private boolean used;

        private Session(Socket sock, Wire wire, String role, int port, String key, String kid, String nc, String ns) {
            this.sock = sock; this.wire = wire; this.role = role; this.port = port; this.key = key; this.kid = kid;
            this.nc = nc; this.ns = ns;
        }

        /** The id of the key this session proved with (for the caller's key bookkeeping, never for logs). */
        String kid() { return kid; }

        /**
         * The verified connection itself, for a caller that writes its one request in its own form (the dashboard's REST
         * calls, whose answers carry their own proof): the session counts as used, nothing is buffered from the server
         * (the hello answer was read exactly, with nothing after it), and the caller closes the socket.
         */
        synchronized Socket handOff() {
            if (used) throw new IllegalStateException("used");
            used = true;
            return sock;
        }

        /**
         * Send {@code method path} with {@code body} (null for none; sent as {@code application/json} when present) and
         * read the answer. A 403 throws {@link Unverified} {@code refused}; a broken or oversized answer throws an
         * {@link IOException} with a neutral message. The session is closed afterwards, whatever happens.
         */
        Answer request(String method, String path, byte[] body) throws IOException {
            return send(method, path, body, false, MAX_ANSWER);
        }

        /** As {@link #request(String, String, byte[])}, with an answer body of at most {@code maxAnswer} bytes. */
        Answer request(String method, String path, byte[] body, int maxAnswer) throws IOException {
            return send(method, path, body, false, maxAnswer);
        }

        /**
         * The request; {@code withNc} names the client nonce in the header too ({@code 1 <kid> <ns> <nc> <mac>}), as the
         * dashboard's token step wants (its guard keeps the server nonce between two routes).
         */
        private synchronized Answer send(String method, String path, byte[] body, boolean withNc, int maxAnswer) throws IOException {
            if (used) throw new IllegalStateException("used");
            used = true;
            try {
                if (!isMethod(method) || !isPath(path) || maxAnswer < 0) throw new IllegalArgumentException("request");
                byte[] b = body == null ? new byte[0] : body;
                String what = method + " " + path;
                String mac = LocalAuth.mac(key, "client", role, LocalAuth.addr(port), nc, ns, what, LocalAuth.sha256hex(b));
                String head = what + " HTTP/1.1\r\nHost: " + LocalAuth.addr(port) + "\r\nX-Hermux-Auth: 1 " + kid + " " + ns + " "
                        + (withNc ? nc + " " : "") + mac + "\r\nContent-Length: " + b.length + "\r\n"
                        + (b.length > 0 ? "Content-Type: application/json\r\n" : "") + "Connection: close\r\n\r\n";
                // One deadline for sending the request and reading its answer.
                long deadline = System.nanoTime() + ANSWER_DEADLINE_MS * 1_000_000L;
                writeBounded(sock, head.getBytes(StandardCharsets.US_ASCII), b, deadline);
                try {
                    wire.limit(deadline, MAX_HEAD);
                    Head h = readHead(wire);
                    if (h.status == 403) throw new Unverified("refused");
                    // 1xx (such as 100 Continue) is refused, not skipped: our servers never send one.
                    if (h.status < 200 || h.get("transfer-encoding") != null) throw new Malformed();
                    int n = h.contentLength();
                    byte[] ab;
                    if (h.status == 204 || h.status == 304) ab = new byte[0];
                    else if (n >= 0) {
                        if (n > maxAnswer) throw new TooMuch();
                        wire.limit(deadline, n);
                        ab = readExactly(wire, n);
                    } else {
                        wire.limit(deadline, maxAnswer);
                        ab = readToEnd(wire);
                    }
                    return new Answer(h.status, ab);
                } catch (TooMuch e) {
                    throw new IOException("answer too large");
                } catch (Silent e) {
                    throw new IOException("no answer");
                } catch (Malformed e) {
                    throw new IOException("bad answer");
                }
            } finally {
                close();
            }
        }

        @Override public void close() { closeQuietly(sock); }
    }

    // ---- the dashboard's token step ----

    /** The dashboard guard's token route, asked on the hello's own connection. */
    static final String TOKEN_PATH = "/hermux/token";
    /** The longest session token taken: 1 to this many printable ASCII characters without spaces. */
    static final int MAX_TOKEN = 512;

    /**
     * The session token of the dashboard on {@code 127.0.0.1:port}, from a verified dashboard only (the Java twin of
     * {@code local_auth.dashboard_token} and {@code hm-local token}): the hello (role {@code dashboard}), then
     * {@code GET /hermux/token} on the same connection with {@code X-Hermux-Auth: 1 <kid> <ns> <nc> <mac>}, then the
     * answer's own proof ({@code answer}, what {@code token}, over both nonces and the SHA-256 of the token) before the
     * token is returned. A failed hello, a refused request or a wrong proof throws {@link Unverified}; any answer other
     * than a 200 with {@code hermux}, {@code token} and {@code proof} throws an {@link IOException} {@code bad answer},
     * like a broken answer to {@link Session#request}. Nothing else escapes.
     */
    static String dashboardToken(int port, KeySet keys) throws IOException {
        Session s = open("dashboard", port, keys);
        String key = s.key, nc = s.nc, ns = s.ns;
        Answer a;
        try {
            a = s.send("GET", TOKEN_PATH, null, true, MAX_ANSWER);
        } catch (IOException e) {
            throw e; // Unverified (refused) included
        } catch (RuntimeException e) {
            throw new IOException("bad answer");
        }
        Map<?, ?> j = a.status == 200 ? object(a.body) : null;
        if (j == null) throw new IOException("bad answer");
        Object ver = j.get("hermux"), tok = j.get("token"), proof = j.get("proof");
        if (!(ver instanceof Long) || (Long) ver < MIN_VERSION || !(tok instanceof String) || !isToken((String) tok)
                || !(proof instanceof String)) throw new IOException("bad answer");
        String want;
        try {
            want = LocalAuth.mac(key, "answer", "dashboard", LocalAuth.addr(port), nc, ns, "token",
                    LocalAuth.sha256hex(((String) tok).getBytes(StandardCharsets.US_ASCII)));
        } catch (RuntimeException e) {
            throw new IOException("bad answer");
        }
        if (!LocalAuth.isHash((String) proof) || !LocalAuth.same(want, (String) proof)) throw new Unverified("bad_proof");
        return (String) tok;
    }

    /** A session token's shape: 1 to {@link #MAX_TOKEN} printable ASCII characters, no space. */
    static boolean isToken(String t) {
        if (t == null || t.isEmpty() || t.length() > MAX_TOKEN) return false;
        for (int i = 0; i < t.length(); i++) if (t.charAt(i) < 0x21 || t.charAt(i) > 0x7e) return false;
        return true;
    }

    /** A JSON object read as strictly as a hello answer (UTF-8, no repeated names), else null. */
    private static Map<?, ?> object(byte[] body) {
        try {
            Object v = Json.parse(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body)).toString());
            return v instanceof Map ? (Map<?, ?>) v : null;
        } catch (IOException | IllegalArgumentException e) {
            return null;
        }
    }

    /** How the app talks to the background host of a {@code bgapp} event: say hello first, the old token header, or not at all. */
    enum BgMode { MAC, TOKEN, NONE }

    /**
     * From the event's {@code auth} and {@code token} (as the event gave them; null when absent): {@code auth} exactly
     * {@code mac} means the plugin started the host with local authentication, so every request opens with a hello whose
     * key is the token ({@link BgMode#MAC}; a token that can't be a key gives {@link BgMode#NONE}); any other value is
     * an older plugin's host, which takes the token in {@code X-HM-Token} ({@link BgMode#TOKEN}). No token, or one over
     * 256 characters: {@link BgMode#NONE}.
     */
    static BgMode bgMode(String auth, String token) {
        if (token == null || token.isEmpty() || token.length() > 256) return BgMode.NONE;
        if (!"mac".equals(auth)) return BgMode.TOKEN;
        try {
            LocalAuth.kid(token);
            return BgMode.MAC;
        } catch (RuntimeException e) {
            return BgMode.NONE;
        }
    }

    /** A key set of one key (the background host's per-start token): its id is the hint, and only that id is known. */
    static KeySet single(final String key) {
        final String kid;
        try {
            kid = LocalAuth.kid(key);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("key");
        }
        return new KeySet() {
            @Override public String byKid(String k) { return LocalAuth.same(k, kid) ? key : null; }
            @Override public String hint() { return kid; }
            @Override public String toString() { return "KeySet"; }
        };
    }

    // ---- the cron ticker's line protocol ----

    /** The ticker's lines, the newline included. */
    static final int MAX_LINE = 256;
    static final int TICKER_CONNECT_MS = 1000;
    /** The whole ticker exchange, however slowly the bytes come. */
    static final int LINE_DEADLINE_MS = 5000;

    /** The ticker's hello line (without its newline): {@code HELLO 1 <nc>}, plus {@code  <kid>} for a hint. */
    static String tickerHello(String nc, String kid) {
        return "HELLO 1 " + nc + (LocalAuth.hint(kid) != null ? " " + kid : "");
    }

    /**
     * Wakes the cron ticker on {@code 127.0.0.1:port} after verifying it (the line protocol, role {@code ticker}):
     * {@code HELLO 1 <nc> <kid>}, then the answer {@code HERMUX 1 ticker <kid> <ns> <addr> <proof>} is checked as a hello
     * answer is (the version, the role and a nonce-shaped {@code ns}, the address dialled, a known kid, the {@code server}
     * proof), and only then {@code POKE 1 <mac>} (the {@code client} MAC with what {@code POKE} and no body) is sent on
     * the same connection, which then closes. Lines of at most {@link #MAX_LINE} bytes ending in a newline, within
     * {@link #LINE_DEADLINE_MS}. Any failure throws {@link Unverified} after sending nothing but the hello line; the key
     * itself never goes on the wire.
     */
    static void poke(int port, KeySet keys) throws Unverified {
        if (port < 1 || port > 65535 || keys == null) throw new IllegalArgumentException("poke");
        long deadline = System.nanoTime() + LINE_DEADLINE_MS * 1_000_000L;
        String addr = LocalAuth.addr(port), nc = LocalAuth.nonce(), hello;
        try {
            hello = tickerHello(nc, keys.hint());
        } catch (RuntimeException e) {
            throw new Unverified("no_answer"); // no usable key to name: nothing is sent, not even a connect
        }
        Socket s = new Socket(Proxy.NO_PROXY);
        try {
            Wire w;
            try {
                s.setTcpNoDelay(true);
                s.connect(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), port), TICKER_CONNECT_MS);
                w = new Wire(s);
                writeBounded(s, (hello + "\n").getBytes(StandardCharsets.US_ASCII), null, deadline);
            } catch (IOException e) {
                throw new Unverified("no_answer");
            }
            String line;
            w.limit(deadline, MAX_LINE);
            try {
                StringBuilder sb = new StringBuilder();
                while (true) {
                    int c = w.next();
                    if (c < 0) throw w.taken() == 0 ? new Silent() : new Malformed();
                    if (c == '\n') break;
                    if (c < 0x20 || c > 0x7e) throw new Malformed();
                    sb.append((char) c);
                }
                if (w.buffered()) throw new Malformed(); // more than the one line
                line = sb.toString();
            } catch (SocketTimeoutException | Silent e) {
                throw new Unverified("no_answer");
            } catch (IOException e) {
                throw new Unverified(w.taken() == 0 ? "no_answer" : "no_hello");
            }
            String[] p = line.split(" ", -1);
            if (p.length != 7 || !"HERMUX".equals(p[0])) throw new Unverified("no_hello");
            if ("0".equals(p[1])) throw new Unverified("old_version");
            if (!LocalAuth.isVersion(p[1])) throw new Unverified("no_hello");
            if (Integer.parseInt(p[1]) < MIN_VERSION) throw new Unverified("old_version");
            if (!"ticker".equals(p[2]) || !LocalAuth.isNonce(p[4])) throw new Unverified("bad_proof");
            if (!addr.equals(p[5])) throw new Unverified("bad_addr");
            String key, want, mac;
            try {
                key = LocalAuth.isKid(p[3]) ? keys.byKid(p[3]) : null;
                if (key == null) throw new Unverified("unknown_kid");
                want = LocalAuth.mac(key, "server", "ticker", addr, nc, p[4], "hello", LocalAuth.EMPTY_HASH);
                mac = LocalAuth.mac(key, "client", "ticker", addr, nc, p[4], "POKE", LocalAuth.EMPTY_HASH);
            } catch (RuntimeException e) {
                throw new Unverified("unknown_kid");
            }
            if (!LocalAuth.isHash(p[6]) || !LocalAuth.same(want, p[6])) throw new Unverified("bad_proof");
            try {
                writeBounded(s, ("POKE 1 " + mac + "\n").getBytes(StandardCharsets.US_ASCII), null, deadline);
            } catch (IOException e) {
                throw new Unverified("no_answer");
            }
        } catch (RuntimeException e) {
            throw new Unverified("no_hello");
        } finally {
            closeQuietly(s);
        }
    }

    // ---- HTTP reading, bounded by bytes and by a deadline ----

    private static class Malformed extends IOException {}
    /** The stream ended before the first byte of an answer. */
    private static final class Silent extends Malformed {}
    private static final class TooMuch extends Malformed {}

    /** A socket's input with a byte budget and a deadline for the current answer. */
    private static final class Wire {
        private final Socket sock;
        private final InputStream in;
        private final byte[] buf = new byte[2048];
        private int pos, lim, left, taken;
        private long deadline;

        private final int readMs;

        Wire(Socket s) throws IOException { this(s, READ_MS); }
        /** {@code readMs}: the longest one read may wait (within the deadline). */
        Wire(Socket s, int readMs) throws IOException { sock = s; in = s.getInputStream(); this.readMs = readMs; }

        void limit(long deadlineNanos, int maxBytes) { deadline = deadlineNanos; left = maxBytes; taken = 0; }
        boolean buffered() { return pos < lim; }
        int left() { return left; }
        int taken() { return taken; }

        /** The next byte, or -1 at the end of the stream; {@link TooMuch} past the budget, a timeout past the deadline. */
        int next() throws IOException {
            if (pos == lim && !fill()) return -1;
            if (left <= 0) throw new TooMuch();
            left--;
            taken++;
            return buf[pos++] & 0xff;
        }

        private boolean fill() throws IOException {
            long ms = (deadline - System.nanoTime()) / 1_000_000L;
            if (ms <= 0) throw new SocketTimeoutException();
            sock.setSoTimeout((int) Math.min(readMs, ms));
            int n = in.read(buf, 0, buf.length);
            if (n <= 0) return false;
            pos = 0;
            lim = n;
            return true;
        }
    }

    private static final class Head {
        int status;
        final Map<String, List<String>> headers = new LinkedHashMap<>();

        String get(String name) {
            List<String> v = headers.get(name);
            return v == null ? null : v.get(0);
        }

        boolean closes() {
            List<String> v = headers.get("connection");
            if (v == null) return false;
            for (String s : v) for (String t : s.split(",")) if (spTab(t).equalsIgnoreCase("close")) return true; // token by token
            return false;
        }

        /** -1 when absent; {@link Malformed} when repeated or not plain digits. */
        int contentLength() throws Malformed {
            List<String> v = headers.get("content-length");
            if (v == null) return -1;
            if (v.size() != 1) throw new Malformed();
            String s = v.get(0);
            if (s.isEmpty() || s.length() > 9) throw new Malformed();
            for (int i = 0; i < s.length(); i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') throw new Malformed();
            return Integer.parseInt(s);
        }
    }

    private static Head readHead(Wire w) throws IOException {
        Head h = new Head();
        String status = line(w, true);
        // "HTTP/1.1 200" or "HTTP/1.1 200 OK"
        if (!status.startsWith("HTTP/1.1 ") || status.length() < 12) throw new Malformed();
        String code = status.substring(9, 12);
        for (int i = 0; i < 3; i++) if (code.charAt(i) < '0' || code.charAt(i) > '9') throw new Malformed();
        if (status.length() > 12 && status.charAt(12) != ' ') throw new Malformed();
        h.status = Integer.parseInt(code);
        int count = 0;
        while (true) {
            String l = line(w, false);
            if (l.isEmpty()) return h;
            if (++count > MAX_HEADERS) throw new Malformed();
            int c = l.indexOf(':');
            if (c <= 0) throw new Malformed();
            String name = l.substring(0, c);
            for (int i = 0; i < name.length(); i++) if (!isToken(name.charAt(i))) throw new Malformed(); // also refuses folded lines
            String value = l.substring(c + 1);
            int a = 0, z = value.length();
            while (a < z && (value.charAt(a) == ' ' || value.charAt(a) == '\t')) a++;
            while (z > a && (value.charAt(z - 1) == ' ' || value.charAt(z - 1) == '\t')) z--;
            String key = name.toLowerCase(java.util.Locale.ROOT);
            List<String> list = h.headers.get(key);
            if (list == null) h.headers.put(key, list = new ArrayList<>());
            list.add(value.substring(a, z));
        }
    }

    /** One line ending in CRLF (a bare LF or a NUL is refused), without the CRLF. */
    private static String line(Wire w, boolean first) throws IOException {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int c = w.next();
            if (c < 0) {
                if (first && w.taken() == 0) throw new Silent();
                throw new Malformed();
            }
            if (c == '\r') {
                if (w.next() != '\n') throw new Malformed();
                return sb.toString();
            }
            if (c == '\n' || c == 0) throw new Malformed();
            sb.append((char) c);
        }
    }

    private static byte[] readExactly(Wire w, int n) throws IOException {
        if (n < 0 || n > w.left()) throw new TooMuch(); // never allocate more than the budget allows
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) {
            int c = w.next();
            if (c < 0) throw new Malformed();
            b[i] = (byte) c;
        }
        return b;
    }

    private static byte[] readToEnd(Wire w) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (int c; (c = w.next()) >= 0; ) o.write(c);
        return o.toByteArray();
    }

    /** {@code s} without surrounding spaces and tabs (only those, as the Python side). */
    private static String spTab(String s) {
        int a = 0, z = s.length();
        while (a < z && (s.charAt(a) == ' ' || s.charAt(a) == '\t')) a++;
        while (z > a && (s.charAt(z - 1) == ' ' || s.charAt(z - 1) == '\t')) z--;
        return s.substring(a, z);
    }

    private static boolean isToken(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || "!#$%&'*+-.^_`|~".indexOf(c) >= 0;
    }

    private static boolean isMethod(String m) {
        if (m == null || m.isEmpty() || m.length() > 16) return false;
        for (int i = 0; i < m.length(); i++) if (m.charAt(i) < 'A' || m.charAt(i) > 'Z') return false;
        return true;
    }

    /** An origin-form path: starts with "/", printable ASCII without spaces, at most {@link #MAX_PATH} characters. */
    private static boolean isPath(String p) {
        if (p == null || p.isEmpty() || p.length() > MAX_PATH || p.charAt(0) != '/') return false;
        for (int i = 0; i < p.length(); i++) if (p.charAt(i) < 0x21 || p.charAt(i) > 0x7e) return false;
        return true;
    }

    private static String str(Map<?, ?> j, String k) {
        Object v = j.get(k);
        return v instanceof String ? (String) v : null;
    }

    private static void closeQuietly(Socket s) {
        try { s.close(); } catch (IOException ignored) { }
    }

    /**
     * A small strict JSON reader (RFC 8259) for hello answers and the test vectors: objects become maps (a repeated name
     * is an error), arrays lists, integers {@code Long}, other numbers {@code Double}, {@code null} {@link #NULL}. Any
     * error, trailing text or nesting deeper than {@link #MAX_DEPTH} throws {@link IllegalArgumentException}.
     */
    static final class Json {
        static final Object NULL = new Object();
        static final int MAX_DEPTH = 32;
        private final String s;
        private int i;

        private Json(String s) { this.s = s; }

        static Object parse(String text) {
            if (text == null) throw new IllegalArgumentException("json");
            Json p = new Json(text);
            p.ws();
            Object v = p.value(0);
            p.ws();
            if (p.i != text.length()) throw new IllegalArgumentException("json");
            return v;
        }

        private Object value(int depth) {
            if (depth > MAX_DEPTH || i >= s.length()) throw new IllegalArgumentException("json");
            char c = s.charAt(i);
            if (c == '{') return object(depth);
            if (c == '[') return array(depth);
            if (c == '"') return string();
            if (c == '-' || (c >= '0' && c <= '9')) return number();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return NULL; }
            throw new IllegalArgumentException("json");
        }

        private Map<String, Object> object(int depth) {
            Map<String, Object> m = new LinkedHashMap<>();
            i++;
            ws();
            if (peek() == '}') { i++; return m; }
            while (true) {
                if (peek() != '"') throw new IllegalArgumentException("json");
                String k = string();
                ws();
                expect(':');
                ws();
                Object v = value(depth + 1);
                if (m.containsKey(k)) throw new IllegalArgumentException("json");
                m.put(k, v);
                ws();
                char c = peek();
                i++;
                if (c == '}') return m;
                if (c != ',') throw new IllegalArgumentException("json");
                ws();
            }
        }

        private List<Object> array(int depth) {
            List<Object> l = new ArrayList<>();
            i++;
            ws();
            if (peek() == ']') { i++; return l; }
            while (true) {
                l.add(value(depth + 1));
                ws();
                char c = peek();
                i++;
                if (c == ']') return l;
                if (c != ',') throw new IllegalArgumentException("json");
                ws();
            }
        }

        private String string() {
            expect('"');
            StringBuilder b = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new IllegalArgumentException("json");
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c < 0x20) throw new IllegalArgumentException("json");
                if (c != '\\') { b.append(c); continue; }
                if (i >= s.length()) throw new IllegalArgumentException("json");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new IllegalArgumentException("json");
                        int u = 0;
                        for (int k = 0; k < 4; k++) {
                            int d = hexDigit(s.charAt(i++)); // ASCII only, as JSON says
                            if (d < 0) throw new IllegalArgumentException("json");
                            u = u * 16 + d;
                        }
                        b.append((char) u);
                        break;
                    default: throw new IllegalArgumentException("json");
                }
            }
        }

        private Object number() {
            int a = i;
            if (peek() == '-') i++;
            if (peek() == '0') i++;
            else if (peek() >= '1' && peek() <= '9') while (peek() >= '0' && peek() <= '9') i++;
            else throw new IllegalArgumentException("json");
            boolean integral = true;
            if (peek() == '.') {
                integral = false;
                i++;
                if (!(peek() >= '0' && peek() <= '9')) throw new IllegalArgumentException("json");
                while (peek() >= '0' && peek() <= '9') i++;
            }
            if (peek() == 'e' || peek() == 'E') {
                integral = false;
                i++;
                if (peek() == '+' || peek() == '-') i++;
                if (!(peek() >= '0' && peek() <= '9')) throw new IllegalArgumentException("json");
                while (peek() >= '0' && peek() <= '9') i++;
            }
            String t = s.substring(a, i);
            if (integral && t.length() <= 18) return Long.parseLong(t);
            return Double.parseDouble(t);
        }

        private char peek() { return i < s.length() ? s.charAt(i) : '\0'; }

        private static int hexDigit(char c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        private void expect(char c) {
            if (peek() != c) throw new IllegalArgumentException("json");
            i++;
        }

        private void ws() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c != ' ' && c != '\t' && c != '\n' && c != '\r') return;
                i++;
            }
        }
    }
}
