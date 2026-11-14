#!/bin/bash
# Tests the app's own clients of local servers with a plain JDK (android/.../LocalDashboard.java, and LocalClient.java's
# dashboardToken and poke): the dashboard's token step against fake dashboards (honest, another key, another address,
# silent, garbage, an answer with bytes after it, a token proof over the wrong hash), after which a server that failed
# must have received nothing but the hello; REST answers over loopback sockets (a valid proof, a missing one, one over
# another status, one over an earlier nonce, an unknown kid, two proof headers, no token at all, a body that streams);
# the decision of what the user sees (LocalDashboard.Watch) as a table; the cron ticker's line protocol against fake
# tickers and, when python3 is there, against the plugin's own server halves (local_auth.py: the guard's token step and
# ticker_serve_one); the nonce check of PluginSync's result receiver; the alert's page script and the wording. Needs
# javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/LocalAuth.java android/src/com/omarqaterge/hermesmobile/LocalClient.java \
  android/src/com/omarqaterge/hermesmobile/LocalDashboard.java "$T/src/com/omarqaterge/hermesmobile/"
# The plugin's own server halves, played by Python (stdlib only) when it is there.
cat > "$T/servers.py" <<'PY'
import socket, sys
plugin, tools, mode, key, other = sys.argv[1:6]
sys.path.insert(0, plugin)
sys.path.insert(0, tools)
import local_auth as la
if mode == "token":
    import local_auth_cases as lac, json
    V = json.load(open(tools + "/local-auth-vectors.json"))
    ts = lac.TokenServer(la, key, other, V["token_cases"][0])
    print(ts.port, flush=True)
    ts.done.wait(10)
    print("header_ok", ts.header_ok, flush=True)
else:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    port = s.getsockname()[1]
    print(port, flush=True)
    s.settimeout(10)
    c, _ = s.accept()
    r = la.ticker_serve_one(c, key, la.server_addr("127.0.0.1", port), legacy=True)
    c.close()
    print("result", r or "-", flush=True)
