#!/bin/bash
# Tests the server half of local authentication (android/.../LocalServer.java, which bg/BgHost uses with role bghost and
# its per-start token as the key) with a plain JDK, on real loopback sockets: the app's own client (LocalClient) verifies
# it and gets one request through; a client with the wrong key, a relay on another port (the proof names the server's own
# address), a replayed or borrowed server nonce, a body, path or method changed after the MAC, a request without a hello,
# the raw token where it is refused, an oversized head or body, malformed heads and a slow trickle are all refused, and
# the raw token still works where it is allowed (BgHost without HM_AUTH=mac). Needs javac 11+. Also run by
# tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/LocalAuth.java android/src/com/omarqaterge/hermesmobile/LocalClient.java \
  android/src/com/omarqaterge/hermesmobile/LocalServer.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/LocalServerTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public class LocalServerTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static final String T = "5f0c9a8e1b7d4c3a2e6f9081b4d7a3c5e2f1908b7a6c4d3e"; // a per-start token, as the plugin makes it
    static final String OTHER = "0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26";
    static final byte[] NONE = new byte[0];
    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    static byte[] ascii(String s) { return s.getBytes(StandardCharsets.US_ASCII); }

    /** A server like BgHost: LocalServer.accept, then 200 with the request echoed, 403 for a request that got in by nothing. */
    static final class Server implements AutoCloseable {
        final ServerSocket ss;
        final int port;
        final LinkedBlockingQueue<Object> seen = new LinkedBlockingQueue<>();
        Server(String key, String rawHeader, int maxBody) throws IOException {
            ss = new ServerSocket(0, 8, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}));
            port = ss.getLocalPort();
            Thread t = new Thread(() -> {
                while (true) {
                    Socket c;
                    try { c = ss.accept(); } catch (IOException e) { return; }
                    new Thread(() -> serve(c, key, rawHeader, maxBody)).start(); // a slow client must not hold up the others
                }
            });
            t.setDaemon(true);
            t.start();
        }
        void serve(Socket c, String key, String rawHeader, int maxBody) {
            try (Socket so = c) {
                LocalServer.Request r = LocalServer.accept(so, "bghost", key, rawHeader, maxBody);
                seen.add(r == null ? "closed" : r);
                if (r == null) return;
                OutputStream out = so.getOutputStream();
                if (r.auth == LocalServer.Auth.NONE) LocalServer.answer(out, 403, "application/json", utf8("{\"ok\":false,\"error\":\"forbidden\"}"));
                else if (r.path.equals("/empty")) LocalServer.answer(out, 204, "text/plain", NONE);
                else LocalServer.answer(out, 200, "application/json", utf8("{\"ok\":true,\"auth\":\"" + r.auth + "\"}"));
            } catch (LocalServer.Refused e) {
                seen.add("refused " + e.why);
            } catch (IOException e) {
                seen.add("io " + e.getClass().getSimpleName());
            } catch (RuntimeException e) {
                seen.add("error " + e);
            }
        }
        Object next() throws InterruptedException { Object o = seen.poll(12, TimeUnit.SECONDS); return o == null ? "nothing" : o; }
        @Override public void close() throws IOException { ss.close(); }
    }

    static LocalClient.KeySet keys(String k) { return kid -> kid.equals(LocalAuth.kid(k)) ? k : null; }

    // ---- a hand-made client, to send what the real one never would ----

    static final class Raw implements AutoCloseable {
        final Socket s;
        final InputStream in;
        final int port;
        String nc, ns, kid, addr, proof;
        Raw(int port) throws IOException {
            this.port = port;
            s = new Socket();
            s.connect(new java.net.InetSocketAddress("127.0.0.1", port), 2000);
            s.setSoTimeout(12000);
            in = s.getInputStream();
        }
        void send(byte[] b) throws IOException { s.getOutputStream().write(b); s.getOutputStream().flush(); }
        /** Status and body of one answer; status -1 when the stream ends first. */
        /** Status, body and head of one answer: status -1 when the stream ends first, -2 when it is reset. */
        Object[] answer() throws IOException {
            ByteArrayOutputStream h = new ByteArrayOutputStream();
            while (!h.toString("ISO-8859-1").endsWith("\r\n\r\n")) {
                int x;
                try { x = in.read(); } catch (IOException e) { return new Object[] {-2, "", ""}; }
                if (x < 0) return new Object[] {-1, "", ""};
                h.write(x);
            }
            String head = h.toString("ISO-8859-1");
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?i)\r\ncontent-length: *(\\d+)").matcher(head);
            int n = m.find() ? Integer.parseInt(m.group(1)) : 0;
            byte[] b = new byte[n];
            for (int i = 0; i < n; i++) b[i] = (byte) in.read();
            return new Object[] {Integer.parseInt(head.substring(9, 12)), new String(b, StandardCharsets.UTF_8), head};
        }
        int hello() throws IOException {
            nc = LocalAuth.nonce();
            send(ascii("GET /hermux/hello?v=1&nc=" + nc + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nConnection: keep-alive\r\n\r\n"));
            Object[] a = answer();
            if ((Integer) a[0] == 200) {
                Map<?, ?> j = (Map<?, ?>) LocalClient.Json.parse((String) a[1]);
                ns = (String) j.get("ns"); kid = (String) j.get("kid"); addr = (String) j.get("addr"); proof = (String) j.get("proof");
            }
            return (Integer) a[0];
        }
        String auth(String key, String ns, String what, byte[] body) {
            return "1 " + LocalAuth.kid(key) + " " + ns + " " + LocalAuth.mac(key, "client", "bghost", LocalAuth.addr(port), nc, ns, what, LocalAuth.sha256hex(body));
        }
        int request(String method, String target, String extra, byte[] body) throws IOException {
            send(ascii(method + " " + target + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n" + extra + "Content-Length: " + body.length + "\r\n\r\n"));
            send(body);
            return (Integer) answer()[0];
        }
        @Override public void close() throws IOException { s.close(); }
    }

    static String drain(Server s) throws InterruptedException {
        Object o = s.next();
        return o instanceof LocalServer.Request ? "request " + ((LocalServer.Request) o).auth : String.valueOf(o);
    }

    public static void main(String[] a) throws Exception {
        byte[] body = utf8("{\"text\":\"héllo wörld\",\"n\":4}");
        try (Server s = new Server(T, "x-hm-token", 1 << 20); Server mac = new Server(T, null, 1 << 20);
             Server slow = new Server(T, null, 1 << 20)) {
            // A slow trickle runs alongside everything else: it must be dropped at the connection deadline.
            final Object[] trickle = new Object[1];
            Thread tr = new Thread(() -> {
                try (Raw r = new Raw(slow.port)) {
                    byte[] h = ascii("GET /hermux/hello?v=1&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\nHost: x\r\n\r\n");
                    long t0 = System.nanoTime();
                    try { for (byte b : h) { r.send(new byte[] {b}); Thread.sleep(250); } } catch (IOException ignored) { }
                    Object[] ans = r.answer();
                    trickle[0] = ans[0] + " after " + (System.nanoTime() - t0) / 1_000_000 + " ms";
                } catch (Exception e) { trickle[0] = e.toString(); }
            });
            tr.start();

            // The app's own client against it.
            LocalClient.Session ses = LocalClient.open("bghost", mac.port, keys(T));
            LocalClient.Answer ans = ses.request("POST", "/tap?x=1&y=2", body);
            Object got = mac.next();
            LocalServer.Request r = got instanceof LocalServer.Request ? (LocalServer.Request) got : null;
            check(ans.status == 200 && new String(ans.body, StandardCharsets.UTF_8).contains("\"MAC\""), "LocalClient verifies the server and its request gets in");
            check(r != null && r.auth == LocalServer.Auth.MAC && r.method.equals("POST") && r.target.equals("/tap?x=1&y=2")
                    && r.path.equals("/tap") && r.query.equals("x=1&y=2") && Arrays.equals(r.body, body), "the request as the handler sees it: method, path, query, raw body");
            ans = LocalClient.open("bghost", mac.port, keys(T)).request("GET", "/empty", null);
            check(ans.status == 204 && ans.body.length == 0 && "request MAC".equals(drain(mac)), "a 204 answer (no body) reads back");
            ans = LocalClient.open("bghost", mac.port, keys(T)).request("GET", "/status", null);
            check(ans.status == 200 && "request MAC".equals(drain(mac)), "a GET without a body");

            // The client side of a wrong key: the proof doesn't check out, nothing is sent.
            String why;
            try { LocalClient.open("bghost", mac.port, keys(OTHER)); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("unknown_kid".equals(why) && "closed".equals(drain(mac)), "a client with another key: unknown_kid, and it sends nothing (" + why + ")");
            try { LocalClient.open("bghost", mac.port, kid -> OTHER); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("bad_proof".equals(why) && "closed".equals(drain(mac)), "a client whose key differs under the same kid: bad_proof (" + why + ")");
            try { LocalClient.open("events", mac.port, keys(T)); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("bad_proof".equals(why) && "closed".equals(drain(mac)), "a proof for role bghost is not one for events (" + why + ")");

            // A relay on another port: the proof names the server's own address, so the client sees bad_addr.
            try (ServerSocket relay = new ServerSocket(0, 2, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}))) {
                Thread rt = new Thread(() -> {
                    try (Socket in = relay.accept(); Socket out = new Socket("127.0.0.1", mac.port)) {
                        Thread back = new Thread(() -> pipe(out, in));
                        back.start();
                        pipe(in, out);
                        back.join(3000);
                    } catch (Exception ignored) { }
                });
                rt.setDaemon(true);
                rt.start();
                try { LocalClient.open("bghost", relay.getLocalPort(), keys(T)); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
                check("bad_addr".equals(why), "through a relay on another port: bad_addr (" + why + ")");
                check("closed".equals(drain(mac)), "... and nothing reaches the server after the hello");
            }

            // Hand-made requests.
            try (Raw c = new Raw(mac.port)) {
                check(c.hello() == 200 && ("127.0.0.1:" + mac.port).equals(c.addr) && LocalAuth.kid(T).equals(c.kid)
                        && LocalAuth.same(c.proof, LocalAuth.mac(T, "server", "bghost", c.addr, c.nc, c.ns, "hello", LocalAuth.EMPTY_HASH)),
                        "hello: the proof is over our nonce, its nonce and its own listening address");
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(OTHER, c.ns, "POST /tap", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "a request signed with another key: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap", body) + "\r\n", utf8("{\"text\":\"other\",\"n\":4}")) == 403
                        && "refused refused".equals(drain(mac)), "a body changed after the MAC: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                byte[] latin = new String(body, StandardCharsets.UTF_8).getBytes(StandardCharsets.ISO_8859_1); // the same text, other bytes
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap", body) + "\r\n", latin) == 403
                        && "refused refused".equals(drain(mac)), "the MAC is over the raw body bytes, not the text they decode to");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                check(c.request("POST", "/tap?x=2", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap?x=1", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "a query changed after the MAC: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                check(c.request("PUT", "/tap", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "a method changed after the MAC: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap", body) + "\r\n", body) == 200
                        && "request MAC".equals(drain(mac)), "the hand-made client, done right, gets in");
            }
            try (Raw a1 = new Raw(mac.port); Raw b1 = new Raw(mac.port)) {
                a1.hello();
                b1.hello();
                b1.nc = a1.nc; // a request signed over the first connection's nonces, sent on the second
                check(b1.request("POST", "/tap", "X-Hermux-Auth: " + b1.auth(T, a1.ns, "POST /tap", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "another connection's server nonce on this one: 403");
            }
            check("closed".equals(drain(mac)), "... and the first connection, never used, ends with nothing handled");
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                String fresh = LocalAuth.nonce();
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(T, fresh, "POST /tap", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "a server nonce this server never gave: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                String h = c.auth(T, c.ns, "POST /tap", body).replace(" " + c.ns + " ", " " + LocalAuth.nonce() + " ");
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + h + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "a header naming another server nonce than the one signed: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                String h = c.auth(T, c.ns, "POST /tap", body);
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + h + "\r\nX-Hermux-Auth: " + h + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "X-Hermux-Auth twice: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                String h = c.auth(T, c.ns, "POST /tap", body);
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + h.replace(LocalAuth.kid(T), LocalAuth.kid(OTHER)) + "\r\n", body) == 403
                        && "refused refused".equals(drain(mac)), "another key id in the header: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                check(c.request("GET", "/status", "", NONE) == 403 && "refused refused".equals(drain(mac)), "after a hello, a request without X-Hermux-Auth: 403");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                c.request("GET", "/status", "X-Hermux-Auth: " + c.auth(T, c.ns, "GET /status", NONE) + "\r\n", NONE);
                drain(mac);
                try { c.send(ascii("GET /status HTTP/1.1\r\nX-Hermux-Auth: " + c.auth(T, c.ns, "GET /status", NONE) + "\r\n\r\n")); }
                catch (IOException ignored) { }
                check((Integer) c.answer()[0] < 0, "one request per hello: the connection ends after it");
            }
            try (Raw c = new Raw(mac.port)) {
                c.nc = LocalAuth.nonce();
                check(c.request("GET", "/status", "X-Hermux-Auth: " + c.auth(T, LocalAuth.nonce(), "GET /status", NONE) + "\r\n", NONE) == 403
                        && "request NONE".equals(drain(mac)), "no hello: a request with X-Hermux-Auth gets nothing (403)");
            }
            try (Raw c = new Raw(mac.port)) {
                check(c.request("GET", "/status", "X-HM-Token: " + T + "\r\n", NONE) == 403 && "request NONE".equals(drain(mac)),
                        "HM_AUTH=mac: the raw token is refused");
            }
            try (Raw c = new Raw(s.port)) {
                check(c.request("GET", "/status", "X-HM-Token: " + T + "\r\n", NONE) == 200 && "request RAW".equals(drain(s)),
                        "without HM_AUTH=mac: the raw token still works");
            }
            try (Raw c = new Raw(s.port)) {
                check(c.request("GET", "/status", "X-HM-Token: " + OTHER + "\r\n", NONE) == 403 && "request NONE".equals(drain(s)), "... a wrong token does not");
            }
            try (Raw c = new Raw(s.port)) {
                check(c.request("GET", "/status", "X-HM-Token: " + T + "\r\nX-HM-Token: " + T + "\r\n", NONE) == 403
                        && "request NONE".equals(drain(s)), "... nor the token twice");
            }
            try (Raw c = new Raw(s.port)) {
                c.hello();
                check(c.request("GET", "/status", "X-HM-Token: " + T + "\r\n", NONE) == 403 && "refused refused".equals(drain(s)),
                        "... but after a hello only X-Hermux-Auth counts");
            }
            ans = LocalClient.open("bghost", s.port, keys(T)).request("GET", "/status", null);
            check(ans.status == 200 && "request MAC".equals(drain(s)), "without HM_AUTH=mac the hello works too");

            // The hello itself.
            String[][] badHellos = {
                {"no nonce", "GET /hermux/hello?v=1 HTTP/1.1\r\n\r\n"},
                {"an upper-case nonce", "GET /hermux/hello?v=1&nc=" + LocalAuth.nonce().toUpperCase() + " HTTP/1.1\r\n\r\n"},
                {"version 0", "GET /hermux/hello?v=0&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\n\r\n"},
                {"another argument", "GET /hermux/hello?v=1&nc=" + LocalAuth.nonce() + "&x=1 HTTP/1.1\r\n\r\n"},
                {"the nonce twice", "GET /hermux/hello?v=1&nc=" + LocalAuth.nonce() + "&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\n\r\n"},
                {"POST", "POST /hermux/hello?v=1&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\nContent-Length: 0\r\n\r\n"},
                {"a body", "GET /hermux/hello?v=1&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}"},
            };
            for (String[] b : badHellos) {
                try (Raw c = new Raw(mac.port)) {
                    c.send(ascii(b[1]));
                    Object[] x = c.answer();
                    check((Integer) x[0] == 400 && !((String) x[1]).contains("proof") && "refused bad_request".equals(drain(mac)), "hello with " + b[0] + ": 400, no proof");
                }
            }
            try (Server bad = new Server("short", null, 1024); Raw c = new Raw(bad.port)) {
                check(c.hello() == 403 && "refused refused".equals(drain(bad)), "a key too short to prove with: no proof (403)");
            }
            try (Raw c = new Raw(mac.port)) {
                c.hello();
                c.close();
                check("closed".equals(drain(mac)), "a client that goes away after the hello: nothing to handle");
            }

            // Malformed and oversized heads and bodies.
            StringBuilder big = new StringBuilder();
            while (big.length() < 9000) big.append('a');
            StringBuilder many = new StringBuilder();
            for (int i = 0; i < 41; i++) many.append("X-H").append(i).append(": 1\r\n");
            String[][] badHeads = {
                {"a head over 8 KiB", "GET /status HTTP/1.1\r\nX-Big: " + big + "\r\n\r\n"},
                {"41 header lines", "GET /status HTTP/1.1\r\n" + many + "\r\n"},
                {"a bare LF", "GET /status HTTP/1.1\nHost: x\n\n"},
                {"a folded header line", "GET /status HTTP/1.1\r\nX-A: 1\r\n  2\r\n\r\n"},
                {"Content-Length twice", "POST /tap HTTP/1.1\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}"},
                {"a Content-Length that isn't digits", "POST /tap HTTP/1.1\r\nContent-Length: +2\r\n\r\n{}"},
                {"Transfer-Encoding", "POST /tap HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"},
                {"HTTP/2", "GET /status HTTP/2\r\n\r\n"},
                {"a body that ends early", "POST /tap HTTP/1.1\r\nContent-Length: 10\r\n\r\n{}"},
                {"a NUL in a header", "GET /status HTTP/1.1\r\nX-A: a\0b\r\n\r\n"},
            };
            for (String[] b : badHeads) {
                try (Raw c = new Raw(mac.port)) {
                    c.send(ascii(b[1]));
                    if (b[0].contains("ends early")) c.s.shutdownOutput();
                    int st = (Integer) c.answer()[0]; // -2: the 400 was sent, then the close reset our unread bytes
                    check((st == 400 || (st == -2 && b[0].contains("8 KiB"))) && "refused bad_request".equals(drain(mac)), b[0] + ": 400 (" + st + ")");
                }
            }
            try (Server small = new Server(T, null, 64); Raw c = new Raw(small.port)) {
                c.hello();
                c.send(ascii("POST /tap HTTP/1.1\r\nContent-Length: 900000000\r\n\r\n"));
                check((Integer) c.answer()[0] == 413 && "refused too_large".equals(drain(small)), "a body over the cap is refused before it is read (413)");
            }
            try (Server small = new Server(T, null, 64); Raw c = new Raw(small.port)) {
                byte[] b64 = new byte[64];
                Arrays.fill(b64, (byte) 'x');
                c.hello();
                check(c.request("POST", "/tap", "X-Hermux-Auth: " + c.auth(T, c.ns, "POST /tap", b64) + "\r\n", b64) == 200
                        && "request MAC".equals(drain(small)), "a body exactly at the cap gets in");
            }

            tr.join(15000);
            String t = String.valueOf(trickle[0]);
            long ms = t.matches("-?\\d+ after \\d+ ms") ? Long.parseLong(t.replaceAll(".* after (\\d+) ms", "$1")) : -1;
            check((t.startsWith("-1 after") || t.startsWith("-2 after")) && "io SocketTimeoutException".equals(drain(slow)) && ms >= LocalServer.DEADLINE_MS - 500 && ms < LocalServer.DEADLINE_MS + 3000,
                    "a trickle of bytes is dropped at the connection deadline, unanswered (" + t + ")");
        }
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }

    static void pipe(Socket from, Socket to) {
        try {
            InputStream in = from.getInputStream();
            OutputStream out = to.getOutputStream();
            byte[] b = new byte[4096];
            for (int n; (n = in.read(b)) > 0; ) { out.write(b, 0, n); out.flush(); }
            to.shutdownOutput();
        } catch (IOException ignored) { }
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -Xmx96m -cp "$T/out" com.omarqaterge.hermesmobile.LocalServerTest
