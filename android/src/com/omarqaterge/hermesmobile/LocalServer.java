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
 * Transfer-Encoding. Plain Java (no Android classes) so {@code tools/test_local_server.sh} tests it with a JDK; public
 * because {@code bg/BgHost} (another package) uses it. Nothing here logs.
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

    /** One request as read off the connection: the body is the raw bytes the MAC covered. */
    public static final class Request {
        public final String method, target, path, query;
        public final byte[] body;
        public final Auth auth;
        private final Map<String, List<String>> headers;

        Request(String method, String target, Map<String, List<String>> headers, byte[] body, Auth auth) {
            this.method = method; this.target = target; this.headers = headers; this.body = body; this.auth = auth;
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
     * {@code too_large}, {@code refused}) for the caller's diagnostics, never anything the client sent.
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
    public static Request accept(Socket s, String role, String key, String rawHeader, int maxBody) throws IOException {
        if (!LocalAuth.ROLES.contains(role) || key == null || maxBody < 0) throw new IllegalArgumentException("accept");
        In in = new In(s, System.nanoTime() + DEADLINE_MS * 1_000_000L);
        Head h = readHead(in, s);
        if (h == null) return null;
        if (!h.path.equals(HELLO_PATH)) {
            byte[] body = readBody(in, s, h, maxBody);
            String raw = rawHeader == null ? null : h.one(rawHeader);
            boolean ok = raw != null && LocalAuth.same(raw, key);
            return new Request(h.method, h.target, h.headers, body, ok ? Auth.RAW : Auth.NONE);
        }
        String nc = helloNonce(h);
        if (nc == null || h.contentLength != 0 || h.chunked) throw refuse(s, 400, "bad_request");
        if (!isLoopback(s.getLocalAddress())) throw refuse(s, 403, "refused"); // a proof names 127.0.0.1 only
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
        Head r = readHead(in, s);
        if (r == null) return null;
        byte[] body = readBody(in, s, r, maxBody);
        if (!macOk(r.one(AUTH_HEADER), key, role, addr, nc, ns, kid, r.method + " " + r.target, body)) throw refuse(s, 403, "refused");
        return new Request(r.method, r.target, r.headers, body, Auth.MAC);
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

    /** The client nonce of {@code GET /hermux/hello?v=<n>&nc=<nonce>} (exactly these two arguments), else null. */
    private static String helloNonce(Head h) {
        if (!"GET".equals(h.method)) return null;
        String v = null, nc = null;
        for (String part : h.query.split("&", -1)) {
            int e = part.indexOf('=');
            if (e < 0) return null;
            String k = part.substring(0, e), val = part.substring(e + 1);
            if (k.equals("v") && v == null) v = val;
            else if (k.equals("nc") && nc == null) nc = val;
            else return null;
        }
        if (v == null || nc == null || !isVersion(v) || !LocalAuth.isNonce(nc)) return null;
        return nc;
    }

    private static boolean isVersion(String v) {
        if (v.isEmpty() || v.length() > 3 || v.charAt(0) == '0') return false;
        for (int i = 0; i < v.length(); i++) if (v.charAt(i) < '0' || v.charAt(i) > '9') return false;
        return true;
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
        try {
            answer(s.getOutputStream(), code, "application/json",
                    ("{\"ok\":false,\"error\":\"" + msg + "\"}").getBytes(StandardCharsets.US_ASCII));
        } catch (IOException ignored) { }
        return new Refused(why);
    }

    // ---- reading, bounded by bytes and by the connection's deadline ----

    private static final class In {
        private final Socket sock;
        private final InputStream in;
        private final long deadline;
        private final byte[] buf = new byte[2048];
        private int pos, lim, left;

        In(Socket s, long deadline) throws IOException { sock = s; in = s.getInputStream(); this.deadline = deadline; }

        void budget(int n) { left = n; }

        /** The next byte; -1 at the end of the stream; -2 past the byte budget; a timeout past the deadline. */
        int next() throws IOException {
            if (left <= 0) return -2;
            if (pos == lim) {
                long ms = (deadline - System.nanoTime()) / 1_000_000L;
                if (ms <= 0) throw new SocketTimeoutException();
                sock.setSoTimeout((int) Math.min(READ_MS, ms));
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

        String one(String name) {
            List<String> v = headers.get(name);
            return v != null && v.size() == 1 ? v.get(0) : null;
        }
    }

    /** A request head; null when the stream ends before its first byte. Malformed or too large: {@link Refused}. */
    private static Head readHead(In in, Socket s) throws IOException {
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

    private static byte[] readBody(In in, Socket s, Head h, int maxBody) throws IOException {
        if (h.chunked) throw refuse(s, 400, "bad_request"); // no client of ours sends one
        if (h.contentLength > maxBody) throw refuse(s, 413, "too_large"); // refused before anything is allocated
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