PY
cat > "$T/src/com/omarqaterge/hermesmobile/LocalDashboardTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LocalDashboardTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static final String KEY = "7d2f9a41c6e08b35f14a9e62d07c8b3a5e91f40d26b7c8e3";
    static final String OTHER = "0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778";
    static final String KID = LocalAuth.kid(KEY);
    static final LocalClient.KeySet KEYS = LocalClient.single(KEY);
    static final String TOKEN = "dashboard-session-token-0123456789";
    static final String SECRET = "{\"secret\":\"memory edit\"}";

    interface Behave { void run(Socket c, Fake f) throws Exception; }

    /** A loopback server that records every byte it receives. */
    static final class Fake implements AutoCloseable {
        final ServerSocket ss;
        final int port;
        final ByteArrayOutputStream received = new ByteArrayOutputStream();
        final AtomicInteger connections = new AtomicInteger();
        final CountDownLatch done = new CountDownLatch(1);
        volatile String nc;
        final CountDownLatch go = new CountDownLatch(1);

        Fake(Behave b) throws IOException {
            ss = new ServerSocket();
            ss.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 4);
            port = ss.getLocalPort();
            Thread t = new Thread(() -> {
                try {
                    while (true) {
                        Socket c = ss.accept();
                        connections.incrementAndGet();
                        c.setSoTimeout(8000);
                        try { b.run(c, this); } catch (Exception ignored) { }
                        try {
                            c.setSoTimeout(300);
                            InputStream in = c.getInputStream();
                            byte[] buf = new byte[4096];
                            for (int n; (n = in.read(buf)) > 0; ) record(buf, n);
                        } catch (IOException ignored) { }
                        try { c.close(); } catch (IOException ignored) { }
                        done.countDown();
                    }
                } catch (IOException ignored) { }
            });
            t.setDaemon(true);
            t.start();
        }
        synchronized void record(byte[] b, int n) { received.write(b, 0, n); }
        synchronized String got() { return new String(received.toByteArray(), StandardCharsets.ISO_8859_1); }
        void await() throws InterruptedException { done.await(6, TimeUnit.SECONDS); }
        @Override public void close() throws IOException { ss.close(); }

        /** One request: {head, body}, recorded; null if the client closed first. */
        String[] read(Socket c) throws IOException {
            InputStream in = c.getInputStream();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            while (!b.toString("ISO-8859-1").contains("\r\n\r\n")) {
                int x = in.read();
                if (x < 0) return null;
                b.write(x);
                record(new byte[] {(byte) x}, 1);
            }
            String head = b.toString("ISO-8859-1");
            Matcher m = Pattern.compile("(?i)\r\ncontent-length: *(\\d+)").matcher(head);
            int n = m.find() ? Integer.parseInt(m.group(1)) : 0;
            byte[] body = new byte[n];
            for (int i = 0; i < n; i++) {
                int x = in.read();
                if (x < 0) break;
                body[i] = (byte) x;
                record(new byte[] {(byte) x}, 1);
            }
            return new String[] {head.substring(0, head.length() - 4), new String(body, StandardCharsets.ISO_8859_1)};
        }

        /** One line of the ticker protocol, recorded; null at the end of the stream. */
        String line(Socket c) throws IOException {
            InputStream in = c.getInputStream();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            for (int x; (x = in.read()) >= 0; ) {
                record(new byte[] {(byte) x}, 1);
                if (x == '\n') return b.toString("ISO-8859-1");
                b.write(x);
            }
            return null;
        }
    }

    static byte[] http(String status, String headers, String body) {
        return ("HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + body.getBytes(StandardCharsets.UTF_8).length
                + "\r\n" + headers + "\r\n" + body).getBytes(StandardCharsets.UTF_8);
    }

    static String ncOf(String head) {
        Matcher m = Pattern.compile("^GET /hermux/hello\\?v=1&nc=([0-9a-f]{32})(&kid=[0-9a-f]{8})? HTTP/1\\.1\r\n").matcher(head + "\r\n");
        return m.find() ? m.group(1) : null;
    }

    /** A fake dashboard: the hello (key, address, extra bytes as given), then the token step, then the token answer. */
    static Behave dashboard(String key, String addr, String afterHello, String tokenProofOver) {
        return (c, f) -> {
            String[] r = f.read(c);
            if (r == null) return;
            String nc = ncOf(r[0]), ns = LocalAuth.nonce(), where = addr != null ? addr : "127.0.0.1:" + f.port;
            String j = "{\"hermux\":1,\"role\":\"dashboard\",\"kid\":\"" + LocalAuth.kid(key) + "\",\"ns\":\"" + ns + "\",\"addr\":\"" + where
                    + "\",\"proof\":\"" + LocalAuth.mac(key, "server", "dashboard", where, nc, ns, "hello", LocalAuth.EMPTY_HASH) + "\"}";
            OutputStream out = c.getOutputStream();
            // One write, so the extra bytes arrive with the answer (bytes that come later look like the next answer).
            byte[] ans = http("200 OK", "", j), extra = afterHello == null ? new byte[0] : afterHello.getBytes(StandardCharsets.ISO_8859_1);
            byte[] both = Arrays.copyOf(ans, ans.length + extra.length);
            System.arraycopy(extra, 0, both, ans.length, extra.length);
            out.write(both);
            out.flush();
            String[] r2 = f.read(c);
            if (r2 == null) return;
            String proof = LocalAuth.mac(key, "answer", "dashboard", where, nc, ns, "token",
                    LocalAuth.sha256hex(tokenProofOver.getBytes(StandardCharsets.US_ASCII)));
            out.write(http("200 OK", "", "{\"hermux\":1,\"token\":\"" + TOKEN + "\",\"proof\":\"" + proof + "\"}"));
            out.flush();
        };
    }

    static String token(Fake f) {
        try { return "token " + LocalClient.dashboardToken(f.port, KEYS); }
        catch (LocalClient.Unverified e) { return e.why; }
        catch (IOException e) { return "error " + e.getMessage(); }
    }

    /** Only the hello reached the server: no token request, no X-Hermux-Auth, no key. */
    static boolean onlyHello(Fake f) {
        String g = f.got();
        return g.startsWith("GET /hermux/hello?") && !g.contains("/hermux/token") && !g.contains("X-Hermux-Auth") && !g.contains(KEY);
    }

    static void tokenCase(String name, Behave b, String want, boolean helloOnly) throws Exception {
        try (Fake f = new Fake(b)) {
            String got = token(f);
            f.await();
            check(want.equals(got), "token: " + name + ": " + want + (want.equals(got) ? "" : " (got " + got + ")"));
            if (helloOnly) check(onlyHello(f), "token: " + name + ": nothing but the hello was sent");
            check(!f.got().contains(KEY), "token: " + name + ": the key itself was never sent");
        }
    }

    // ---- REST ----

    /** A fake dashboard REST server; {@code proof} makes the X-Hermux-Proof line(s) from the request's nonce. */
    interface Proof { String make(String nc, int port); }

    /** Reads a hello and answers it as a dashboard with {@code key} naming {@code addr} (null: its own); the client nonce. */
    static String hello(Socket c, Fake f, String key, String addr) throws IOException {
        String[] r = f.read(c);
        if (r == null) return null;
        String nc = ncOf(r[0]), ns = LocalAuth.nonce(), where = addr != null ? addr : "127.0.0.1:" + f.port;
        if (nc == null) return null;
        String j = "{\"hermux\":1,\"role\":\"dashboard\",\"kid\":\"" + LocalAuth.kid(key) + "\",\"ns\":\"" + ns + "\",\"addr\":\"" + where
                + "\",\"proof\":\"" + LocalAuth.mac(key, "server", "dashboard", where, nc, ns, "hello", LocalAuth.EMPTY_HASH) + "\"}";
        c.getOutputStream().write(http("200 OK", "", j));
        c.getOutputStream().flush();
        return nc;
    }

    /** An honest dashboard: the hello, then the REST request on the same connection, answered with {@code proof}. */
    static Behave rest(String status, Proof proof, String body) {
        return (c, f) -> {
            if (hello(c, f, KEY, null) == null) return;
            String[] r = f.read(c);
            if (r == null) return;
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})(\r\n|$)").matcher(r[0]);
            String nc = m.find() ? m.group(1) : null;
            f.nc = nc;
            String extra = proof == null ? "" : proof.make(nc, f.port);
            c.getOutputStream().write(http(status, extra, body));
            c.getOutputStream().flush();
        };
    }

    static String restProof(String key, String nc, int port, int status) {
        return "X-Hermux-Proof: 1 " + LocalAuth.kid(key) + " " + LocalAuth.mac(key, "answer", "dashboard", LocalAuth.addr(port), nc, "-",
                "rest " + status, LocalAuth.EMPTY_HASH) + "\r\n";
    }

    static String call(Fake f, String token) { return call(f, token, false); }

    /** {@code waitLong}: an answer from a notification (the long hello). */
    static String call(Fake f, String token, boolean waitLong) {
        try {
            String[] r = LocalDashboard.call(f.port, KEYS, "POST", "/api/plugins/hermes-mobile/memory", token, SECRET, 5000, waitLong);
            return "ok " + r[0] + " " + r[1];
        } catch (LocalDashboard.NotVerified e) { return "dropped " + e.getMessage(); }
        catch (IOException e) { return "error " + e.getMessage(); }
    }

    static void restCase(String name, Behave b, String want) throws Exception {
        try (Fake f = new Fake(b)) {
            String got = call(f, TOKEN);
            check(want.equals(got), "rest: " + name + ": " + want + (want.equals(got) ? "" : " (got " + got + ")"));
            f.await();
            String g = f.got();
            check(g.contains("\r\nX-Hermux-Nonce: ") && g.contains("\r\nX-Hermes-Session-Token: " + TOKEN + "\r\n") && !g.contains(KEY),
                    "rest: " + name + ": the request carried a nonce and the token, never the key");
        }
    }

    // ---- ticker ----

    static Behave ticker(String key, String role, String addr, String version) {
        return (c, f) -> {
            String hello = f.line(c);
            if (hello == null) return;
            String[] p = hello.split(" ");
            String nc = p.length >= 3 ? p[2] : "", ns = LocalAuth.nonce(), where = addr != null ? addr : "127.0.0.1:" + f.port;
            String proof = LocalAuth.mac(key, "server", "ticker", where, nc, ns, "hello", LocalAuth.EMPTY_HASH);
            OutputStream out = c.getOutputStream();
            out.write(("HERMUX " + version + " " + role + " " + LocalAuth.kid(key) + " " + ns + " " + where + " " + proof + "\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String poke = f.line(c);
            String want = "POKE 1 " + LocalAuth.mac(key, "client", "ticker", where, nc, ns, "POKE", LocalAuth.EMPTY_HASH);
            if (poke != null && poke.equals(want)) f.nc = "poked";
        };
    }

    static void tickerCase(String name, Behave b, String want) throws Exception {
        try (Fake f = new Fake(b)) {
            String got;
            try { LocalClient.poke(f.port, KEYS); got = "poked"; }
            catch (LocalClient.Unverified e) { got = e.why; }
            f.await();
            check(want.equals(got), "ticker: " + name + ": " + want + (want.equals(got) ? "" : " (got " + got + ")"));
            String g = f.got();
            check(g.startsWith("HELLO 1 ") && !g.contains(KEY), "ticker: " + name + ": opens with the hello line, never the key");
            if (want.equals("poked")) check("poked".equals(f.nc), "ticker: " + name + ": the server saw a valid POKE");
            else check(!g.contains("POKE"), "ticker: " + name + ": no POKE after a failed hello");
        }
    }

    /** Runs tools' Python helper; null when python3 isn't there. */
    static Process python(String mode, String key, String other) {
        try {
            ProcessBuilder pb = new ProcessBuilder("python3", System.getProperty("servers"), "hermes-plugin/hermes-mobile", "tools", mode, key, other);
            pb.redirectErrorStream(true);
            return pb.start();
        } catch (IOException e) {
            return null;
        }
    }

    public static void main(String[] a) throws Exception {
        // ---- the dashboard's token step ----
        tokenCase("an honest dashboard", dashboard(KEY, null, null, TOKEN), "token " + TOKEN, false);
        tokenCase("a dashboard with another key", dashboard(OTHER, null, null, TOKEN), "unknown_kid", true);
        tokenCase("a dashboard naming another address", dashboard(KEY, "127.0.0.1:9229", null, TOKEN), "bad_addr", true);
        tokenCase("a token proof over another token's hash", dashboard(KEY, null, null, TOKEN + "-other"), "bad_proof", false);
        tokenCase("a hello answer with bytes after it", dashboard(KEY, null, "HTTP/1.1 200 OK\r\n", TOKEN), "no_hello", true);
        tokenCase("a server that never answers", (c, f) -> { f.read(c); Thread.sleep(6500); }, "no_answer", true);
        tokenCase("a server that answers garbage", (c, f) -> {
            f.read(c);
            c.getOutputStream().write("SSH-2.0-OpenSSH\r\n".getBytes(StandardCharsets.US_ASCII));
            c.getOutputStream().flush();
        }, "no_hello", true);
        tokenCase("an old page server (HTML, no hello)", (c, f) -> {
            f.read(c);
            c.getOutputStream().write(http("200 OK", "", "<html>window.__HERMES_SESSION_TOKEN__=\"x\";</html>"));
            c.getOutputStream().flush();
        }, "no_hello", true);
        try (ServerSocket closed = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            int port = closed.getLocalPort();
            closed.close();
            String got;
            try { got = LocalClient.dashboardToken(port, KEYS); } catch (LocalClient.Unverified e) { got = e.why; }
            check("no_answer".equals(got), "token: nothing listening: no_answer (" + got + ")");
        }
        // The plugin's own token step (local_auth.py's server half, as the guard runs it), when python3 is there.
        Process p = python("token", KEY, OTHER);
        if (p != null) {
            BufferedReader in = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String first = in.readLine();
            if (first != null && first.matches("\\d+")) {
                String got;
                try { got = LocalClient.dashboardToken(Integer.parseInt(first), KEYS); } catch (IOException e) { got = e.toString(); }
                String last = in.readLine();
                check(TOKEN.equals(got) && "header_ok True".equals(last),
                        "token: against local_auth.py's server half: the token, and the five-field header passed its checks (" + got + ", " + last + ")");
            } else {
                System.out.println("SKIP  token: python3 server half (" + first + ")");
            }
            p.destroy();
        } else {
            System.out.println("SKIP  token: no python3");
        }

        // ---- REST answers ----
        restCase("a valid proof", rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 200), "{\"ok\":true}"), "ok 200 {\"ok\":true}");
        restCase("a valid proof on a 401", rest("401 Unauthorized", (nc, port) -> restProof(KEY, nc, port, 401), "{}"), "ok 401 {}");
        restCase("no proof (an older plugin, or another server)", rest("200 OK", null, "{\"ok\":true}"), "dropped Hermes isn't answering");
        restCase("a proof over another status", rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 500), "{}"), "dropped Hermes isn't answering");
        restCase("a proof over an earlier nonce (replayed)", rest("200 OK", (nc, port) -> restProof(KEY, LocalAuth.nonce(), port, 200), "{}"),
                "dropped Hermes isn't answering");
        restCase("a proof under another key", rest("200 OK", (nc, port) -> restProof(OTHER, nc, port, 200), "{}"), "dropped Hermes isn't answering");
        restCase("a proof over another address", rest("200 OK", (nc, port) -> restProof(KEY, nc, port + 1, 200), "{}"), "dropped Hermes isn't answering");
        restCase("two proof headers", rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 200) + restProof(KEY, nc, port, 200), "{}"),
                "dropped Hermes isn't answering");
        restCase("a proof in upper case", rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 200).toUpperCase().replace("X-HERMUX-PROOF", "X-Hermux-Proof"), "{}"),
                "dropped Hermes isn't answering");
        restCase("garbage instead of HTTP after the hello", (c, f) -> {
            hello(c, f, KEY, null);
            f.read(c);
            c.getOutputStream().write("hello\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            c.getOutputStream().flush();
        }, "dropped Hermes isn't answering");
        try (Fake f = new Fake(rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 200), "{}"))) {
            String got = call(f, "");
            Thread.sleep(200);
            check(got.startsWith("dropped") && f.connections.get() == 0, "rest: no token: nothing is sent, not even a connect (" + got + ")");
            got = call(f, "two words");
            check(got.startsWith("dropped") && f.connections.get() == 0, "rest: a token that would break the header: nothing is sent");
        }
        // Each request has its own nonce.
        final String[] seen = new String[2];
        try (Fake f = new Fake(rest("200 OK", (nc, port) -> restProof(KEY, nc, port, 200), "{}"))) {
            call(f, TOKEN);
            seen[0] = f.nc;
            call(f, TOKEN);
            seen[1] = f.nc;
            check(LocalAuth.isNonce(seen[0]) && LocalAuth.isNonce(seen[1]) && !seen[0].equals(seen[1]), "rest: a fresh nonce for every request");
        }
        // A body that streams: the head (and its proof) come back before the body is all there.
        final CountDownLatch rest = new CountDownLatch(1);
        try (Fake f = new Fake((c, fk) -> {
            hello(c, fk, KEY, null);
            String[] r = fk.read(c);
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})").matcher(r[0]);
            String nc = m.find() ? m.group(1) : "";
            OutputStream out = c.getOutputStream();
            out.write(("HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Length: 10\r\nContent-Range: bytes 0-9/100\r\n"
                    + restProof(KEY, nc, fk.port, 206) + "\r\nfirst").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            rest.await(5, TimeUnit.SECONDS);
            out.write("-last".getBytes(StandardCharsets.US_ASCII));
            out.flush();
        })) {
            LocalDashboard.Reply r = LocalDashboard.open(f.port, KEYS, "GET", "/api/plugins/hermes-mobile/media?path=%2Fa.mp4", TOKEN, null, null, "bytes=0-9", 5000);
            byte[] head = new byte[5];
            int n = 0;
            while (n < 5) n += r.body.read(head, n, 5 - n);
            boolean early = new String(head, StandardCharsets.US_ASCII).equals("first") && rest.getCount() == 1;
            rest.countDown();
            String all = new String(LocalDashboard.readAll(r.body), StandardCharsets.US_ASCII);
            r.close();
            check(early && all.equals("-last") && r.status == 206 && "bytes 0-9/100".equals(r.header("content-range"))
                    && LocalDashboard.mediaHeaders(r).containsKey("Content-Range") && "no-store".equals(LocalDashboard.mediaHeaders(r).get("Cache-Control")),
                    "rest: a streamed body arrives as it is sent, after a verified head (206, its range kept)");
            check(f.got().contains("\r\nRange: bytes=0-9\r\n"), "rest: the player's range is passed on");
        }
        // The token and the body go only on a connection whose hello verified: a server that fails the hello gets
        // nothing but the hello, and an honest one gets the hello, then the request, on one connection.
        Object[][] badHellos = {
            {"another key", (Behave) (c, f) -> { hello(c, f, OTHER, null); f.read(c); }, "unknown_kid"},
            {"another address", (Behave) (c, f) -> { hello(c, f, KEY, "127.0.0.1:9229"); f.read(c); }, "bad_addr"},
            {"an old page server (no hello)", (Behave) (c, f) -> {
                f.read(c);
                c.getOutputStream().write(http("200 OK", "", "<html></html>"));
                c.getOutputStream().flush();
                f.read(c);
            }, "no_hello"},
            {"a 503 from a dashboard without its key", (Behave) (c, f) -> {
                f.read(c);
                c.getOutputStream().write(http("503 Service Unavailable", "", "{\"hermux\":1,\"error\":\"unavailable\"}"));
                c.getOutputStream().flush();
                f.read(c);
            }, "no_hello"},
        };
        for (Object[] bh : badHellos) {
            try (Fake f = new Fake((Behave) bh[1])) {
                String got;
                try {
                    LocalDashboard.call(f.port, KEYS, "POST", "/api/plugins/hermes-mobile/approve", TOKEN, SECRET, 5000);
                    got = "sent";
                } catch (LocalDashboard.NotVerified e) { got = (e.helloFailed ? "hello " : "answer ") + e.why; }
                f.await();
                String g = f.got();
                check(("hello " + bh[2]).equals(got), "rest: a hello from " + bh[0] + ": hello " + bh[2] + " (got " + got + ")");
                check(g.startsWith("GET /hermux/hello?") && !g.contains(TOKEN) && !g.contains("secret") && !g.contains("/api/") && f.connections.get() == 1,
                        "rest: a hello from " + bh[0] + ": nothing but the hello was sent (no token, no body, no second connection)");
            }
        }
        try (Fake f = new Fake(rest("200 OK", (nc2, port) -> restProof(KEY, nc2, port, 200), "{}"))) {
            String got = call(f, TOKEN);
            f.await();
            String g = f.got();
            int h = g.indexOf("GET /hermux/hello?"), t = g.indexOf("X-Hermes-Session-Token: " + TOKEN);
            check(got.equals("ok 200 {}") && h == 0 && t > h && g.indexOf("POST /api/") > h && f.connections.get() == 1,
                    "rest: the hello first, then the token and the body, on one connection");
        }
        // The answer's head has one deadline in all: a server that sends it a byte at a time can't hold the call.
        try (Fake f = new Fake((c, fk) -> {
            hello(c, fk, KEY, null);
            fk.read(c);
            OutputStream out = c.getOutputStream();
            byte[] slow = "HTTP/1.1 200 OK\r\nX-Slow: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".getBytes(StandardCharsets.US_ASCII);
            for (byte x : slow) { out.write(x); out.flush(); Thread.sleep(150); }
        })) {
            long t0 = System.nanoTime();
            String got;
            try { LocalDashboard.call(f.port, KEYS, "GET", "/api/x", TOKEN, null, 1000); got = "answered"; }
            catch (IOException e) { got = "error"; }
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            check(got.equals("error") && ms < 2500, "rest: a head that trickles in is cut at its deadline (" + ms + " ms)");
        }
        // But a slow honest answer still starts within that deadline.
        try (Fake f = new Fake((c, fk) -> {
            hello(c, fk, KEY, null);
            String[] r = fk.read(c);
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})").matcher(r[0]);
            String n2 = m.find() ? m.group(1) : "";
            Thread.sleep(700);
            c.getOutputStream().write(http("200 OK", restProof(KEY, n2, fk.port, 200), "{}"));
            c.getOutputStream().flush();
        })) {
            String got;
            try { got = LocalDashboard.call(f.port, KEYS, "GET", "/api/x", TOKEN, null, 1500)[0]; } catch (IOException e) { got = e.toString(); }
            check("200".equals(got), "rest: an answer that starts late but within the deadline is taken (" + got + ")");
        }

        // An answer with a length on a connection the server keeps open: the call ends at the length, not at a close.
        try (Fake f = new Fake((c, fk) -> {
            hello(c, fk, KEY, null);
            String[] r = fk.read(c);
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})").matcher(r[0]);
            String n2 = m.find() ? m.group(1) : "";
            c.getOutputStream().write(http("200 OK", restProof(KEY, n2, fk.port, 200), "{\"kept\":1}"));
            c.getOutputStream().flush();
            Thread.sleep(4000);
        })) {
            long t0 = System.nanoTime();
            String got;
            try { got = LocalDashboard.call(f.port, KEYS, "GET", "/api/x", TOKEN, null, 3000)[1]; } catch (IOException e) { got = e.toString(); }
            check("{\"kept\":1}".equals(got) && (System.nanoTime() - t0) / 1_000_000L < 2500, "rest: the body is read by its length, without waiting for a close (" + got + ")");
        }
        // A busy dashboard: the REST hello may take longer than the token step's 5 s.
        try (Fake f = new Fake((c, fk) -> {
            Thread.sleep(6000);
            hello(c, fk, KEY, null);
            String[] r = fk.read(c);
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})").matcher(r[0]);
            String n2 = m.find() ? m.group(1) : "";
            c.getOutputStream().write(http("200 OK", restProof(KEY, n2, fk.port, 200), "{}"));
            c.getOutputStream().flush();
        })) {
            check(call(f, TOKEN, true).equals("ok 200 {}"), "rest: an answer from a notification: a hello answered after 6 s (a busy dashboard) is still taken");
        }
        try (Fake f = new Fake((c, fk) -> { Thread.sleep(6000); hello(c, fk, KEY, null); fk.read(c); })) {
            long t0 = System.nanoTime();
            String got = call(f, TOKEN, false);
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            check(got.startsWith("dropped") && ms < 5800 && f.connections.get() == 1 && !f.got().contains(TOKEN),
                    "rest: the page's call keeps the short hello: one try of 5 s, nothing more sent (" + ms + " ms)");
        }
        check(Arrays.equals(LocalDashboard.helloPlan(true), new int[] {30_000, 2}) && Arrays.equals(LocalDashboard.helloPlan(false), new int[] {5000, 1}),
                "rest: the hello plan: 30 s and one more try for answers from a notification, 5 s once for everything else");
        // A hello that gets no answer: one more on a new connection; the body goes only on the verified one.
        final AtomicInteger seenConn = new AtomicInteger();
        try (Fake f = new Fake((c, fk) -> {
            if (seenConn.incrementAndGet() == 1) { fk.read(c); return; } // reads the hello, closes without a word
            hello(c, fk, KEY, null);
            String[] r = fk.read(c);
            Matcher m = Pattern.compile("\r\nX-Hermux-Nonce: ([0-9a-f]{32})").matcher(r[0]);
            String n2 = m.find() ? m.group(1) : "";
            c.getOutputStream().write(http("200 OK", restProof(KEY, n2, fk.port, 200), "{}"));
            c.getOutputStream().flush();
        })) {
            String got = call(f, TOKEN, true);
            Thread.sleep(400);
            String g = f.got();
            int second = g.indexOf("GET /hermux/hello?", 1);
            check(got.equals("ok 200 {}") && f.connections.get() == 2 && second > 0 && g.indexOf("secret") > second
                    && g.lastIndexOf("X-Hermes-Session-Token") > second && g.indexOf("X-Hermes-Session-Token") > second,
                    "rest: a hello with no answer gets one more on a new connection; the token and body only after that one verified");
        }
        final AtomicInteger silentConn = new AtomicInteger();
        try (Fake f = new Fake((c, fk) -> { silentConn.incrementAndGet(); fk.read(c); })) {
            String got = call(f, TOKEN, true);
            Thread.sleep(400);
            check(got.startsWith("dropped") && f.connections.get() == 2 && !f.got().contains(TOKEN) && !f.got().contains("secret"),
                    "rest: two hellos with no answer: given up, nothing but the hellos sent");
        }

        // The token caches: one drop reaches every cache; a refresh or an empty token fetches again.
        AtomicInteger fetches = new AtomicInteger();
        LocalDashboard.Tokens ta = new LocalDashboard.Tokens(), tb = new LocalDashboard.Tokens();
        java.util.function.Supplier<String> fetch = () -> "t" + fetches.incrementAndGet();
        String a1 = ta.get(false, fetch), b1 = tb.get(false, fetch);
        check(ta.get(false, fetch).equals(a1) && tb.get(false, fetch).equals(b1) && fetches.get() == 2, "tokens: kept between calls");
        LocalDashboard.Tokens.dropAll();
        check(!ta.get(false, fetch).equals(a1) && !tb.get(false, fetch).equals(b1) && fetches.get() == 4, "tokens: one drop makes every cache fetch again");
        check(!ta.get(true, fetch).equals(ta.get(false, fetch)) || fetches.get() == 5, "tokens: a refresh fetches again");
        LocalDashboard.Tokens tc = new LocalDashboard.Tokens();
        check(tc.get(false, () -> "").isEmpty() && tc.get(false, () -> "x").equals("x"), "tokens: an empty token is fetched again next time");
        LocalDashboard.Tokens td = new LocalDashboard.Tokens();
        td.get(false, () -> { LocalDashboard.Tokens.dropAll(); return "during"; });
        check(td.get(false, () -> "after").equals("after"), "tokens: a drop during a fetch makes the next call fetch again");

        // proofOk directly
        String nc = LocalAuth.nonce();
        String good = LocalAuth.mac(KEY, "answer", "dashboard", "127.0.0.1:9119", nc, "-", "rest 200", LocalAuth.EMPTY_HASH);
        check(LocalDashboard.proofOk(KEYS, 9119, nc, 200, Collections.singletonList("1 " + KID + " " + good)), "proofOk: the right proof");
        check(!LocalDashboard.proofOk(KEYS, 9119, nc, 200, Collections.<String>emptyList()), "proofOk: none");
        check(!LocalDashboard.proofOk(KEYS, 9119, nc, 200, Collections.singletonList("2 " + KID + " " + good)), "proofOk: another version");
        check(!LocalDashboard.proofOk(KEYS, 9119, nc, 200, Collections.singletonList("1 " + KID + "  " + good)), "proofOk: two spaces");
        check(!LocalDashboard.proofOk(KEYS, 9119, nc, 200, Collections.singletonList("1 00000000 " + good)), "proofOk: an unknown kid");
        check(!LocalDashboard.proofOk(KEYS, 9119, nc, 204, Collections.singletonList("1 " + KID + " " + good)), "proofOk: another status");
        check(!LocalDashboard.proofOk(KEYS, 9119, LocalAuth.nonce(), 200, Collections.singletonList("1 " + KID + " " + good)), "proofOk: another nonce");
        check(!LocalDashboard.proofOk(null, 9119, nc, 200, Collections.singletonList("1 " + KID + " " + good)), "proofOk: no keys");

        // ---- what the user sees (Watch) ----
        LocalDashboard.Plugin H = LocalDashboard.Plugin.HELLO, O = LocalDashboard.Plugin.OLD, U = LocalDashboard.Plugin.UNKNOWN;
        Object[][] table = {
            // why, ms, plugin, updating, expected step   (one Watch through the rows, in order)
            {"no_answer", 0L, H, false, "NONE"},
            {"no_hello", 1_000L, H, false, "SHARE_KEY+10000"},     // first: share the key once, try again in 10 s
            {"SHARED", 1_000L, H, false, "-"},
            {"no_hello", 5_000L, H, false, "NONE"},                // too soon for "twice 10 s apart"
            {"no_hello", 11_000L, H, false, "NONE+10000"},         // twice, but the share was 10 s ago: wait until 20 s after it
            {"no_hello", 15_000L, H, false, "NONE"},               // that try is already asked for
            {"no_hello", 21_000L, H, false, "ALERT+30000"},        // the alert, and a later try so it can clear
            {"no_hello", 51_000L, H, false, "ALERT+60000"},        // still: the next try later
            {"VERIFIED", 52_000L, H, false, "CLEAR"},
            {"no_hello", 53_000L, H, false, "SHARE_KEY+10000"},    // a new episode shares again
            {"no_answer", 54_000L, H, false, "NONE"},              // restarting in between: the count starts again
            {"no_hello", 70_000L, H, false, "NONE+10000"},         // already shared in this episode
            {"no_hello", 80_000L, H, false, "ALERT+30000"},        // twice 10 s apart, the share long enough ago
            {"no_hello", 400_000L, H, false, "NONE+10000"},        // a first one long ago no longer counts
            {"no_hello", 410_000L, H, true, "NONE"},               // a plugin update under way: not an alert
            {"no_hello", 420_000L, O, false, "UPDATE_PLUGIN"},     // a plugin known to be too old: the notice
            {"old_version", 430_000L, O, false, "UPDATE_PLUGIN"},
            {"VERIFIED", 435_000L, H, false, "CLEAR"},
            {"no_hello", 440_000L, U, false, "SHARE_KEY"},         // the plugin isn't known yet: a share, no alert
            {"no_hello", 451_000L, U, false, "NONE"},
            {"bad_addr", 452_000L, H, false, "ALERT+30000"},       // another address: at once
            {"VERIFIED", 453_000L, H, false, "CLEAR"},
            {"bad_proof", 454_000L, H, false, "SHARE_KEY+5000"},   // maybe a stale key: share it, try again in 5 s
            {"SHARED", 454_000L, H, false, "-"},
            {"bad_proof", 456_000L, H, false, "NONE"},             // the key may still be on its way
            {"bad_proof", 459_500L, H, false, "NONE+14500"},       // still wrong at 5 s: one more try at 20 s
            {"bad_proof", 465_000L, H, false, "NONE"},             // that try is already asked for
            {"bad_proof", 474_000L, H, false, "ALERT+30000"},      // still wrong 20 s after the share
            {"VERIFIED", 475_000L, H, false, "CLEAR"},
            {"unknown_kid", 476_000L, H, false, "SHARE_KEY+5000"},
            {"NOT_SHARED", 476_000L, H, false, "-"},
            {"unknown_kid", 481_000L, H, false, "NONE+15000"},
            {"unknown_kid", 500_000L, H, false, "NONE"},           // the key could not be handed over: no alert
            {"VERIFIED", 501_000L, H, false, "CLEAR"},
            {"refused", 502_000L, H, false, "NONE"},               // our own dashboard refused one token step
            {"no_answer", 503_000L, O, false, "NONE"},
            {"bad_proof", 600_000L, H, false, "SHARE_KEY+5000"},   // a second episode: its own share decides
            {"NOT_SHARED", 600_000L, H, false, "-"},
            {"bad_proof", 605_000L, H, false, "NONE+15000"},
            {"bad_proof", 625_000L, H, false, "NONE"},             // an earlier episode's share counts for nothing
        };
        LocalDashboard.Watch w = new LocalDashboard.Watch();
        for (Object[] row : table) {
            String why = (String) row[0];
            String got;
            if (why.equals("VERIFIED")) got = w.verified().toString();
            else if (why.equals("SHARED")) { w.shared(true); got = "-"; }
            else if (why.equals("NOT_SHARED")) { w.shared(false); got = "-"; }
            else got = w.failed(why, (Long) row[1], (LocalDashboard.Plugin) row[2], (Boolean) row[3]).toString();
            check(row[4].equals(got), "watch: " + why + " at " + row[1] + " ms, plugin " + row[2] + (Boolean.TRUE.equals(row[3]) ? " (updating)" : "")
                    + ": " + row[4] + (row[4].equals(got) ? "" : " (got " + got + ")"));
        }
        check(new LocalDashboard.Watch().failed(null, 0, H, false).toString().equals("SHARE_KEY+10000"), "watch: an unnamed reason counts as no_hello");
        // An alert's later tries: each failure at its due time counts and schedules the next; they back off to 5 min
        // and stop after 8.
        LocalDashboard.Watch wa = new LocalDashboard.Watch();
        StringBuilder seq = new StringBuilder();
        long at = 0;
        for (int i = 0; i < 10; i++) {
            LocalDashboard.Watch.Step st = wa.failed("bad_addr", at, H, false);
            seq.append(st).append(' ');
            at += Math.max(st.recheckMs, 1000);
        }
        check(seq.toString().equals("ALERT+30000 ALERT+60000 ALERT+120000 ALERT+240000 ALERT+300000 ALERT+300000 ALERT+300000 ALERT+300000 ALERT ALERT "),
                "watch: an alert's later tries back off to 5 min and stop after 8 (" + seq + ")");
        wa.verified();
        check(wa.failed("bad_addr", 0, H, false).toString().equals("ALERT+30000"), "watch: a verified hello starts the tries again");
        // Failures before a try is due (the page's own calls) don't use it up and don't move it.
        Object[][] due = {
            {"bad_addr", 0L, "ALERT+30000"},      // the alert; a try at 30 s
            {"bad_addr", 1_000L, "ALERT+29000"},  // the page's calls: the same due time, not counted
            {"bad_addr", 2_000L, "ALERT+28000"},
            {"bad_proof", 3_000L, "ALERT+27000"}, // (no share yet in this episode: the stale path shares first)
            {"bad_addr", 29_999L, "ALERT+1"},
            {"bad_addr", 30_000L, "ALERT+60000"}, // the try at its due time: counted, the next one later
            {"bad_addr", 40_000L, "ALERT+50000"},
            {"bad_addr", 90_000L, "ALERT+120000"},
        };
        LocalDashboard.Watch wd = new LocalDashboard.Watch();
        for (Object[] row : due) {
            String got = wd.failed((String) row[0], (Long) row[1], H, false).toString();
            if (row[0].equals("bad_proof")) { check("SHARE_KEY+5000".equals(got), "watch: a stale key during an alert shares first"); continue; }
            check(row[2].equals(got), "watch: " + row[0] + " at " + row[1] + " ms during an alert: " + row[2] + (row[2].equals(got) ? "" : " (got " + got + ")"));
        }

        // which plugin is installed (the app's own knowledge only)
        check(LocalDashboard.plugin("1794062084", "1794062084") == H, "plugin: the APK's own stamp answers the hello");
        check("busy-unknown".equals(LocalDashboard.busyState("unknown")) && "busy".equals(LocalDashboard.busyState("working"))
                && "busy".equals(LocalDashboard.busyState("settled")) && "busy".equals(LocalDashboard.busyState("")) && "busy".equals(LocalDashboard.busyState(null)),
                "plugin: BUSY unknown is its own state (busy-unknown), any other BUSY is busy");
        check(LocalDashboard.plugin("1794062085", "1794062084") == H, "plugin: a newer one too");
        check(LocalDashboard.plugin("1793753996", "1794062084") == (LocalDashboard.P_HELLO > 0 && 1793753996L >= LocalDashboard.P_HELLO ? H : O),
                "plugin: an older one is too old unless at least P_HELLO");
        check(LocalDashboard.plugin("", "1794062084") == U && LocalDashboard.plugin(null, null) == U && LocalDashboard.plugin("12x", "1") == U
                && LocalDashboard.plugin("0", "1") == U, "plugin: no stamp known: unknown");

        // ---- the ticker ----
        tickerCase("an honest ticker", ticker(KEY, "ticker", null, "1"), "poked");
        tickerCase("a ticker with another key", ticker(OTHER, "ticker", null, "1"), "unknown_kid");
        tickerCase("a ticker naming another address", ticker(KEY, "ticker", "127.0.0.1:9122", "1"), "bad_addr");
        tickerCase("a proof for another role", ticker(KEY, "events", null, "1"), "bad_proof");
        tickerCase("version 0", ticker(KEY, "ticker", null, "0"), "old_version");
        tickerCase("an older ticker (reads one line, closes)", (c, f) -> f.line(c), "no_answer");
        tickerCase("garbage", (c, f) -> {
            f.line(c);
            c.getOutputStream().write("HTTP/1.1 400 Bad Request\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            c.getOutputStream().flush();
        }, "no_hello");
        tickerCase("a line too long", (c, f) -> {
            f.line(c);
            char[] x = new char[300];
            Arrays.fill(x, 'x');
            c.getOutputStream().write((new String(x) + "\n").getBytes(StandardCharsets.US_ASCII));
            c.getOutputStream().flush();
        }, "no_hello");
        tickerCase("a server that says nothing", (c, f) -> { f.line(c); Thread.sleep(5600); }, "no_answer");
        check(LocalClient.tickerHello("00112233445566778899aabbccddeeff", "e35ef1e9").equals("HELLO 1 00112233445566778899aabbccddeeff e35ef1e9")
                && LocalClient.tickerHello("00112233445566778899aabbccddeeff", "x").equals("HELLO 1 00112233445566778899aabbccddeeff"),
                "ticker: the hello line (as the hello_hint vector), a malformed hint left out");
        // The plugin's own ticker server half, when python3 is there: "poke" (a raw key would read as "legacy").
        for (String[] k : new String[][] {{KEY, "poke"}, {OTHER, "-"}}) {
            Process tp = python("ticker", k[0], OTHER);
            if (tp == null) { System.out.println("SKIP  ticker: no python3"); break; }
            BufferedReader in = new BufferedReader(new InputStreamReader(tp.getInputStream(), StandardCharsets.UTF_8));
            String first = in.readLine();
            if (first == null || !first.matches("\\d+")) { System.out.println("SKIP  ticker: python3 server half (" + first + ")"); tp.destroy(); break; }
            String got;
            try { LocalClient.poke(Integer.parseInt(first), KEYS); got = "poked"; } catch (LocalClient.Unverified e) { got = e.why; }
            String last = in.readLine();
            boolean ok = k[1].equals("poke") ? got.equals("poked") && "result poke".equals(last) : got.equals("unknown_kid") && "result -".equals(last);
            check(ok, "ticker: against local_auth.ticker_serve_one with " + (k[1].equals("poke") ? "our key: a verified POKE" : "another key: nothing") + " (" + got + ", " + last + ")");
            tp.destroy();
        }

        // ---- PluginSync's result receiver ----
        String run = LocalAuth.nonce();
        check(LocalAuth.nonceMatches(run, run), "result nonce: the run's own nonce is taken");
        check(!LocalAuth.nonceMatches(run, null) && !LocalAuth.nonceMatches(run, "") && !LocalAuth.nonceMatches(run, LocalAuth.nonce())
                && !LocalAuth.nonceMatches(run, run.toUpperCase()) && !LocalAuth.nonceMatches(run, run + "0"), "result nonce: none, another or a near one is refused");
        check(!LocalAuth.nonceMatches(null, null) && !LocalAuth.nonceMatches("", "") && !LocalAuth.nonceMatches("x", "x"),
                "result nonce: with no run awaited, nothing is taken (not even an empty or a matching malformed value)");

        // The one-shot gate the result receivers use (LocalAuth.Awaited): a receiver that skipped it would take any result.
        LocalAuth.Awaited aw = new LocalAuth.Awaited();
        check(!aw.take(null) && !aw.take(""), "awaited: nothing taken before a run");
        String n1 = aw.arm();
        check(!aw.take(LocalAuth.nonce()) && !aw.take(n1.toUpperCase()) && !aw.take(null), "awaited: another nonce, a near one or none: not taken");
        check(aw.take(n1), "awaited: the run's nonce is taken");
        check(!aw.take(n1), "awaited: once only");
        String n2 = aw.arm(), n3 = aw.arm();
        check(!aw.take(n2) && aw.take(n3), "awaited: an earlier run's nonce no longer counts once a new run started");
        String n4 = aw.arm();
        aw.clear();
        check(!aw.take(n4), "awaited: nothing taken after clear (a run that could not start)");
        java.util.Set<Integer> codes = new java.util.HashSet<>();
        for (int i = 0; i < 1000; i++) codes.add(LocalAuth.nextRequestCode(0x47140000));
        boolean inRange = true;
        for (int c2 : codes) inRange &= c2 >= 0x47140000 && c2 <= 0x47140000 + 0xffff;
        check(codes.size() == 1000 && inRange, "result PendingIntents: a request code of its own per run, in its range");
        check(LocalAuth.requestCode(0x47110000, 0x10005) == 0x47110005, "request code: base plus the low 16 bits");

        // The plugin notice's text.
        String[][] texts = {
            {"older", "true", "updating"}, {"busy", "true", "updating"}, {"failed", "true", "updating"},
            {"failed", "false", "anyway"}, {"older", "false", "anyway"}, {"not-ready", "false", "anyway"},
            {"held", "true", "anyway"}, {"modified", "false", "anyway"}, {"unknown", "false", "anyway"}, {"", "false", "anyway"},
        };
        for (String[] t : texts) {
            String got = LocalDashboard.updateText(t[0], Boolean.parseBoolean(t[1]));
            String want = t[2].equals("anyway") ? LocalDashboard.UPDATE_HELD_TEXT : LocalDashboard.UPDATE_TEXT;
            check(want.equals(got), "plugin notice: state " + t[0] + (t[1].equals("true") ? ", tries left" : ", no tries left") + ": " + t[2]);
        }

        // Posting the notice: once, again only for another text, cancelled once.
        String U1 = LocalDashboard.UPDATE_TEXT, U2 = LocalDashboard.UPDATE_HELD_TEXT;
        Object[][] acts = {
            {false, null, true, U1, "post"}, {true, U1, true, U1, "none"}, {true, U1, true, U2, "post"},
            {true, U2, false, null, "cancel"}, {false, null, false, null, "none"}, {true, null, true, U1, "post"},
        };
        for (Object[] x : acts)
            check(x[4].equals(LocalDashboard.noticeAction((Boolean) x[0], (String) x[1], (Boolean) x[2], (String) x[3])),
                    "plugin notice: shown " + x[0] + ", wanted " + x[2] + (x[1] != null && x[3] != null && !x[1].equals(x[3]) ? ", new text" : "") + ": " + x[4]);

        // How the app talks to the background host of a bgapp event.
        Object[][] modes = {
            {"mac", TOKEN, LocalClient.BgMode.MAC}, {"", TOKEN, LocalClient.BgMode.NONE}, {null, TOKEN, LocalClient.BgMode.NONE},
            {"MAC", TOKEN, LocalClient.BgMode.NONE}, {"mac ", TOKEN, LocalClient.BgMode.NONE}, {"mac", "short", LocalClient.BgMode.NONE},
            {"mac", "", LocalClient.BgMode.NONE}, {"", "", LocalClient.BgMode.NONE}, {"", null, LocalClient.BgMode.NONE},
            {"mac", new String(new char[257]).replace('\0', 'x'), LocalClient.BgMode.NONE},
        };
        for (Object[] m : modes)
            check(LocalClient.bgMode((String) m[0], (String) m[1]) == m[2], "bg mode: auth " + m[0] + ", token " + (m[1] == null ? "none" : ((String) m[1]).length() + " chars") + ": " + m[2]);
        boolean neverToken = true;
        for (Object[] m : modes) neverToken &= LocalClient.bgMode((String) m[0], (String) m[1]) != LocalClient.BgMode.TOKEN;
        check(neverToken, "bg mode: never the token header (an older plugin's host gets nothing)");
        check(LocalClient.bgOld("", TOKEN) && LocalClient.bgOld(null, TOKEN) && LocalClient.bgOld("MAC", TOKEN)
                && !LocalClient.bgOld("mac", TOKEN) && !LocalClient.bgOld("", "") && !LocalClient.bgOld("", null),
                "bg mode: an older plugin's event with a token is recognised (the app asks for the plugin's update)");

        // ---- the page's alert and the wording ----
        check(LocalDashboard.alertJs("dashboard").equals("window.__hmLocalAlert && window.__hmLocalAlert('dashboard')"), "alert script: dashboard");
        check(LocalDashboard.alertJs("events").equals("window.__hmLocalAlert && window.__hmLocalAlert('events')"), "alert script: events");
        check(LocalDashboard.alertJs(null).endsWith("(null)") && LocalDashboard.alertJs("x');alert(1)//").endsWith("(null)"), "alert script: none, and nothing else gets in");
        // What the page is pushed for each state (MainActivity.pushLocalAlert, every resume and page load): none clears.
        check(LocalDashboard.alertJs(LocalDashboard.alertKind(false, false)).equals("window.__hmLocalAlert && window.__hmLocalAlert(null)")
                && LocalDashboard.alertJs(LocalDashboard.alertKind(true, false)).endsWith("('events')")
                && LocalDashboard.alertJs(LocalDashboard.alertKind(true, true)).endsWith("('events')")
                && LocalDashboard.alertJs(LocalDashboard.alertKind(false, true)).endsWith("('dashboard')"), "alert push: each state's script, none clearing the banner");
        check("events".equals(LocalDashboard.alertKind(true, true)) && "dashboard".equals(LocalDashboard.alertKind(false, true))
                && LocalDashboard.alertKind(false, false) == null, "alert kind: the app's own port first, then the dashboard");
        check(LocalDashboard.ALERT_TITLE.equals("Hermux stopped talking to Hermes")
                && LocalDashboard.ALERT_TEXT.equals("Something else on this phone answered instead of Hermes, so Hermux sent it nothing. Restart the phone to fix it.")
                && LocalDashboard.ALERT_MORE.equals("If this comes back, an app installed recently may be the cause.")
                && LocalDashboard.UPDATE_TITLE.equals("Update the Hermux plugin")
                && LocalDashboard.UPDATE_TEXT.equals("This Hermux needs the newer plugin in Hermes. Hermux is updating it."), "wording as specified");
        try { LocalClient.single("short"); check(false, "single: a key too short is refused"); }
        catch (IllegalArgumentException e) { check(true, "single: a key too short is refused"); }
        check(KEYS.byKid(KID) == KEY && KEYS.byKid(LocalAuth.kid(OTHER)) == null && KID.equals(KEYS.hint()) && !String.valueOf(KEYS).contains(KEY),
                "single: one key, known by its kid, named as the hint, never in toString");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -Dservers="$T/servers.py" -cp "$T/out" com.omarqaterge.hermesmobile.LocalDashboardTest
