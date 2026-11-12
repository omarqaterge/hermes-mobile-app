#!/bin/bash
# Tests the request handling of the app's own listener (android/.../EventsListener.java, which HermesService.handle
# calls) with a plain JDK on real loopback sockets, with a LocalKey over an in-memory store: the app's own client
# verifies it (role events, the proof names the server's own port) and gets one signed request through on each route
# (/event, /phonedata, /setup, /plugin-bundle/<token>) with the raw body bytes; a client with another key sends
# nothing; a request signed with another key, with a server nonce from another connection, with a changed body or
# without X-Hermux-Auth after a hello is refused (403); the raw key still works (and the previous key during its grace
# only); each route keeps its body cap and /phonedata its own answers and its 4 s deadline; an oversized head is
# refused; a slow trickle is cut off; one request per connection, the hello first; a signed request cuts the previous
# key's grace. Then the bind retry plan: the back-off, the stop after an hour, when a run starts again, the rate limit.
# Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/EventsListener.java android/src/com/omarqaterge/hermesmobile/LocalKey.java \
  android/src/com/omarqaterge/hermesmobile/LocalAuth.java android/src/com/omarqaterge/hermesmobile/LocalClient.java \
  android/src/com/omarqaterge/hermesmobile/LocalServer.java android/src/com/omarqaterge/hermesmobile/SetupLines.java \
  "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/EventsListenerTest.java" <<'JAVA'
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
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public class EventsListenerTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static final String FORBID = "{\"ok\":false,\"reason\":\"forbidden\"}", TOO_BIG = "{\"ok\":false,\"reason\":\"bad_request\"}";
    static final String OTHER = "0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26";
    static final byte[] NONE = new byte[0];
    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    static byte[] ascii(String s) { return s.getBytes(StandardCharsets.US_ASCII); }
    static volatile long now = 1_700_000_000_000L;

    static final class Mem implements LocalKey.Store {
        final Map<String, Object> m = new HashMap<>();
        @Override public synchronized String getString(String n) { Object v = m.get(n); return v instanceof String ? (String) v : null; }
        @Override public synchronized long getLong(String n) { Object v = m.get(n); return v instanceof Long ? (Long) v : 0; }
        @Override public synchronized boolean getBoolean(String n) { return Boolean.TRUE.equals(m.get(n)); }
        @Override public synchronized Object get(String n) { return m.get(n); }
        @Override public synchronized boolean save(Map<String, Object> c) {
            for (Map.Entry<String, Object> e : c.entrySet()) { if (e.getValue() == null) m.remove(e.getKey()); else m.put(e.getKey(), e.getValue()); }
            return true;
        }
    }

    static final Mem STORE = new Mem();
    static final String SETUP_TOKEN = "setup0123456789abcdef";
    static final SetupLines SETUP_LINES = new SetupLines();
    static volatile String bundleToken = "tok123";
    static String setupBody(String tok) { return "{\"token\":\"" + tok + "\",\"line\":\"STEP packages Installing\"}"; }
    static final LocalKey KEYS = new LocalKey(STORE, () -> now, 1);

    /** A listener like HermesService.handle: EventsListener.read, then the answers handle writes for each route. */
    static final class Server implements AutoCloseable {
        final ServerSocket ss;
        final int port;
        final LinkedBlockingQueue<Object> seen = new LinkedBlockingQueue<>();
        Server() throws IOException {
            ss = new ServerSocket(0, 8, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}));
            port = ss.getLocalPort();
            Thread t = new Thread(() -> {
                while (true) {
                    Socket c;
                    try { c = ss.accept(); } catch (IOException e) { return; }
                    new Thread(() -> serve(c)).start(); // a slow client must not hold up the other checks
                }
            });
            t.setDaemon(true);
            t.start();
        }
        void serve(Socket c) {
            try (Socket so = c) {
                so.setSoTimeout(3000);
                EventsListener.Request r = EventsListener.read(so, KEYS, FORBID, TOO_BIG);
                seen.add(r == null ? "closed" : r);
                if (r == null) return;
                if (r.auth() == LocalServer.Auth.MAC) KEYS.confirm(r.kid());
                OutputStream out = so.getOutputStream();
                // The real decision (EventsListener.verdict), and the real one-time token checks behind it.
                switch (EventsListener.verdict(r)) {
                    case BUNDLE: {
                        boolean ok;
                        synchronized (Server.class) {
                            ok = EventsListener.tokenMatches(bundleToken, r.bundleToken);
                            if (ok) bundleToken = null; // one fetch per run, as PluginSync does
                        }
                        LocalServer.answer(out, ok ? 200 : 403, "application/gzip", utf8(ok ? "gz" : ""));
                        break;
                    }
                    case SETUP: {
                        String[] tl = SetupLines.parse(r.text());
                        int res = tl == null ? SetupLines.BAD_LINE : SETUP_LINES.add(tl[0], tl[1], tl[2], 1_700_000_000L);
                        LocalServer.answer(out, res, "text/plain", NONE);
                        break;
                    }
                    case PHONEDATA: LocalServer.answer(out, 200, "application/json", utf8("{\"ok\":true}")); break;
                    case NO_KEY:
                        if (r.route == EventsListener.Route.PHONEDATA) LocalServer.answer(out, 403, "application/json", utf8(FORBID));
                        else LocalServer.answer(out, 403, "text/plain", NONE);
                        break;
                    default: LocalServer.answer(out, 204, "text/plain", NONE);
                }
            } catch (LocalServer.Refused e) {
                seen.add("refused " + e.why);
            } catch (IOException e) {
                seen.add("io " + e.getClass().getSimpleName());
            } catch (RuntimeException e) {
                seen.add("error " + e);
            }
        }
        Object next() throws InterruptedException { Object o = seen.poll(14, TimeUnit.SECONDS); return o == null ? "nothing" : o; }
        @Override public void close() throws IOException { ss.close(); }
    }

    /** A client key set holding one key and naming it in the hello, as local_auth.py and hm-local do. */
    static LocalClient.KeySet holding(String key) {
        return new LocalClient.KeySet() {
            @Override public String byKid(String k) { return LocalAuth.kid(key).equals(k) ? key : null; }
            @Override public String hint() { return LocalAuth.kid(key); }
        };
    }

    /** A request as read, for the pure verdict: the route's method and target, and how it got in. */
    static EventsListener.Request fakeRequest(EventsListener.Route rt, LocalServer.Auth au) throws Exception {
        String[] mt = rt == EventsListener.Route.SETUP ? new String[] {"POST", "/setup"} : rt == EventsListener.Route.PHONEDATA
                ? new String[] {"POST", "/phonedata"} : rt == EventsListener.Route.BUNDLE ? new String[] {"GET", "/plugin-bundle/x"} : new String[] {"POST", "/event"};
        java.lang.reflect.Constructor<LocalServer.Request> c = LocalServer.Request.class.getDeclaredConstructor(
                String.class, String.class, Map.class, byte[].class, LocalServer.Auth.class, String.class);
        c.setAccessible(true);
        LocalServer.Request lr = c.newInstance(mt[0], mt[1], new HashMap<String, java.util.List<String>>(), NONE, au, null);
        return new EventsListener.Request(EventsListener.route(mt[0], mt[1]), lr, null);
    }

    static String drain(Server s) throws InterruptedException {
        Object o = s.next();
        if (!(o instanceof EventsListener.Request)) return String.valueOf(o);
        EventsListener.Request r = (EventsListener.Request) o;
        return r.route + " " + r.auth();
    }

    static final class Raw implements AutoCloseable {
        final Socket s;
        final InputStream in;
        final int port;
        String nc, ns, kid, addr, proof;
        Raw(int port) throws IOException {
            this.port = port;
            s = new Socket();
            s.connect(new java.net.InetSocketAddress("127.0.0.1", port), 2000);
            s.setSoTimeout(14000);
            in = s.getInputStream();
        }
        void send(byte[] b) throws IOException { s.getOutputStream().write(b); s.getOutputStream().flush(); }
        /** Status and body: status -1 when the stream ends first, -2 when it is reset. */
        Object[] answer() throws IOException {
            ByteArrayOutputStream h = new ByteArrayOutputStream();
            while (!h.toString("ISO-8859-1").endsWith("\r\n\r\n")) {
                int x;
                try { x = in.read(); } catch (IOException e) { return new Object[] {-2, ""}; }
                if (x < 0) return new Object[] {-1, ""};
                h.write(x);
            }
            String head = h.toString("ISO-8859-1");
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?i)\r\ncontent-length: *(\\d+)").matcher(head);
            int n = m.find() ? Integer.parseInt(m.group(1)) : 0;
            byte[] b = new byte[n];
            for (int i = 0; i < n; i++) b[i] = (byte) in.read();
            return new Object[] {Integer.parseInt(head.substring(9, 12)), new String(b, StandardCharsets.UTF_8)};
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
            return "1 " + LocalAuth.kid(key) + " " + ns + " " + LocalAuth.mac(key, "client", "events", LocalAuth.addr(port), nc, ns, what, LocalAuth.sha256hex(body));
        }
        Object[] request(String method, String target, String extra, byte[] body) throws IOException {
            send(ascii(method + " " + target + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n" + extra + "Content-Length: " + body.length + "\r\n\r\n"));
            send(body);
            return answer();
        }
        int status(String method, String target, String extra, byte[] body) throws IOException { return (Integer) request(method, target, extra, body)[0]; }
        @Override public void close() throws IOException { s.close(); }
    }

    /** Sends {@code line} at once, then {@code rest} a byte every 250 ms; the answer's status and how long after the line it came. */
    static Thread trickle(int port, String line, String rest, Object[] out) {
        Thread t = new Thread(() -> {
            try (Raw r = new Raw(port)) {
                r.send(ascii(line));
                long t0 = System.nanoTime();
                try { for (byte b : ascii(rest)) { r.send(new byte[] {b}); Thread.sleep(250); } } catch (IOException ignored) { }
                Object[] a = r.answer();
                out[0] = a[0];
                out[1] = (System.nanoTime() - t0) / 1_000_000;
            } catch (Exception e) { out[0] = e.toString(); }
        });
        t.start();
        return t;
    }

    public static void main(String[] a) throws Exception {
        String K = KEYS.current();
        SETUP_LINES.start(SETUP_TOKEN);
        byte[] body = utf8("{\"kind\":\"status\",\"body\":\"héllo wörld ✓\"}");
        try (Server srv = new Server(); Server slow = new Server()) {
            // Slow trickles run alongside everything else.
            Object[] tp = new Object[2], te = new Object[2];
            Thread t1 = trickle(slow.port, "POST /phonedata HTTP/1.1\r\n", "X-Hermes-Mobile-Key: " + K + "\r\nContent-Length: 2\r\n\r\n{}", tp);
            Thread t2 = trickle(slow.port, "POST /event HTTP/1.1\r\n", "X-Hermes-Mobile-Key: " + K + "\r\nContent-Length: 2\r\n\r\n{}", te);

            // The app's own client: verified, then one signed request per route.
            LocalClient.Session ses = LocalClient.open("events", srv.port, KEYS);
            LocalClient.Answer ans = ses.request("POST", "/event", body);
            Object got = srv.next();
            EventsListener.Request r = got instanceof EventsListener.Request ? (EventsListener.Request) got : null;
            check(ans.status == 204 && r != null && r.route == EventsListener.Route.EVENT && r.auth() == LocalServer.Auth.MAC && r.keyOk(),
                    "the app's own client verifies the listener and its signed event gets in (204)");
            check(r != null && Arrays.equals(r.req.body, body) && r.text().equals(new String(body, StandardCharsets.UTF_8)) && LocalAuth.kid(K).equals(r.kid()),
                    "the handler gets the raw body bytes (non-ASCII intact) and the key id");
            ans = LocalClient.open("events", srv.port, KEYS).request("POST", "/phonedata", utf8("{\"op\":\"status\"}"));
            check(ans.status == 200 && "PHONEDATA MAC".equals(drain(srv)), "a signed /phonedata request goes to the phone-data route");
            ans = LocalClient.open("events", srv.port, KEYS).request("POST", "/setup", utf8(setupBody(SETUP_TOKEN)));
            check(ans.status == 204 && "SETUP MAC".equals(drain(srv)), "a signed /setup request goes to the setup route");
            bundleToken = "tok123";
            ans = LocalClient.open("events", srv.port, KEYS).request("GET", "/plugin-bundle/tok123", null);
            check(ans.status == 200 && "BUNDLE MAC".equals(drain(srv)), "a signed bundle request goes to the bundle route with its token");

            // The client side: another key, or another role, sends nothing.
            String why;
            try { LocalClient.open("events", srv.port, kid -> kid.equals(LocalAuth.kid(OTHER)) ? OTHER : null); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("unknown_kid".equals(why) && "closed".equals(drain(srv)), "a client with another key: unknown_kid, nothing sent (" + why + ")");
            try { LocalClient.open("ticker", srv.port, KEYS); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("bad_proof".equals(why) && "closed".equals(drain(srv)), "the listener's proof is for role events only (" + why + ")");

            // Hand-made requests after a hello.
            try (Raw c = new Raw(srv.port)) {
                check(c.hello() == 200 && ("127.0.0.1:" + srv.port).equals(c.addr) && LocalAuth.kid(K).equals(c.kid)
                        && LocalAuth.same(c.proof, LocalAuth.mac(K, "server", "events", c.addr, c.nc, c.ns, "hello", LocalAuth.EMPTY_HASH)),
                        "hello: the proof is over our nonce, its nonce and its own listening address, under the current key");
                check(c.status("POST", "/event", "X-Hermux-Auth: " + c.auth(OTHER, c.ns, "POST /event", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(srv)), "a request signed with another key: 403, refused");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                check(c.status("POST", "/event", "X-Hermux-Auth: " + c.auth(K, c.ns, "POST /event", body) + "\r\n", utf8("{\"kind\":\"status\"}")) == 403
                        && "refused refused".equals(drain(srv)), "a body changed after the MAC: 403");
            }
            try (Raw a1 = new Raw(srv.port); Raw b1 = new Raw(srv.port)) {
                a1.hello();
                b1.hello();
                b1.nc = a1.nc;
                check(b1.status("POST", "/event", "X-Hermux-Auth: " + b1.auth(K, a1.ns, "POST /event", body) + "\r\n", body) == 403
                        && "refused refused".equals(drain(srv)), "a server nonce from another connection: 403");
            }
            check("closed".equals(drain(srv)), "... and that other connection, never used, ends with nothing handled");
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                String h = c.auth(K, c.ns, "POST /event", body);
                check(c.status("POST", "/event", "X-Hermux-Auth: " + h + "\r\n", body) == 204 && "EVENT MAC".equals(drain(srv)), "the hand-made client, done right, gets in");
                try { c.send(ascii("POST /event HTTP/1.1\r\nX-Hermux-Auth: " + h + "\r\nContent-Length: " + body.length + "\r\n\r\n")); c.send(body); }
                catch (IOException ignored) { }
                check((Integer) c.answer()[0] < 0, "the same signed request again on that connection: nothing (one request per hello)");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K + "\r\n", body) == 403 && "refused refused".equals(drain(srv)),
                        "after a hello the raw key counts for nothing: X-Hermux-Auth is needed (403)");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                Object[] x = c.request("POST", "/phonedata", "", utf8("{}"));
                check((Integer) x[0] == 403 && FORBID.equals(x[1]) && "refused refused".equals(drain(srv)), "/phonedata after a hello without a MAC: 403 with its own forbidden answer");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                check(c.status("GET", "/hermux/hello?v=1&nc=" + LocalAuth.nonce(), "", NONE) == 400 && "refused bad_request".equals(drain(srv)), "a second hello on one connection: 400");
            }

            // The raw key, as before local authentication.
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K + "\r\nContent-Type: application/json\r\n", body) == 204 && "EVENT RAW".equals(drain(srv)),
                        "an event with the raw key still gets in (204)");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + OTHER + "\r\n", body) == 403 && "EVENT NONE".equals(drain(srv)), "... a wrong raw key gets 403");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "", body) == 403 && "EVENT NONE".equals(drain(srv)), "... no key gets 403");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/phonedata", "X-Hermes-Mobile-Key: " + K + "\r\n", utf8("{\"op\":\"status\"}")) == 200 && "PHONEDATA RAW".equals(drain(srv)),
                        "/phonedata with the raw key still gets in");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /phonedata HTTP/1.1\r\nX-Hermes-Mobile-Key: " + OTHER + "\r\nContent-Length: 100\r\n\r\n")); // no body sent
                long t0 = System.nanoTime();
                Object[] x = c.answer();
                check((Integer) x[0] == 403 && FORBID.equals(x[1]) && (System.nanoTime() - t0) / 1_000_000 < 1000 && "refused no_key".equals(drain(srv)),
                        "/phonedata with a wrong raw key: 403 and its forbidden answer before the body is read");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/setup", "", utf8(setupBody(SETUP_TOKEN))) == 204 && "SETUP NONE".equals(drain(srv)),
                        "/setup needs no key: its own one-time token lets the line in (204)");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/setup", "", utf8(setupBody("wrong-token-0123456789"))) == 403 && "SETUP NONE".equals(drain(srv)),
                        "... a wrong setup token gets 403, with or without the key");
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/setup", "X-Hermes-Mobile-Key: " + K + "\r\n", utf8(setupBody("wrong-token-0123456789"))) == 403 && "SETUP RAW".equals(drain(srv)),
                        "... the event key does not stand in for the setup token");
            }
            try (Raw c = new Raw(srv.port)) {
                bundleToken = "tok123";
                c.send(ascii("GET /plugin-bundle/tok123 HTTP/1.1\r\n\r\n"));
                check((Integer) c.answer()[0] == 200 && "BUNDLE NONE".equals(drain(srv)), "/plugin-bundle/<token> needs no key: the one-time token");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("GET /plugin-bundle/tok123 HTTP/1.1\r\nX-Hermes-Mobile-Key: " + K + "\r\n\r\n"));
                check((Integer) c.answer()[0] == 403 && "BUNDLE RAW".equals(drain(srv)), "... used once: the same token again gets 403, even with the key");
            }
            try (Raw c = new Raw(srv.port)) {
                bundleToken = "tok123";
                c.send(ascii("GET /plugin-bundle/tok124 HTTP/1.1\r\n\r\n"));
                check((Integer) c.answer()[0] == 403 && "BUNDLE NONE".equals(drain(srv)), "... a wrong bundle token gets 403");
            }
            check(!EventsListener.tokenMatches(null, "tok123") && !EventsListener.tokenMatches("tok123", null) && !EventsListener.tokenMatches("tok123", "tok12")
                    && EventsListener.tokenMatches("tok123", "tok123"), "tokenMatches: none, a missing, a shorter and the same token");
            for (EventsListener.Route rt : EventsListener.Route.values()) {
                EventsListener.Verdict without = EventsListener.verdict(fakeRequest(rt, LocalServer.Auth.NONE));
                boolean needsKey = rt == EventsListener.Route.EVENT || rt == EventsListener.Route.PHONEDATA;
                check(needsKey ? without == EventsListener.Verdict.NO_KEY : without.name().equals(rt.name()),
                        "verdict: " + rt + " without the key: " + without);
                for (LocalServer.Auth au : new LocalServer.Auth[] {LocalServer.Auth.RAW, LocalServer.Auth.MAC})
                    check(EventsListener.verdict(fakeRequest(rt, au)).name().equals(rt.name()), "verdict: " + rt + " with " + au);
            }
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "", body) == 403 && "EVENT NONE".equals(drain(srv)), "an event without the key: 403");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /event HTTP/1.1\r\nX-Hermes-Mobile-Key: " + K + "\r\nContent-Length: 2\r\n\r\n{}"
                        + "GET /hermux/hello?v=1&nc=" + LocalAuth.nonce() + " HTTP/1.1\r\n\r\n"));
                check((Integer) c.answer()[0] == 204 && "EVENT RAW".equals(drain(srv)) && (Integer) c.answer()[0] < 0,
                        "a hello after a request on the same connection gets nothing: the hello must come first");
            }
            check(EventsListener.route("POST", "/setup?x") == EventsListener.Route.EVENT && EventsListener.route("GET", "/setup") == EventsListener.Route.EVENT
                    && EventsListener.route("POST", "/plugin-bundle/x") == EventsListener.Route.EVENT && EventsListener.route("POST", "/phonedata") == EventsListener.Route.PHONEDATA,
                    "routes match exact methods and targets as before; anything else is an event");

            // Bounds per route, for both kinds of caller.
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /event HTTP/1.1\r\nX-Hermes-Mobile-Key: " + K + "\r\nContent-Length: " + (EventsListener.EVENT_MAX_BODY + 1) + "\r\n\r\n"));
                check((Integer) c.answer()[0] == 413 && "refused too_large".equals(drain(srv)), "an event body over 256 KiB: 413 before it is read");
            }
            try (Raw c = new Raw(srv.port)) {
                byte[] big = new byte[EventsListener.EVENT_MAX_BODY];
                Arrays.fill(big, (byte) ' ');
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K + "\r\n", big) == 204 && "EVENT RAW".equals(drain(srv)), "an event body of exactly 256 KiB gets in");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /setup HTTP/1.1\r\nContent-Length: " + (EventsListener.SETUP_MAX_BODY + 1) + "\r\n\r\n"));
                check((Integer) c.answer()[0] == 413 && "refused too_large".equals(drain(srv)), "a /setup body over 1 KiB: 413");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /phonedata HTTP/1.1\r\nX-Hermes-Mobile-Key: " + K + "\r\nContent-Length: " + (EventsListener.PHONE_MAX_BODY + 1) + "\r\n\r\n"));
                Object[] x = c.answer();
                check((Integer) x[0] == 200 && TOO_BIG.equals(x[1]) && "refused too_large".equals(drain(srv)), "a /phonedata body over 4 KiB with the key: its bad_request answer");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                c.send(ascii("POST /phonedata HTTP/1.1\r\nX-Hermux-Auth: 1 x\r\nContent-Length: " + (EventsListener.PHONE_MAX_BODY + 1) + "\r\n\r\n"));
                Object[] x = c.answer();
                check((Integer) x[0] == 200 && TOO_BIG.equals(x[1]) && "refused too_large".equals(drain(srv)), "... the same after a hello");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                c.send(ascii("POST /event HTTP/1.1\r\nContent-Length: " + (EventsListener.EVENT_MAX_BODY + 1) + "\r\n\r\n"));
                check((Integer) c.answer()[0] == 413 && "refused too_large".equals(drain(srv)), "an event body over 256 KiB after a hello: 413");
            }
            StringBuilder big = new StringBuilder();
            while (big.length() < 9000) big.append('a');
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /event HTTP/1.1\r\nX-Big: " + big + "\r\n\r\n"));
                int st = (Integer) c.answer()[0];
                check((st == 400 || st == -2) && "refused bad_request".equals(drain(srv)), "a head over 8 KiB: refused (" + st + ")");
            }
            try (Raw c = new Raw(srv.port)) {
                c.send(ascii("POST /event HTTP/1.1\nX-Hermes-Mobile-Key: " + K + "\n\n"));
                check((Integer) c.answer()[0] == 400 && "refused bad_request".equals(drain(srv)), "a head with bare LF line endings: 400");
            }

            // Rotation: the previous key raw during its grace only; a signed request cuts the grace.
            KEYS.rotate("user");
            String K2 = KEYS.current();
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K + "\r\n", body) == 204 && "EVENT RAW".equals(drain(srv)), "after a rotation the previous raw key works during its grace");
            }
            try (Raw c = new Raw(srv.port)) {
                c.hello();
                check(LocalAuth.kid(K2).equals(c.kid), "after a rotation the hello proves with the new key");
            }
            check("closed".equals(drain(srv)), "... (that connection sent nothing more)");
            try { LocalClient.open("events", srv.port, kid -> kid.equals(LocalAuth.kid(K)) ? K : null); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("unknown_kid".equals(why) && "closed".equals(drain(srv)), "a client with only the previous key and no hint: unknown_kid, nothing sent");
            ans = LocalClient.open("events", srv.port, holding(K)).request("POST", "/event", body);
            got = srv.next();
            r = got instanceof EventsListener.Request ? (EventsListener.Request) got : null;
            check(ans.status == 204 && r != null && r.auth() == LocalServer.Auth.MAC && LocalAuth.kid(K).equals(r.kid()),
                    "a client still holding the previous key names it (kid hint) and completes the signed exchange during the grace");
            check(STORE.getLong("event_key_prev_until") > now + LocalKey.CONFIRM_MS, "... which does not cut the grace (only the new key's id does)");
            try { LocalClient.open("events", srv.port, holding(OTHER)); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("unknown_kid".equals(why) && "closed".equals(drain(srv)), "a client with an unknown key and its hint: unknown_kid, nothing sent");
            ans = LocalClient.open("events", srv.port, KEYS).request("POST", "/event", body);
            check(ans.status == 204 && "EVENT MAC".equals(drain(srv)), "a client with the new key gets in");
            check(STORE.getLong("event_key_prev_until") == now + LocalKey.CONFIRM_MS, "... and its signed request cuts the previous key's grace to 2 minutes");
            now += LocalKey.CONFIRM_MS;
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K + "\r\n", body) == 403 && "EVENT NONE".equals(drain(srv)), "after the grace the previous raw key gets 403");
            }
            try { LocalClient.open("events", srv.port, holding(K)); why = "verified"; } catch (LocalClient.Unverified u) { why = u.why; }
            check("unknown_kid".equals(why) && "closed".equals(drain(srv)), "after the grace a client holding the previous key gets unknown_kid and sends nothing");
            try (Raw c = new Raw(srv.port)) {
                check(c.status("POST", "/event", "X-Hermes-Mobile-Key: " + K2 + "\r\n", body) == 204 && "EVENT RAW".equals(drain(srv)), "... the new raw key still works");
            }

            t1.join(15000);
            t2.join(20000);
            long pms = tp[1] instanceof Long ? (Long) tp[1] : -1, ems = te[1] instanceof Long ? (Long) te[1] : -1;
            check(tp[0] instanceof Integer && (Integer) tp[0] < 0 && pms >= EventsListener.PHONE_DEADLINE_MS - 300 && pms < EventsListener.PHONE_DEADLINE_MS + 2500,
                    "a /phonedata request trickled in is cut off 4 s after its request line, unanswered (" + tp[0] + " after " + pms + " ms)");
            check(te[0] instanceof Integer && (Integer) te[0] < 0 && ems >= LocalServer.DEADLINE_MS - 500 && ems < LocalServer.DEADLINE_MS + 3000,
                    "an event trickled in is cut off at the 10 s connection deadline (" + te[0] + " after " + ems + " ms)");
            String d1 = drain(slow), d2 = drain(slow);
            check("io SocketTimeoutException".equals(d1) && "io SocketTimeoutException".equals(d2), "... both as timeouts, nothing handled (" + d1 + ", " + d2 + ")");
        }

        // The bind retry plan.
        long[] want = {1000, 2000, 4000, 8000, 16000, 32000, 60000, 300000, 300000};
        long since = 0;
        boolean seq = true;
        for (int f = 1; f <= want.length; f++) {
            long d = EventsListener.delayBefore(f, since);
            if (d != want[f - 1]) seq = false;
            since += d;
        }
        check(seq, "back-off: 1, 2, 4, 8, 16, 32, 60 s, then every 5 minutes");
        int tries = 0;
        since = 0;
        for (int f = 1; ; f++) {
            long d = EventsListener.delayBefore(f, since);
            if (d < 0) break;
            since += d;
            tries++;
            if (tries > 100) break;
        }
        check(tries < 30 && since <= EventsListener.RETRY_STOP_MS && since > EventsListener.RETRY_STOP_MS - EventsListener.RETRY_SLOW_MS,
                "the tries stop within an hour of the first failure (" + tries + " tries, the last at " + since / 1000 + " s)");
        check(EventsListener.delayBefore(8, EventsListener.RETRY_STOP_MS - 299_999) == -1 && EventsListener.delayBefore(8, EventsListener.RETRY_STOP_MS - 300_000) == 300_000,
                "no try is scheduled past the hour");
        check(EventsListener.delayBefore(0, 0) == -1 && EventsListener.delayBefore(1, -1) == -1, "no failure (or a time before the first): no try");
        check(EventsListener.newRun(-1, false, 5) && !EventsListener.newRun(0, false, 3_600_000) && EventsListener.newRun(0, false, 3_600_001),
                "a new run starts with no run, or (once the port opened) after the run's hour");
        check(!EventsListener.newRun(0, true, 5) && !EventsListener.newRun(0, true, 10 * 3_600_000L), "a run that gave up never starts again by itself");

        // the whole state, as HermesService drives it
        EventsListener.Retry rt = new EventsListener.Retry();
        long t = 0, d;
        int scheduled = 0;
        d = rt.failed(t);
        check(rt.started && d == 1000, "the first failure starts a run; the next try in 1 s");
        while (d >= 0) { t += d; scheduled++; d = rt.failed(t); }
        check(rt.gaveUp && scheduled < 30 && t <= EventsListener.RETRY_STOP_MS, "the scheduled tries end within the hour (" + scheduled + ")");
        int before = rt.failures;
        long first = rt.firstFailMs;
        boolean nudgeSchedules = false, nudgeRestarts = false;
        for (int i = 1; i <= 2000; i++) { // a nudge every 10 s for more than 5 hours, each try failing
            long dd = rt.failed(t + i * EventsListener.NUDGE_MS);
            nudgeSchedules |= dd >= 0;
            nudgeRestarts |= rt.started;
        }
        check(!nudgeSchedules && !nudgeRestarts && rt.gaveUp && rt.firstFailMs == first && rt.failures == before + 2000,
                "after giving up, each nudge is exactly one try: nothing scheduled, the run is not restarted");
        rt.opened();
        d = rt.failed(first + 30 * 60_000L);
        check(!rt.started && d == 300_000, "a port that opened and is lost again within the hour goes on with the long delay");
        rt.opened();
        d = rt.failed(t + 3 * 3_600_000L);
        check(rt.started && d == 1000, "... and more than an hour later a new run starts at 1 s");
        check(EventsListener.every(-1, 0, 10_000) && !EventsListener.every(0, 9_999, 10_000) && EventsListener.every(0, 10_000, 10_000) && EventsListener.NUDGE_MS == 10_000,
                "a nudge tries at most once per 10 s");
        check(EventsListener.every(50_000, 10, 10_000), "a clock that went back allows a try");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -Xmx96m -cp "$T/out" com.omarqaterge.hermesmobile.EventsListenerTest
