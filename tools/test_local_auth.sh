#!/bin/bash
# Tests local authentication on the app side (android/.../LocalAuth.java and LocalClient.java) with a plain JDK: the
# shared vectors in tools/local-auth-vectors.json, same() on equal, different, different-length and null input, the nonce
# shape, and LocalClient against fake servers on a loopback ServerSocket (honest, wrong key, wrong address, wrong role,
# old version, garbage, too much, never answers, a slow trickle, an early close, a replayed proof). After a failed hello
# the fake server must have received nothing but the hello. Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/LocalAuth.java android/src/com/omarqaterge/hermesmobile/LocalClient.java \
  android/src/com/omarqaterge/hermesmobile/LocalServer.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/LocalAuthTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LocalAuthTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static final String[] F = {"key", "dir", "role", "addr", "nc", "ns", "what", "hash"};
    static String KEY, OTHER, KID;

    static String macOf(Map<?, ?> m) {
        return LocalAuth.mac(s(m, "key"), s(m, "dir"), s(m, "role"), s(m, "addr"), s(m, "nc"), s(m, "ns"), s(m, "what"), s(m, "hash"));
    }
    static String s(Map<?, ?> m, String k) { return (String) m.get(k); }
    /** A string field, or null for JSON null. */
    static String sn(Map<?, ?> m, String k) { Object o = m.get(k); return o instanceof String ? (String) o : null; }
    static byte[] utf8(String t) { return t.getBytes(StandardCharsets.UTF_8); }

    // ---- a fake local server ----

    interface Behave { void run(Socket c, Fake f) throws Exception; }

    static final class Fake implements AutoCloseable {
        volatile String helloLine;
        final ServerSocket ss;
        final int port;
        final ByteArrayOutputStream received = new ByteArrayOutputStream();
        final AtomicInteger connections = new AtomicInteger();
        final CountDownLatch done = new CountDownLatch(1);
        final List<String[]> proofs = new ArrayList<>();
        volatile Boolean verified;
        volatile boolean helloLineOk;
        volatile byte[] requestBody;

        Fake(Behave b) throws IOException {
            ss = new ServerSocket();
            ss.setReceiveBufferSize(1 << 16); // small, so that large writes block on macOS and Linux alike
            ss.bind(new java.net.InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 4);
            port = ss.getLocalPort();
            Thread t = new Thread(() -> {
                try {
                    while (true) {
                        Socket c = ss.accept();
                        connections.incrementAndGet();
                        c.setSoTimeout(8000);
                        try { b.run(c, this); } catch (Exception ignored) { }
                        try { // whatever else the client sends before it closes, so a late request would be seen
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

        /** Reads one request: {head, body}, recording it; null if the client closed first. */
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
    }

    static String ncOf(String head) {
        Matcher m = Pattern.compile("^GET /hermux/hello\\?v=1&nc=([0-9a-f]{32})(&kid=[0-9a-f]{8})? HTTP/1\\.1\r\n").matcher(head + "\r\n");
        return m.find() ? m.group(1) : null;
    }

    /** Options for an (otherwise honest) server. */
    static final class Opt {
        String key, kid, role = "events", addr, ns, proof, extra, drop, status = "204 No Content", answer;
        Behave after;
        long version = 1;
        boolean upper;
        Opt key(String k) { key = k; return this; }
        Opt kid(String k) { kid = k; return this; }
        Opt role(String r) { role = r; return this; }
        Opt addr(String a) { addr = a; return this; }
        Opt ns(String n) { ns = n; return this; }
        Opt proof(String p) { proof = p; return this; }
        Opt version(long v) { version = v; return this; }
        Opt upper() { upper = true; return this; }
        Opt extra(String e) { extra = e; return this; }
        Opt drop(String d) { drop = d; return this; }
        Opt status(String s) { status = s; return this; }
        /** What the server sends instead of its answer to the request. */
        Opt answer(String a) { answer = a; return this; }
        /** What the server does instead of reading the request. */
        Opt after(Behave b) { after = b; return this; }
    }

    static String helloJson(Fake f, String nc, Opt o) {
        String key = o.key != null ? o.key : KEY;
        String ns = o.ns != null ? o.ns : LocalAuth.nonce();
        String addr = o.addr != null ? o.addr : "127.0.0.1:" + f.port;
        String p = o.proof != null ? o.proof : LocalAuth.mac(key, "server", o.role, addr, nc, ns, "hello", LocalAuth.EMPTY_HASH);
        if (o.upper) p = p.toUpperCase();
        synchronized (f.proofs) { f.proofs.add(new String[] {ns, p}); }
        StringBuilder j = new StringBuilder("{\"hermux\":").append(o.version);
        String[][] kv = {{"role", o.role}, {"kid", o.kid != null ? o.kid : LocalAuth.kid(key)}, {"ns", ns}, {"addr", addr}, {"proof", p}};
        for (String[] e : kv) if (!e[0].equals(o.drop)) j.append(",\"").append(e[0]).append("\":\"").append(e[1]).append('"');
        if (o.extra != null) j.append(',').append(o.extra);
        return j.append('}').toString();
    }

    static byte[] answer(String body, String status, String extraHeaders, int length) {
        return ("HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + (length >= 0 ? length : utf8(body).length)
                + "\r\n" + extraHeaders + "\r\n" + body).getBytes(StandardCharsets.UTF_8);
    }
    static byte[] answer(String body) { return answer(body, "200 OK", "", -1); }

    /** A valid hello body for the shared cases, with fields in {@code set} replaced by raw JSON text. */
    static String caseBody(Fake f, String nc, Map<?, ?> set) {
        String ns = LocalAuth.nonce(), where = "127.0.0.1:" + f.port;
        java.util.LinkedHashMap<String, String> vals = new java.util.LinkedHashMap<>();
        vals.put("hermux", "1");
        vals.put("role", "\"events\"");
        vals.put("kid", "\"" + KID + "\"");
        vals.put("ns", "\"" + ns + "\"");
        vals.put("addr", "\"" + where + "\"");
        vals.put("proof", "\"" + LocalAuth.mac(KEY, "server", "events", where, nc, ns, "hello", LocalAuth.EMPTY_HASH) + "\"");
        if (set != null) for (Map.Entry<?, ?> e : set.entrySet()) vals.put((String) e.getKey(), (String) e.getValue());
        StringBuilder b = new StringBuilder("{");
        for (Map.Entry<String, String> e : vals.entrySet()) b.append(b.length() > 1 ? "," : "").append('"').append(e.getKey()).append("\":").append(e.getValue());
        return b.append('}').toString();
    }

    /** {PAD:n} becomes n letters x, {LEN} the body's length in bytes, {BODY} the body. */
    static byte[] expand(String template, String body) {
        Matcher m = Pattern.compile("\\{PAD:(\\d+)\\}").matcher(template);
        StringBuffer out = new StringBuffer();
        while (m.find()) {
            char[] pad = new char[Integer.parseInt(m.group(1))];
            java.util.Arrays.fill(pad, 'x');
            m.appendReplacement(out, new String(pad));
        }
        m.appendTail(out);
        String t = out.toString().replace("{LEN}", String.valueOf(utf8(body).length)).replace("{BODY}", body);
        return t.getBytes(StandardCharsets.ISO_8859_1);
    }

    static Behave server(Opt o) {
        return (c, f) -> {
            String[] r = f.read(c);
            if (r == null) return;
            String nc = ncOf(r[0]);
            f.helloLineOk = nc != null && r[0].contains("\r\nHost: 127.0.0.1:" + f.port);
            f.helloLine = r[0].split("\r\n", 2)[0];
            String json = helloJson(f, nc, o);
            String ns = (String) ((Map<?, ?>) LocalClient.Json.parse(json)).get("ns");
            OutputStream out = c.getOutputStream();
            out.write(answer(json));
            out.flush();
            if (o.after != null) { o.after.run(c, f); return; }
            String[] r2 = f.read(c);
            if (r2 == null) return;
            String[] line = r2[0].split("\r\n", 2)[0].split(" ");
            byte[] body = r2[1].getBytes(StandardCharsets.ISO_8859_1);
            Matcher m = Pattern.compile("\r\nX-Hermux-Auth: 1 ([0-9a-f]{8}) ([0-9a-f]{32}) ([0-9a-f]{64})(\r\n|$)").matcher(r2[0]);
            String want = LocalAuth.mac(KEY, "client", "events", "127.0.0.1:" + f.port, nc, ns, line[0] + " " + line[1], LocalAuth.sha256hex(body));
            f.verified = m.find() && m.group(2).equals(ns) && LocalAuth.same(m.group(3), want);
            f.requestBody = body;
            out.write((o.answer != null ? o.answer : "HTTP/1.1 " + o.status + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
        };
    }

    interface Data { byte[] make(Fake f, String nc); }

    static Behave raw(Data d) {
        return (c, f) -> {
            String[] r = f.read(c);
            if (r == null) return;
            byte[] b = d.make(f, ncOf(r[0]));
            c.getOutputStream().write(b);
            c.getOutputStream().flush();
            Thread.sleep(300);
        };
    }

    static boolean onlyHello(Fake f) {
        String g = f.got();
        int n = 0;
        for (int i = g.indexOf(" HTTP/1.1\r\n"); i >= 0; i = g.indexOf(" HTTP/1.1\r\n", i + 1)) n++;
        return n <= 1 && !g.contains("X-Hermux-Auth") && !g.contains("secret");
    }

    static final LocalClient.KeySet KEYS = kid -> kid.equals(KID) ? KEY : null;

    static void expect(String name, Behave b, String why, long maxMs) throws Exception {
        try (Fake f = new Fake(b)) {
            long t0 = System.nanoTime();
            String got;
            try {
                LocalClient.Session s = LocalClient.open("events", f.port, KEYS);
                try { s.request("POST", "/event", utf8("{\"secret\":1}")); } catch (IOException ignored) { }
                got = "verified";
            } catch (LocalClient.Unverified e) {
                got = e.why;
                check(e.getMessage().equals(e.why) && e.getCause() == null && !String.valueOf(e).contains(KEY), name + ": the error text is only the reason");
            }
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            f.await();
            check(why.equals(got), name + ": " + why + (why.equals(got) ? "" : " (got " + got + ")"));
            check(onlyHello(f), name + ": nothing sent after the hello");
            if (maxMs > 0) check(ms < maxMs, name + ": within " + maxMs + " ms (" + ms + ")");
        }
    }
    static void expect(String name, Behave b, String why) throws Exception { expect(name, b, why, 0); }

    /** A good hello, then {@code answer} to the request: the client must throw an IOException saying {@code text}. */
    static void answerCase(String name, String answer, String text) throws Exception {
        try (Fake f = new Fake(server(new Opt().answer(answer)))) {
            String got;
            try { got = "answer " + LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}")).status; }
            catch (LocalClient.Unverified e) { got = e.why; }
            catch (IOException e) { got = e.getMessage(); }
            check(text.equals(got), name + ": " + text + (text.equals(got) ? "" : " (got " + got + ")"));
        }
    }

    public static void main(String[] a) throws Exception {
        Map<?, ?> v = (Map<?, ?>) LocalClient.Json.parse(new String(Files.readAllBytes(Paths.get(a[0])), StandardCharsets.UTF_8));
        KEY = s(v, "key"); OTHER = s(v, "other_key"); KID = s(v, "kid");

        // vectors
        check(LocalAuth.EMPTY_HASH.equals(s(v, "empty_hash")) && LocalAuth.EMPTY_HASH.equals(LocalAuth.sha256hex(new byte[0])) && LocalAuth.EMPTY_HASH.equals(LocalAuth.sha256hex(null)), "EMPTY_HASH matches the vectors");
        check(LocalAuth.VERSION.equals(s(v, "version")), "the version label matches");
        check(LocalAuth.kid(KEY).equals(KID), "kid of the key");
        check(LocalAuth.kid(OTHER).equals(s(v, "other_kid")), "kid of the other key");
        check(LocalAuth.kid("  " + KEY + "\n").equals(KID), "kid of the padded key is the same");
        for (Object o : (List<?>) v.get("sha256")) {
            Map<?, ?> m = (Map<?, ?>) o;
            check(LocalAuth.sha256hex(utf8(s(m, "text"))).equals(s(m, "hex")), "sha256: " + s(m, "name"));
        }
        for (Object o : (List<?>) v.get("macs")) {
            Map<?, ?> m = (Map<?, ?>) o;
            check(macOf(m).equals(s(m, "mac")), "mac: " + s(m, "name"));
            StringBuilder msg = new StringBuilder(LocalAuth.VERSION);
            for (int i = 1; i < F.length; i++) msg.append('\n').append(s(m, F[i]));
            check(msg.toString().equals(s(m, "msg")), "message text: " + s(m, "name"));
        }
        // the hello's kid hint
        Map<?, ?> hh = (Map<?, ?>) v.get("hello_hint");
        check(LocalAuth.helloTarget(s(hh, "nc"), LocalAuth.kid(s(hh, "key"))).equals(s(hh, "target")), "hello target with the kid hint (hello_hint vector)");
        check(LocalAuth.helloTarget(s(hh, "nc"), null).equals(s(hh, "target").split("&kid=")[0]), "hello target without a hint");
        final String prevKey = OTHER;
        LocalServer.Keys two = new LocalServer.Keys() {
            @Override public String proving() { return KEY; }
            @Override public boolean rawOk(String x) { return false; }
            @Override public String byKid(String k) { return LocalAuth.kid(KEY).equals(k) ? KEY : LocalAuth.kid(prevKey).equals(k) ? prevKey : null; }
        };
        for (Object o : (List<?>) v.get("hint_cases")) {
            Map<?, ?> m = (Map<?, ?>) o;
            check(LocalServer.helloKey(two, sn(m, "kid")).equals(s(v, s(m, "proves"))), "hint: " + s(m, "name") + ": proves with " + s(m, "proves"));
            check(!s(m, "proves").equals("key") || LocalAuth.helloTarget(s(hh, "nc"), sn(m, "kid")).equals(s(hh, "target").split("&kid=")[0])
                    || LocalAuth.isKid(sn(m, "kid")), "hint: " + s(m, "name") + ": a malformed hint is not sent");
        }
        LocalServer.Keys one = new LocalServer.Keys() {
            @Override public String proving() { return KEY; }
            @Override public boolean rawOk(String x) { return false; }
        };
        check(LocalServer.helloKey(one, s(v, "other_kid")).equals(KEY), "hint: a server with one key ignores another key's kid");
        for (Object o : (List<?>) v.get("hello_queries")) {
            Map<?, ?> m = (Map<?, ?>) o;
            Map<?, ?> e = m.get("expect") instanceof Map ? (Map<?, ?>) m.get("expect") : null;
            String[] got = LocalAuth.helloArgs(s(m, "query"));
            check(e == null ? got == null : got != null && got[0].equals(s(e, "nc")) && java.util.Objects.equals(got[1], sn(e, "kid")),
                    "hello query: " + s(m, "name"));
        }
        for (Object o : (List<?>) v.get("mismatch")) {
            Map<?, ?> m = (Map<?, ?>) o;
            check(!LocalAuth.same(macOf(m), s(m, "mac")), "mismatch: " + s(m, "name"));
        }
        Map<?, ?> base = (Map<?, ?>) ((List<?>) v.get("macs")).get(0);
        for (Object o : (List<?>) v.get("rejected")) {
            Map<?, ?> r = (Map<?, ?>) o;
            java.util.HashMap<Object, Object> m = new java.util.HashMap<>(base);
            m.put(s(r, "field"), s(r, "set"));
            String err = null;
            try { macOf(m); } catch (IllegalArgumentException e) { err = e.getMessage(); }
            check(s(r, "field").equals(err), "rejected: " + s(r, "name") + (s(r, "field").equals(err) ? "" : " (" + err + ")"));
        }
        for (Object o : (List<?>) v.get("not_nonce")) check(!LocalAuth.isNonce((String) o), "not a nonce: " + String.valueOf(o).replace("\n", "\\n"));
        for (Object o : (List<?>) v.get("not_same")) {
            Map<?, ?> m = (Map<?, ?>) o;
            check(!LocalAuth.same(s(m, "a"), s(m, "b")), "not same: " + s(m, "name"));
        }

        // same() and nonces
        String m0 = s(base, "mac");
        check(LocalAuth.same(m0, new String(m0.toCharArray())), "same: equal");
        check(!LocalAuth.same(m0, s((Map<?, ?>) ((List<?>) v.get("macs")).get(1), "mac")), "same: different");
        check(!LocalAuth.same(m0, m0.substring(2)), "same: different length");
        check(!LocalAuth.same(null, m0) && !LocalAuth.same(m0, null) && !LocalAuth.same(null, null), "same: null");
        Set<String> ns = new HashSet<>();
        boolean shape = true;
        for (int i = 0; i < 200; i++) { String n = LocalAuth.nonce(); shape &= LocalAuth.isNonce(n); ns.add(n); }
        check(shape && ns.size() == 200, "nonce: shape and freshness");
        check(!LocalAuth.isNonce(null) && LocalAuth.isNonce("00000000000000000000000000000000"), "nonce: 32 lowercase hex");
        check(new LocalClient.Unverified("whatever").why.equals("no_hello"), "Unverified: an unknown reason becomes no_hello");

        // the JSON reader
        boolean dupRefused = false, trailRefused = false, nestOk;
        try { LocalClient.Json.parse("{\"a\":1,\"a\":2}"); } catch (IllegalArgumentException e) { dupRefused = true; }
        try { LocalClient.Json.parse("{} x"); } catch (IllegalArgumentException e) { trailRefused = true; }
        Map<?, ?> nest = (Map<?, ?>) LocalClient.Json.parse("{\"a\":[1,2.5,true,null,\"\\u00e9\\n\"],\"b\":{}}");
        nestOk = ((List<?>) nest.get("a")).get(0).equals(1L) && ((List<?>) nest.get("a")).get(4).equals("é\n");
        check(dupRefused && trailRefused && nestOk, "JSON: a repeated name and trailing text are refused; values parse");

        // the hello's kid hint, as sent
        try (Fake f = new Fake(server(new Opt()))) {
            LocalClient.KeySet hinting = new LocalClient.KeySet() {
                @Override public String byKid(String k) { return k.equals(KID) ? KEY : null; }
                @Override public String hint() { return KID; }
            };
            LocalClient.Answer ans = LocalClient.open("events", f.port, hinting).request("POST", "/event", utf8("{}"));
            f.await();
            check(ans.status == 204 && f.helloLine != null && f.helloLine.contains("&kid=" + KID + " "), "a key set with a hint names it in the hello (&kid=)");
        }
        try (Fake f = new Fake(server(new Opt()))) {
            LocalClient.KeySet bad = new LocalClient.KeySet() {
                @Override public String byKid(String k) { return k.equals(KID) ? KEY : null; }
                @Override public String hint() { return "XYZ"; }
            };
            LocalClient.open("events", f.port, bad).request("POST", "/event", utf8("{}"));
            f.await();
            check(f.helloLine != null && !f.helloLine.contains("kid="), "a malformed hint is never sent");
        }

        try (java.net.ServerSocket quiet = new java.net.ServerSocket(0, 2, java.net.InetAddress.getByAddress(new byte[] {127, 0, 0, 1}))) {
            LocalClient.KeySet unsaved = new LocalClient.KeySet() {
                @Override public String byKid(String k) { return null; }
                @Override public String hint() { throw new IllegalStateException("key not saved"); }
            };
            String why;
            try { LocalClient.open("events", quiet.getLocalPort(), unsaved); why = "verified"; }
            catch (LocalClient.Unverified e) { why = e.why; }
            catch (RuntimeException e) { why = "escaped " + e.getClass().getSimpleName(); }
            quiet.setSoTimeout(500);
            boolean connected;
            try (java.net.Socket c = quiet.accept()) { connected = true; } catch (java.net.SocketTimeoutException e) { connected = false; }
            check("no_answer".equals(why) && !connected, "a key set whose hint can't be had (not saved): Unverified no_answer, not even a connect (" + why + ")");
        }

        // the client against fake servers
        try (Fake f = new Fake(server(new Opt()))) {
            LocalClient.Session s = LocalClient.open("events", f.port, KEYS);
            LocalClient.Answer ans = s.request("POST", "/event", utf8("{\"kind\":\"reply\"}"));
            f.await();
            check(f.helloLineOk, "honest: the hello request line and Host header");
            check(ans.status == 204 && Boolean.TRUE.equals(f.verified), "honest: verified, one request sent, answer 204");
            check(new String(f.requestBody, StandardCharsets.UTF_8).equals("{\"kind\":\"reply\"}"), "honest: the server saw the body as sent");
            check(KID.equals(s.kid()), "honest: kid is the key's");
            check(f.helloLine != null && !f.helloLine.contains("kid="), "a key set without a hint sends no kid argument");
            boolean once = false;
            try { s.request("POST", "/event", null); } catch (IllegalStateException e) { once = true; }
            check(once, "a session sends one request only");
        }
        try (Fake f = new Fake(server(new Opt().status("403 Forbidden")))) {
            String why = null;
            try { LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}")); } catch (LocalClient.Unverified e) { why = e.why; }
            check("refused".equals(why), "refused: a 403 after a good hello");
        }
        try (Fake f = new Fake(server(new Opt()))) {
            LocalClient.Session s = LocalClient.open("events", f.port, KEYS);
            boolean refused = false;
            try { s.request("POST", "/event\r\nX-Injected: 1", utf8("{}")); } catch (IllegalArgumentException e) { refused = true; }
            f.await();
            check(refused && onlyHello(f) && !f.got().contains("X-Injected"), "a path with CR LF is refused before sending");
        }

        expect("wrong key, its own kid", server(new Opt().key(OTHER)), "unknown_kid");
        expect("wrong key, our kid", server(new Opt().key(OTHER).kid(KID)), "bad_proof");
        expect("wrong address (a proof for another port)", server(new Opt().addr("127.0.0.1:9121")), "bad_addr");
        expect("wrong role", server(new Opt().role("ticker")), "bad_proof");
        expect("old version", server(new Opt().version(0)), "old_version");
        expect("version that is not a number", raw((f, nc) -> answer(helloJson(f, nc, new Opt()).replace("\"hermux\":1", "\"hermux\":\"1\""))), "no_hello");
        expect("version true", raw((f, nc) -> answer(helloJson(f, nc, new Opt()).replace("\"hermux\":1", "\"hermux\":true"))), "no_hello");
        expect("missing proof", server(new Opt().drop("proof")), "no_hello");
        expect("ns of the wrong shape", server(new Opt().ns("ABC").proof("0000000000000000000000000000000000000000000000000000000000000000")), "bad_proof");
        expect("proof in upper case", server(new Opt().upper()), "bad_proof");
        expect("kid of the wrong shape", server(new Opt().kid("KID")), "unknown_kid");
        expect("garbage", raw((f, nc) -> utf8("hello there\r\n\r\n")), "no_hello");
        expect("not found", raw((f, nc) -> utf8("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")), "no_hello");
        expect("HTML instead of JSON", raw((f, nc) -> answer("<html>hi</html>")), "no_hello");
        expect("JSON with a repeated name", raw((f, nc) -> answer(helloJson(f, nc, new Opt()).replaceFirst("\\}$", ",\"addr\":\"127.0.0.1:1\"}"))), "no_hello");
        StringBuilder pad = new StringBuilder();
        for (int i = 0; i < 5000; i++) pad.append('x');
        expect("too much", raw((f, nc) -> answer("{\"hermux\":1,\"pad\":\"" + pad + "\"}")), "no_hello");
        expect("too many header bytes", raw((f, nc) -> utf8("HTTP/1.1 200 OK\r\nX-Pad: " + pad + "\r\n\r\n")), "no_hello");
        expect("no Content-Length", raw((f, nc) -> utf8("HTTP/1.1 200 OK\r\n\r\n" + helloJson(f, nc, new Opt()))), "no_hello");
        expect("Connection: close", raw((f, nc) -> answer(helloJson(f, nc, new Opt()), "200 OK", "Connection: close\r\n", -1)), "no_hello");
        expect("chunked", raw((f, nc) -> utf8("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n")), "no_hello");
        expect("HTTP/1.0", raw((f, nc) -> utf8(new String(answer(helloJson(f, nc, new Opt())), StandardCharsets.UTF_8).replaceFirst("HTTP/1.1", "HTTP/1.0"))), "no_hello");
        expect("extra bytes after the answer", raw((f, nc) -> utf8(new String(answer(helloJson(f, nc, new Opt())), StandardCharsets.UTF_8) + "HTTP/1.1 200 OK\r\n")), "no_hello");
        expect("closes mid-answer", raw((f, nc) -> utf8("HTTP/1.1 200 OK\r\nContent-Le")), "no_hello");
        expect("short body, then close", raw((f, nc) -> answer(helloJson(f, nc, new Opt()), "200 OK", "", 900)), "no_hello");
        expect("closes at once", (c, f) -> { }, "no_answer");
        expect("never answers", (c, f) -> { f.read(c); Thread.sleep(4000); }, "no_answer", LocalClient.READ_MS + 1500);
        expect("trickles slowly", (c, f) -> {
            f.read(c);
            OutputStream out = c.getOutputStream();
            byte[] b = utf8("HTTP/1.1 200 OK\r\nContent-Length: 4000\r\n\r\n" + pad.substring(0, 4000));
            for (byte x : b) { out.write(x); out.flush(); Thread.sleep(400); }
        }, "no_answer", LocalClient.HELLO_DEADLINE_MS + 1500);

        // A proof recorded from an earlier honest exchange is worthless: the client's nonce is new each time.
        String[] old;
        try (Fake f = new Fake(server(new Opt()))) {
            LocalClient.open("events", f.port, KEYS).request("GET", "/x", null);
            f.await();
            old = f.proofs.get(0);
        }
        expect("a replayed proof", server(new Opt().ns(old[0]).proof(old[1])), "bad_proof");

        // The same-connection rule: a server that closes after a good hello gets no request on a new connection.
        try (Fake f = new Fake((c, fk) -> {
                String[] r = fk.read(c);
                c.getOutputStream().write(answer(helloJson(fk, ncOf(r[0]), new Opt())));
                c.getOutputStream().flush();
            })) {
            LocalClient.Session s = LocalClient.open("events", f.port, KEYS);
            f.await();
            Thread.sleep(200);
            boolean failed = false;
            try { s.request("POST", "/event", utf8("{\"secret\":1}")); } catch (IOException e) { failed = true; }
            Thread.sleep(500);
            check(failed, "closed after the hello: the request fails");
            check(f.connections.get() == 1, "closed after the hello: no new connection is made");
        }

        // Nothing listening.
        int free;
        try (ServerSocket p = new ServerSocket(0, 1, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}))) { free = p.getLocalPort(); }
        String why = null;
        try { LocalClient.open("events", free, KEYS); } catch (LocalClient.Unverified e) { why = e.why; }
        check("no_answer".equals(why), "nothing listening: no_answer");
        boolean refusedRole = false;
        try { LocalClient.open("web", 9121, KEYS); } catch (IllegalArgumentException e) { refusedRole = true; }
        check(refusedRole, "an unknown role is refused before dialling");
        try (Fake f = new Fake(server(new Opt()))) {
            String w = null;
            try { LocalClient.open("events", f.port, kid -> "short"); } catch (LocalClient.Unverified e) { w = e.why; }
            check("unknown_kid".equals(w), "an unusable key in the key set: unknown_kid");
        }

        // bounds, strict heads, writes, proxies
        boolean badEscape = false;
        try { LocalClient.Json.parse("\"\\u\uFF10\uFF10\uFF14\uFF11\""); } catch (IllegalArgumentException e) { badEscape = true; }
        check(badEscape && "A".equals(LocalClient.Json.parse("\"\\u0041\"")) && "\u00ff".equals(LocalClient.Json.parse("\"\\u00fF\"")),
                "JSON: a \\u escape takes ASCII hex digits only");
        // The JVM runs with a small heap (see below), so allocating from the length would fail here.
        expect("hello with a huge Content-Length", raw((f, nc) -> utf8("HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\nxxxx")), "no_hello", 2000);
        expect("hello after a 100 Continue", raw((f, nc) -> utf8("HTTP/1.1 100 Continue\r\n\r\n" + new String(answer(helloJson(f, nc, new Opt())), StandardCharsets.UTF_8))), "no_hello");
        expect("hello with a folded header line", raw((f, nc) -> answer(helloJson(f, nc, new Opt()), "200 OK", "X-A: 1\r\n continued\r\n", -1)), "no_hello");
        expect("hello with bare LF line endings", raw((f, nc) -> utf8(new String(answer(helloJson(f, nc, new Opt())), StandardCharsets.UTF_8).replace("\r\n", "\n"))), "no_hello");
        expect("hello with a header line without a colon", raw((f, nc) -> answer(helloJson(f, nc, new Opt()), "200 OK", "nonsense\r\n", -1)), "no_hello");
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 65; i++) many.append("X-A: 1\r\n");
        expect("hello with too many header lines", raw((f, nc) -> answer(helloJson(f, nc, new Opt()), "200 OK", many.toString(), -1)), "no_hello");
        final StackOverflowError boom = new StackOverflowError();
        try (Fake f = new Fake(server(new Opt()))) {
            Object w;
            try { LocalClient.open("events", f.port, kid -> { throw boom; }); w = "verified"; }
            catch (LocalClient.Unverified e) { w = e.why; }
            catch (Throwable e) { w = e; }
            check(w == boom, "an Error inside open() is not hidden: it propagates (" + w + ")");
        }
        try (Fake f = new Fake(server(new Opt()))) {
            String w;
            try { LocalClient.open("events", f.port, kid -> { throw new IllegalStateException(); }); w = "verified"; }
            catch (LocalClient.Unverified e) { w = e.why; }
            check("unknown_kid".equals(w), "a RuntimeException from the key set: unknown_kid (" + w + ")");
        }
        // The write watchdog's timer stopped (as if its thread had died): a fresh one takes over.
        java.lang.reflect.Method dog = LocalClient.class.getDeclaredMethod("watchdog");
        dog.setAccessible(true);
        ((java.util.Timer) dog.invoke(null)).cancel();
        try (Fake f = new Fake(server(new Opt()))) {
            String got;
            try { got = "" + LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}")).status; }
            catch (Exception e) { got = e.toString(); }
            check("204".equals(got), "a stopped write watchdog is replaced (" + got + ")");
        }
        answerCase("answer with a huge Content-Length", "HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\nxx", "answer too large");
        answerCase("answer after a 100 Continue", "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n", "bad answer");
        answerCase("answer of 101", "HTTP/1.1 101 Switching Protocols\r\n\r\n", "bad answer");
        answerCase("answer that ends inside its head", "HTTP/1.1 200 OK\r\nX-A: 1\r\n", "bad answer");
        answerCase("answer with a folded header line", "HTTP/1.1 204 No Content\r\nX-A: 1\r\n\tmore\r\n\r\n", "bad answer");

        // A verified server that never reads: the write gives up at the deadline instead of blocking for ever.
        final byte[] big = new byte[16 << 20];
        java.util.Arrays.fill(big, (byte) '0');
        // The server's wait and the join are far longer than the deadline and the check's slack, so a slow machine has
        // room, and a write without its bound (done only once the server reads) still fails clearly.
        try (Fake f = new Fake(server(new Opt().after((c, fk) -> Thread.sleep(LocalClient.ANSWER_DEADLINE_MS + 15000))))) {
            final LocalClient.Session s = LocalClient.open("events", f.port, KEYS);
            final String[] result = {null};
            long t0 = System.nanoTime();
            Thread t = new Thread(() -> {
                try { s.request("POST", "/event", big); result[0] = "sent"; } catch (IOException e) { result[0] = "failed"; }
            });
            t.setDaemon(true);
            t.start();
            t.join(LocalClient.ANSWER_DEADLINE_MS + 8000);
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            check("failed".equals(result[0]) && ms < LocalClient.ANSWER_DEADLINE_MS + 4000,
                    "a peer that never reads: the write fails within the deadline (" + result[0] + ", " + ms + " ms)");
        }
        // A peer that starts reading after one read timeout: the write waits for it, within the answer deadline. The
        // server starts its wait once the request's head is in (the client is writing by then), drains the body in
        // large chunks without keeping it (quick, and small for the test's heap, even on a loaded machine). The body is
        // far larger than both sockets' buffers, so the write can only finish once the server reads.
        final long[] late = {-1}; // body bytes the server drained
        try (Fake f = new Fake(server(new Opt().after((c, fk) -> {
                InputStream in = c.getInputStream();
                StringBuilder head = new StringBuilder();
                while (head.indexOf("\r\n\r\n") < 0) {
                    int x = in.read();
                    if (x < 0) return;
                    head.append((char) x);
                }
                Matcher m = Pattern.compile("(?i)\r\ncontent-length: *(\\d+)").matcher(head);
                long want = m.find() ? Long.parseLong(m.group(1)) : -1;
                Thread.sleep(LocalClient.READ_MS + 1000); // longer than one read timeout, well inside the answer deadline
                byte[] buf = new byte[1 << 16];
                long n = 0;
                for (int r; n < want && (r = in.read(buf, 0, (int) Math.min(buf.length, want - n))) > 0; ) n += r;
                late[0] = n;
                c.getOutputStream().write(utf8("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
            })))) {
            String got;
            try { got = "" + LocalClient.open("events", f.port, KEYS).request("POST", "/event", big).status; }
            catch (IOException e) { got = e.toString(); }
            check("204".equals(got) && late[0] == big.length, "a peer that starts reading late: the write waits for it (" + got + ", " + late[0] + " bytes)");
        }

        // No proxy: a ProxySelector that would send everything elsewhere plays no part.
        java.net.ProxySelector oldSelector = java.net.ProxySelector.getDefault();
        final AtomicInteger asked = new AtomicInteger();
        java.net.ProxySelector.setDefault(new java.net.ProxySelector() {
            @Override public List<java.net.Proxy> select(java.net.URI u) {
                asked.incrementAndGet();
                return java.util.Collections.singletonList(new java.net.Proxy(java.net.Proxy.Type.SOCKS, new java.net.InetSocketAddress("127.0.0.1", free)));
            }
            @Override public void connectFailed(java.net.URI u, java.net.SocketAddress a, IOException e) { }
        });
        try (Fake f = new Fake(server(new Opt()))) {
            String got;
            try { got = "" + LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}")).status; }
            catch (IOException e) { got = e.toString(); }
            check("204".equals(got) && asked.get() == 0, "a proxy selector is not used (" + got + ", asked " + asked.get() + ")");
        } finally {
            java.net.ProxySelector.setDefault(oldSelector);
        }

        // Shared client cases (local-auth-vectors.json): the same raw answers, the same outcome as the Python client.
        for (Object o : (List<?>) v.get("hello_cases")) {
            final Map<?, ?> c = (Map<?, ?>) o;
            final String want = s(c, "expect");
            Behave b = (sock, fk) -> {
                String[] r = fk.read(sock);
                if (r == null) return;
                OutputStream out = sock.getOutputStream();
                out.write(expand(s(c, "answer"), caseBody(fk, ncOf(r[0]), (Map<?, ?>) c.get("set"))));
                out.flush();
                if (!"verified".equals(want)) { Thread.sleep(300); return; }
                fk.read(sock);
                out.write(utf8("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
                out.flush();
            };
            if (!"verified".equals(want)) { expect("hello case: " + s(c, "name"), b, want); continue; }
            try (Fake f = new Fake(b)) {
                String got;
                try { got = "" + LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}")).status; }
                catch (IOException e) { got = e.toString(); }
                check("204".equals(got), "hello case: " + s(c, "name") + ": verified (" + got + ")");
            }
        }
        for (Object o : (List<?>) v.get("answer_cases")) {
            Map<?, ?> c = (Map<?, ?>) o;
            String answer = new String(expand(s(c, "answer"), ""), StandardCharsets.ISO_8859_1);
            try (Fake f = new Fake(server(new Opt().answer(answer)))) {
                String got;
                try {
                    LocalClient.Answer an = LocalClient.open("events", f.port, KEYS).request("POST", "/event", utf8("{}"));
                    got = "ok " + an.status + " " + an.body.length;
                } catch (LocalClient.Unverified e) { got = e.why; }
                catch (IOException e) { got = "error " + e.getMessage(); }
                check(s(c, "expect").equals(got), "answer case: " + s(c, "name") + ": " + s(c, "expect") + (s(c, "expect").equals(got) ? "" : " (got " + got + ")"));
            }
        }

        // The dashboard's token step (token_cases): the same answers, the same outcome as local_auth.dashboard_token and
        // hm-local. The fake guard checks the token request as the real one does (both nonces, the kid, the client MAC).
        for (Object o : (List<?>) v.get("token_cases")) {
            final Map<?, ?> c = (Map<?, ?>) o;
            final boolean[] headerOk = {false};
            Behave b = (sock, fk) -> {
                String[] r = fk.read(sock);
                if (r == null) return;
                String nc = ncOf(r[0]), sn = LocalAuth.nonce(), where = "127.0.0.1:" + fk.port;
                String hello = "{\"hermux\":1,\"role\":\"dashboard\",\"kid\":\"" + KID + "\",\"ns\":\"" + sn + "\",\"addr\":\"" + where
                        + "\",\"proof\":\"" + LocalAuth.mac(KEY, "server", "dashboard", where, nc, sn, "hello", LocalAuth.EMPTY_HASH) + "\"}";
                OutputStream out = sock.getOutputStream();
                out.write(answer(hello));
                out.flush();
                String[] r2 = fk.read(sock);
                if (r2 == null) return;
                Matcher m = Pattern.compile("^GET /hermux/token HTTP/1\\.1\r\n(?:.*\r\n)*?X-Hermux-Auth: 1 ([0-9a-f]{8}) ([0-9a-f]{32}) ([0-9a-f]{32}) ([0-9a-f]{64})(\r\n|$)").matcher(r2[0]);
                headerOk[0] = m.find() && m.group(1).equals(KID) && m.group(2).equals(sn) && m.group(3).equals(nc)
                        && LocalAuth.same(m.group(4), LocalAuth.mac(KEY, "client", "dashboard", where, nc, sn, "GET /hermux/token", LocalAuth.EMPTY_HASH));
                if (!headerOk[0]) {
                    out.write(answer("{\"hermux\":1,\"error\":\"refused\"}", "403 Forbidden", "", -1));
                    out.flush();
                    return;
                }
                out.write(tokenAnswer(c, where, nc, sn, fk.port));
                out.flush();
            };
            try (Fake f = new Fake(b)) {
                String got;
                try { got = "token " + LocalClient.dashboardToken(f.port, KEYS); }
                catch (LocalClient.Unverified e) { got = e.why; }
                catch (IOException e) { got = "error " + e.getMessage(); }
                f.await();
                check(s(c, "expect").equals(got), "token case: " + s(c, "name") + ": " + s(c, "expect") + (s(c, "expect").equals(got) ? "" : " (got " + got + ")"));
                if (!s(c, "answer").isEmpty()) check(headerOk[0], "token case: " + s(c, "name") + ": the request carried the five-field header");
            }
        }

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }

    /** The raw answer of a token case for this exchange (as tools/local_auth_cases.py token_answer builds it). */
    static byte[] tokenAnswer(Map<?, ?> c, String where, String nc, String ns, int port) {
        String tok = s(c, "token"), how = c.get("proof") == null ? "good" : s(c, "proof");
        String th = LocalAuth.sha256hex(utf8(tok)), p;
        switch (how) {
            case "other_key": p = LocalAuth.mac(OTHER, "answer", "dashboard", where, nc, ns, "token", th); break;
            case "other_token": p = LocalAuth.mac(KEY, "answer", "dashboard", where, nc, ns, "token", LocalAuth.sha256hex(utf8(tok + "-other"))); break;
            case "client_dir": p = LocalAuth.mac(KEY, "client", "dashboard", where, nc, ns, "token", th); break;
            case "swapped": p = LocalAuth.mac(KEY, "answer", "dashboard", where, ns, nc, "token", th); break;
            case "other_addr": p = LocalAuth.mac(KEY, "answer", "dashboard", LocalAuth.addr(port < 65535 ? port + 1 : port - 1), nc, ns, "token", th); break;
            case "other_role": p = LocalAuth.mac(KEY, "answer", "events", where, nc, ns, "token", th); break;
            case "replay": p = LocalAuth.mac(KEY, "answer", "dashboard", where, LocalAuth.nonce(), LocalAuth.nonce(), "token", th); break;
            default:
                p = LocalAuth.mac(KEY, "answer", "dashboard", where, nc, ns, "token", th);
                if (how.equals("upper")) p = p.toUpperCase();
        }
        java.util.LinkedHashMap<String, String> vals = new java.util.LinkedHashMap<>();
        vals.put("hermux", "1");
        vals.put("token", jsonString(tok));
        vals.put("proof", jsonString(p));
        Object set = c.get("set");
        if (set instanceof Map) for (Map.Entry<?, ?> e : ((Map<?, ?>) set).entrySet()) vals.put((String) e.getKey(), (String) e.getValue());
        StringBuilder body = new StringBuilder("{");
        for (Map.Entry<String, String> e : vals.entrySet()) body.append(body.length() > 1 ? "," : "").append('"').append(e.getKey()).append("\":").append(e.getValue());
        if (c.get("repeat") instanceof String) body.append(",\"").append(s(c, "repeat")).append("\":\"x\"");
        body.append('}');
        return expand(s(c, "answer"), body.toString());
    }

    static String jsonString(String t) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : t.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
# A small heap, so that a length used for an allocation before it is checked fails the test.
java -Xmx96m -cp "$T/out" com.omarqaterge.hermesmobile.LocalAuthTest tools/local-auth-vectors.json
