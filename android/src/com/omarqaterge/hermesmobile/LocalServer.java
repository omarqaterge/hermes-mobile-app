package com.omarqaterge.hermesmobile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The server half of local authentication over HTTP ({@link LocalAuth}; {@link LocalClient} is the client half). A
 * connection to a local server either opens with {@code GET /hermux/hello?v=1&nc=<nonce>}, which {@link #accept} answers
 * itself with a proof over the client's nonce, a fresh server nonce, the server's own listening address
 * ({@code 127.0.0.1:<the socket's local port>}) and the key id, keeping the connection open; then exactly one request
 * may follow on the same connection, and only with {@code X-Hermux-Auth: 1 <kid> <ns> <mac>}, the client MAC over
 * {@code <METHOD> <path with query>} and the SHA-256 of the raw body bytes. The server nonce lives only in this call, so
 * it is used once and nothing can flood a shared table. Or (until the raw key is switched off) a connection carries one
 * request with the raw key in a header the caller names, exactly as before local authentication.
 *
 * <p>Bounded: {@link #READ_MS} per read and {@link #DEADLINE_MS} for everything {@code accept} reads on a connection (so
 * a trickle of bytes cannot hold the server), at most {@link #MAX_HEAD} bytes and {@link #MAX_HEADERS} header lines per
 * request head, a body cap the caller sets (larger is refused unread), CRLF line endings, one Content-Length and no
 * Transfer-Encoding. A caller with more than one route can choose these bounds per request ({@link Policy}, read once the
 * request line is in) and hold more than one key ({@link Keys}: the hello proves with the current one; the raw key may
 * be any key still accepted). Plain Java (no Android classes) so {@code tools/test_local_server.sh} tests it with a
 * JDK; public because {@code bg/BgHost} (another package) uses it. Nothing here logs.
 */
public final class LocalServer {
    private LocalServer() {}

    public static final int READ_MS = 3000;
    /** Everything read on one connection: the hello, then the request's head and body. */
    public static final int DEADLINE_MS = 10_000;
    /** A request line and its headers. */
    public static final int MAX_HEAD = 8192;
    public static final int MAX_HEADERS = 40;
    public static final int MAX_TARGET = 2000;
    public static final String HELLO_PATH = "/hermux/hello";
    public static final String AUTH_HEADER = "x-hermux-auth";

    /** How a request got in: a MAC after a hello, the raw key in the caller's header, or neither (the caller refuses it). */
    public enum Auth { MAC, RAW, NONE }

    /** The keys a server holds: the one its hello proves with, and the raw values it still accepts in the raw header. */
    public interface Keys {
        /** The key the hello proves with when the client names no accepted key (the current key). */
        String proving();
        /** True when {@code value} is a key still accepted raw; compared in constant time. */
        boolean rawOk(String value);
        /** The accepted key with this key id (the hello's hint), else null; a server with one key ignores hints. */
        default String byKid(String kid) { return null; }
        /** A hello named a well-formed key id that is no accepted key (the app's listener then shares its key again). */
        default void foreignHint() { }
    }

    /** A fixed answer: status, type and body. */
    public static final class Answer {
        final int code;
        final String type;
        final byte[] body;
        public Answer(int code, String type, byte[] body) { this.code = code; this.type = type; this.body = body == null ? new byte[0] : body.clone(); }
    }

    /**
     * The bounds of one request, chosen from its method and target once its request line is read: the largest body, the
     * longest single read and the longest the rest of the request may take (both only ever shorten the defaults), and two
     * optional answers in place of the generic ones: {@code early} for a request that got in by nothing (without a hello
     * and without the raw key: written before its body is read; after a hello: written for a missing or wrong MAC), and
     * {@code tooLarge} for a body over the cap (refused before it is read).
     */
    public static final class Limits {
        final int maxBody, readMs;
        final long deadlineMs;
        final Answer early, tooLarge;
        public Limits(int maxBody, int readMs, long deadlineMs, Answer early, Answer tooLarge) {
            if (maxBody < 0 || readMs <= 0 || deadlineMs <= 0) throw new IllegalArgumentException("limits");
            this.maxBody = maxBody; this.readMs = readMs; this.deadlineMs = deadlineMs; this.early = early; this.tooLarge = tooLarge;
        }
    }

    /** Chooses the {@link Limits} of a request from its method and target (never null). */
    public interface Policy { Limits of(String method, String target); }

    /** One request as read off the connection: the body is the raw bytes the MAC covered. */
    public static final class Request {
        public final String method, target, path, query;
        public final byte[] body;
        public final Auth auth;
        /** The key id a {@link Auth#MAC} request was signed under (the current key's); null otherwise. */
        public final String kid;
        private final Map<String, List<String>> headers;

        Request(String method, String target, Map<String, List<String>> headers, byte[] body, Auth auth, String kid) {
            this.method = method; this.target = target; this.headers = headers; this.body = body; this.auth = auth; this.kid = kid;
            int q = target.indexOf('?');
            this.path = q < 0 ? target : target.substring(0, q);
            this.query = q < 0 ? "" : target.substring(q + 1);
        }

        /** A header's value (name in lower case) when it is there exactly once; null when missing or repeated. */
        public String header(String name) {
            List<String> v = headers.get(name);
            return v != null && v.size() == 1 ? v.get(0) : null;
        }
    }

    /**
     * The connection was refused and its error answer already written. {@code why} is a short code ({@code bad_request},
     * {@code too_large}, {@code refused}: a hello or a signed request refused; {@code no_key}: a request without a hello
     * and without the raw key, answered with its {@link Limits} {@code early} answer) for the caller's diagnostics, never
     * anything the client sent.
     */
    public static final class Refused extends IOException {
        public final String why;
        Refused(String why) { super(why); this.why = why; }
    }

    /** The key id of a key ({@link LocalAuth#kid}); IllegalArgumentException for a key too short or not printable ASCII. */
    public static String kid(String key) { return LocalAuth.kid(key); }

    /**
     * Reads one connection for {@code role} with {@code key}. Returns the request to handle (its {@link Request#auth}
     * says how it got in), or null when the client closed without one (after a hello, say: its own checks failed).
     * Throws {@link Refused} after writing a 400, 403 or 413 (a malformed request, a request after a hello without a
     * valid MAC, a body over {@code maxBody}), and other IOExceptions (a timeout included) with nothing written.
     *
     * @param rawHeader lower-case name of the header that may carry the raw key itself; a request without a hello whose
     *                  header equals {@code key} gets {@link Auth#RAW}. Null when the raw key is refused.
     */
    public static Request accept(Socket s, String role, final String key, String rawHeader, int maxBody) throws IOException {
        if (key == null || maxBody < 0) throw new IllegalArgumentException("accept");
        final Limits fixed = new Limits(maxBody, READ_MS, DEADLINE_MS, null, null);
        return accept(s, role, new Keys() {
            @Override public String proving() { return key; }
            @Override public boolean rawOk(String value) { return LocalAuth.same(value, key); }
        }, rawHeader, (m, t) -> fixed);
    }

    /**
     * As above, with a key set and per-request bounds. The hello proves with the accepted key its {@code kid} hint names
     * ({@link Keys#byKid}), else with {@link Keys#proving()} ({@link #helloKey}; chosen once per connection, so a key
     * change mid-connection cannot mix two keys), and the one request must be signed with that same key; a request
     * without a hello whose raw header
     * {@link Keys#rawOk} accepts gets {@link Auth#RAW}. A second hello on one connection is refused (400).
     */
    public static Request accept(Socket s, String role, Keys keys, String rawHeader, Policy policy) throws IOException {
        if (!LocalAuth.ROLES.contains(role) || keys == null || policy == null) throw new IllegalArgumentException("accept");
        In in = new In(s, System.nanoTime() + DEADLINE_MS * 1_000_000L);
        Head h = readHead(in, s, policy, true);
        if (h == null) return null;
        if (!h.path.equals(HELLO_PATH)) {
            String raw = rawHeader == null ? null : h.one(rawHeader);
            boolean ok = raw != null && keys.rawOk(raw);
            if (!ok && h.limits.early != null) throw refuse(s, h.limits.early, "no_key"); // before the body is read
            byte[] body = readBody(in, s, h);
            return new Request(h.method, h.target, h.headers, body, ok ? Auth.RAW : Auth.NONE, null);
        }
        String[] args = "GET".equals(h.method) ? LocalAuth.helloArgs(h.query) : null;
        if (args == null || h.contentLength != 0 || h.chunked) throw refuse(s, 400, "bad_request");
        String nc = args[0];
        if (!isLoopback(s.getLocalAddress())) throw refuse(s, 403, "refused"); // a proof names 127.0.0.1 only
        String key;
        try {
            key = helloKey(keys, args[1]);
        } catch (IllegalArgumentException e) {
            throw refuse(s, 403, "refused");
        }
        String addr = LocalAuth.addr(s.getLocalPort());
        String ns = LocalAuth.nonce(), kid, proof;
        try {
            kid = LocalAuth.kid(key);
            proof = LocalAuth.mac(key, "server", role, addr, nc, ns, "hello", LocalAuth.EMPTY_HASH);
        } catch (IllegalArgumentException e) {
            throw refuse(s, 403, "refused"); // no usable key: no proof
        }
        byte[] json = ("{\"hermux\":1,\"role\":\"" + role + "\",\"kid\":\"" + kid + "\",\"ns\":\"" + ns + "\",\"addr\":\"" + addr
                + "\",\"proof\":\"" + proof + "\"}").getBytes(StandardCharsets.US_ASCII);
        write(s.getOutputStream(), "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + json.length
                + "\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n", json);
        Head r = readHead(in, s, policy, false);
        if (r == null) return null;
        if (r.path.equals(HELLO_PATH)) throw refuse(s, 400, "bad_request"); // one hello per connection
        byte[] body = readBody(in, s, r);
        if (!macOk(r.one(AUTH_HEADER), key, role, addr, nc, ns, kid, r.method + " " + r.target, body)) {
            if (r.limits.early != null) throw refuse(s, r.limits.early, "refused");
            throw refuse(s, 403, "refused");
        }
        return new Request(r.method, r.target, r.headers, body, Auth.MAC, kid);
    }

    /** {@code 1 <kid> <ns> <mac>}: this connection's kid and server nonce, and the client MAC over what and the body. */
    static boolean macOk(String header, String key, String role, String addr, String nc, String ns, String kid, String what, byte[] body) {
        if (header == null || header.length() > 256) return false;
        String[] p = header.split(" ", -1);
        if (p.length != 4 || !"1".equals(p[0]) || !LocalAuth.isKid(p[1]) || !LocalAuth.isNonce(p[2]) || !LocalAuth.isHash(p[3])) return false;
        String want;
        try {
            want = LocalAuth.mac(key, "client", role, addr, nc, ns, what, LocalAuth.sha256hex(body));
        } catch (IllegalArgumentException e) {
            return false; // a target outside the MAC's alphabet: it can never have been signed
        }
        // Every comparison runs, whatever the first one says.
        boolean ok = LocalAuth.same(p[1], kid);
        ok &= LocalAuth.same(p[2], ns);
        ok &= LocalAuth.same(p[3], want);
        return ok;
    }

    /**
     * The key a hello proves with: the accepted key whose id is the client's {@code hint} (current, or previous within its
     * grace), else the current key (a client with an unknown key then sees {@code unknown_kid}, as without a hint).
     */
    static String helloKey(Keys keys, String hint) {
        String h = LocalAuth.hint(hint);
        String k = h == null ? null : keys.byKid(h);
        if (k != null && LocalAuth.same(LocalAuth.kid(k), h)) return k;
        if (h != null) keys.foreignHint();
        return keys.proving();
    }

    static boolean isLoopback(InetAddress a) {
        byte[] b = a == null ? null : a.getAddress();
        return b != null && b.length == 4 && b[0] == 127 && b[1] == 0 && b[2] == 0 && b[3] == 1;
    }

    /** Writes an answer and asks the client to close: HTTP/1.1, the type, the length (none for 204), the body. */
    public static void answer(OutputStream out, int code, String type, byte[] body) throws IOException {
        byte[] b = body == null ? new byte[0] : body;
        StringBuilder h = new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        if (code != 204) h.append("Content-Type: ").append(type).append("\r\nContent-Length: ").append(b.length).append("\r\n");
        h.append("Cache-Control: no-store\r\nConnection: close\r\n\r\n");
        write(out, h.toString(), code == 204 ? new byte[0] : b);
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 413: return "Payload Too Large";
            default: return "X";
        }
    }

    private static void write(OutputStream out, String head, byte[] body) throws IOException {
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static Refused refuse(Socket s, int code, String why) {
        String msg = code == 403 ? "forbidden" : code == 413 ? "too large" : "bad request";
        return refuse(s, new Answer(code, "application/json", ("{\"ok\":false,\"error\":\"" + msg + "\"}").getBytes(StandardCharsets.US_ASCII)), why);
    }

    private static Refused refuse(Socket s, Answer a, String why) {
        try {
            answer(s.getOutputStream(), a.code, a.type, a.body);
        } catch (IOException ignored) { }
        return new Refused(why);
    }

    // ---- reading, bounded by bytes and by the connection's deadline ----

    private static final class In {
        private final Socket sock;
        private final InputStream in;
        private long deadline;
        private int readMs = READ_MS;
        private final byte[] buf = new byte[2048];
        private int pos, lim, left;

        In(Socket s, long deadline) throws IOException { sock = s; in = s.getInputStream(); this.deadline = deadline; }

        void budget(int n) { left = n; }

        /** Shorter bounds for the rest of this request: they only ever tighten. */
        void tighten(Limits l) {
            readMs = Math.min(readMs, l.readMs);
            deadline = Math.min(deadline, System.nanoTime() + l.deadlineMs * 1_000_000L);
        }

        /** The next byte; -1 at the end of the stream; -2 past the byte budget; a timeout past the deadline. */
        int next() throws IOException {
            if (left <= 0) return -2;
            if (pos == lim) {
                long ms = (deadline - System.nanoTime()) / 1_000_000L;
                if (ms <= 0) throw new SocketTimeoutException();
                sock.setSoTimeout((int) Math.min(readMs, ms));
                int n = in.read(buf, 0, buf.length);
                if (n <= 0) return -1;
                pos = 0;
                lim = n;
            }
            left--;
            return buf[pos++] & 0xff;
        }
    }

    private static final class Head {
        String method, target, path, query;
        final Map<String, List<String>> headers = new LinkedHashMap<>();
        int contentLength;
        boolean chunked;
        /** This request's bounds; null only for the hello that opens a connection (it has no body). */
        Limits limits;

        String one(String name) {
            List<String> v = headers.get(name);
            return v != null && v.size() == 1 ? v.get(0) : null;
        }
    }

    /**
     * A request head; null when the stream ends before its first byte. Malformed or too large: {@link Refused}. Once the
     * request line is in, the policy's bounds apply to the rest of it (not to a connection's opening hello).
     */
    private static Head readHead(In in, Socket s, Policy policy, boolean first) throws IOException {
        in.budget(MAX_HEAD);
        String line = line(in, s, true);
        if (line == null) return null;
        Head h = new Head();
        int a = line.indexOf(' '), b = line.lastIndexOf(' ');
        if (a <= 0 || b <= a) throw refuse(s, 400, "bad_request");
        h.method = line.substring(0, a);
        h.target = line.substring(a + 1, b);
        String version = line.substring(b + 1);
        if (!isMethod(h.method) || !isTarget(h.target) || !(version.equals("HTTP/1.1") || version.equals("HTTP/1.0")))
            throw refuse(s, 400, "bad_request");
        int q = h.target.indexOf('?');
        h.path = q < 0 ? h.target : h.target.substring(0, q);
        h.query = q < 0 ? "" : h.target.substring(q + 1);
        if (!(first && h.path.equals(HELLO_PATH))) {
            h.limits = policy.of(h.method, h.target);
            if (h.limits == null) throw refuse(s, 400, "bad_request");
            in.tighten(h.limits);
        }
        int count = 0;
        while (true) {
            String l = line(in, s, false);
            if (l.isEmpty()) break;
            if (++count > MAX_HEADERS) throw refuse(s, 400, "bad_request");
            int c = l.indexOf(':');
            if (c <= 0) throw refuse(s, 400, "bad_request");
            String name = l.substring(0, c);
            for (int i = 0; i < name.length(); i++) if (!isToken(name.charAt(i))) throw refuse(s, 400, "bad_request"); // also a folded line
            String value = l.substring(c + 1);
            int x = 0, z = value.length();
            while (x < z && (value.charAt(x) == ' ' || value.charAt(x) == '\t')) x++;
            while (z > x && (value.charAt(z - 1) == ' ' || value.charAt(z - 1) == '\t')) z--;
            String key = name.toLowerCase(Locale.ROOT);
            List<String> list = h.headers.get(key);
            if (list == null) h.headers.put(key, list = new ArrayList<>());
            list.add(value.substring(x, z));
        }
        List<String> cl = h.headers.get("content-length");
        if (cl != null) {
            if (cl.size() != 1 || !digits(cl.get(0))) throw refuse(s, 400, "bad_request");
            h.contentLength = Integer.parseInt(cl.get(0));
        }
        h.chunked = h.headers.containsKey("transfer-encoding");
        for (Map.Entry<String, List<String>> e : h.headers.entrySet()) e.setValue(Collections.unmodifiableList(e.getValue()));
        return h;
    }

    private static byte[] readBody(In in, Socket s, Head h) throws IOException {
        if (h.chunked) throw refuse(s, 400, "bad_request"); // no client of ours sends one
        if (h.contentLength > h.limits.maxBody) // refused before anything is allocated
            throw h.limits.tooLarge != null ? refuse(s, h.limits.tooLarge, "too_large") : refuse(s, 413, "too_large");
        byte[] body = new byte[h.contentLength];
        in.budget(h.contentLength);
        for (int i = 0; i < body.length; i++) {
            int c = in.next();
            if (c < 0) throw refuse(s, 400, "bad_request"); // ended early
            body[i] = (byte) c;
        }
        return body;
    }

    /** One line ending in CRLF, without it; ASCII printable and tabs only. Null at the very start of a closed stream. */
    private static String line(In in, Socket s, boolean first) throws IOException {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int c = in.next();
            if (c == -2) throw refuse(s, 400, "bad_request"); // the head is over MAX_HEAD
            if (c == -1) {
                if (first && sb.length() == 0) return null;
                throw refuse(s, 400, "bad_request");
            }
            if (c == '\r') {
                if (in.next() != '\n') throw refuse(s, 400, "bad_request");
                return sb.toString();
            }
            if ((c < 0x20 && c != '\t') || c > 0x7e) throw refuse(s, 400, "bad_request"); // a bare LF or NUL too
            sb.append((char) c);
        }
    }

    private static boolean digits(String v) {
        if (v.isEmpty() || v.length() > 9) return false;
        for (int i = 0; i < v.length(); i++) if (v.charAt(i) < '0' || v.charAt(i) > '9') return false;
        return true;
    }

    private static boolean isToken(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || "!#$%&'*+-.^_`|~".indexOf(c) >= 0;
    }

    private static boolean isMethod(String m) {
        if (m.isEmpty() || m.length() > 16) return false;
        for (int i = 0; i < m.length(); i++) if (m.charAt(i) < 'A' || m.charAt(i) > 'Z') return false;
        return true;
    }

    private static boolean isTarget(String t) {
        if (t.isEmpty() || t.length() > MAX_TARGET || t.charAt(0) != '/') return false;
        for (int i = 0; i < t.length(); i++) if (t.charAt(i) < 0x21 || t.charAt(i) > 0x7e) return false;
        return true;
    }
}
