package com.omarqaterge.hermesmobile;

import java.io.IOException;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * The plain parts of the app's own listener on {@code 127.0.0.1:9121} ({@code HermesService.serve} and {@code handle}):
 * reading one connection through {@link LocalServer} with role {@code events}, and when to try binding the port again.
 * Plain Java (no Android classes) so {@code tools/test_events_listener.sh} drives it with a JDK on real sockets.
 *
 * <p>{@link #read} takes either a connection that opens with the hello and then carries one request signed with
 * {@code X-Hermux-Auth} (the MAC over the raw body bytes), or, while {@link LocalKey#rawAccepted} says so, one request
 * with the raw key in {@code X-Hermes-Mobile-Key}, exactly as before local authentication. Every route keeps its
 * bounds for both kinds of caller: {@code POST /phonedata} at most {@link #PHONE_MAX_BODY} bytes, {@link #PHONE_READ_MS}
 * per read and {@link #PHONE_DEADLINE_MS} once its request line is in, its own JSON answers for a request without the
 * key (before the body is read) and for a body too large; {@code POST /setup} at most {@link #SETUP_MAX_BODY} bytes;
 * every other request (an event, {@code GET /plugin-bundle/<token>}) at most {@link #EVENT_MAX_BODY} bytes.
 */
final class EventsListener {
    private EventsListener() {}

    static final String ROLE = "events";
    /** The raw key header, accepted until local authentication is enforced. */
    static final String KEY_HEADER = "x-hermes-mobile-key";
    static final int EVENT_MAX_BODY = 256 * 1024;
    static final int SETUP_MAX_BODY = 1024;
    static final int PHONE_MAX_BODY = 4096;
    static final int PHONE_READ_MS = 1500;
    static final long PHONE_DEADLINE_MS = 4000;
    static final String BUNDLE_PREFIX = "/plugin-bundle/";

    /** Which handler a request goes to. */
    enum Route { EVENT, SETUP, PHONEDATA, BUNDLE }

    /** One request as {@code handle} sees it: its route, how it got in, its raw body and (for a bundle) the token. */
    static final class Request {
        final Route route;
        final LocalServer.Request req;
        /** The one-time token of {@code GET /plugin-bundle/<token>}; null for other routes. */
        final String bundleToken;

        Request(Route route, LocalServer.Request req, String bundleToken) {
            this.route = route; this.req = req; this.bundleToken = bundleToken;
        }

        /** The request carried the key: a MAC after a verified hello, or the raw key while it is accepted. */
        boolean keyOk() { return req.auth != LocalServer.Auth.NONE; }

        LocalServer.Auth auth() { return req.auth; }

        /** The key id of a MAC request (for {@link LocalKey#confirm}); null otherwise. */
        String kid() { return req.kid; }

        /** The body decoded as UTF-8 (malformed bytes replaced), for the JSON handlers. */
        String text() { return new String(req.body, StandardCharsets.UTF_8); }
    }

    /** The route of a request line: exact targets as before local authentication; anything else is an event. */
    static Route route(String method, String target) {
        if ("POST".equals(method) && "/setup".equals(target)) return Route.SETUP;
        if ("POST".equals(method) && "/phonedata".equals(target)) return Route.PHONEDATA;
        if ("GET".equals(method) && target.startsWith(BUNDLE_PREFIX)) return Route.BUNDLE;
        return Route.EVENT;
    }

    /**
     * Reads one connection. Null when the client closed without a request (after a hello, say). Throws
     * {@link LocalServer.Refused} after writing its answer (malformed, too large, or {@code why} {@code refused}: a
     * missing or wrong MAC after a hello), and other IOExceptions (a timeout) with nothing written.
     *
     * @param phoneForbidden the {@code /phonedata} answer for a request without the key (status 403)
     * @param phoneTooLarge  the {@code /phonedata} answer for a body over {@link #PHONE_MAX_BODY} (status 200)
     */
    static Request read(Socket s, LocalKey keys, String phoneForbidden, String phoneTooLarge) throws IOException {
        final LocalServer.Limits event = new LocalServer.Limits(EVENT_MAX_BODY, LocalServer.READ_MS, LocalServer.DEADLINE_MS, null, null);
        final LocalServer.Limits setup = new LocalServer.Limits(SETUP_MAX_BODY, LocalServer.READ_MS, LocalServer.DEADLINE_MS, null, null);
        final LocalServer.Limits phone = new LocalServer.Limits(PHONE_MAX_BODY, PHONE_READ_MS, PHONE_DEADLINE_MS,
                new LocalServer.Answer(403, "application/json", phoneForbidden.getBytes(StandardCharsets.UTF_8)),
                new LocalServer.Answer(200, "application/json", phoneTooLarge.getBytes(StandardCharsets.UTF_8)));
        LocalServer.Request r = LocalServer.accept(s, ROLE, keys.serverKeys(), keys.rawAccepted() ? KEY_HEADER : null, (m, t) -> {
            switch (route(m, t)) {
                case SETUP: return setup;
                case PHONEDATA: return phone;
                default: return event;
            }
        });
        if (r == null) return null;
        Route route = route(r.method, r.target);
        return new Request(route, r, route == Route.BUNDLE ? r.target.substring(BUNDLE_PREFIX.length()) : null);
    }

    // ── binding the port again when it is held ──

    /** The back-off doubles from 1 s up to this, */
    static final long RETRY_CAP_MS = 60_000;
    /** then the tries come this far apart, */
    static final long RETRY_SLOW_MS = 300_000;
    /** and none is scheduled later than this after the first failure of a run of failures. */
    static final long RETRY_STOP_MS = 3_600_000;
    /** A nudge (the app on screen, StartReceiver, BootReceiver) tries at most this often. */
    static final long NUDGE_MS = 10_000;

    /**
     * The delay before the next try to bind, after {@code failures} failed tries in a row (1 after the first), the first
     * of them {@code sinceFirstMs} ago: 1, 2, 4, 8, 16, 32 s, then 60 s, then every 5 minutes; -1 (stop) once the next
     * try would come more than an hour after the first failure. Real time, so time asleep counts.
     */
    static long delayBefore(int failures, long sinceFirstMs) {
        if (failures < 1 || sinceFirstMs < 0) return -1;
        long d;
        if (failures <= 6) d = 1000L << (failures - 1);
        else if (failures == 7) d = RETRY_CAP_MS;
        else d = RETRY_SLOW_MS;
        return sinceFirstMs + d > RETRY_STOP_MS ? -1 : d;
    }

    /**
     * Whether a failed try starts a new run of tries (the back-off from 1 s again): there was no run, or the port opened
     * since and the run began more than {@link #RETRY_STOP_MS} ago. A run that gave up stays given up until the port
     * opens: a nudge then makes exactly one try and schedules nothing. A port that opens keeps its run (the caller
     * clears {@code gaveUp}), so losing it again soon does not reset the back-off.
     */
    static boolean newRun(long firstFailMs, boolean gaveUp, long nowMs) {
        if (firstFailMs < 0) return true;
        return !gaveUp && (nowMs - firstFailMs > RETRY_STOP_MS || nowMs < firstFailMs);
    }

    /**
     * The state of the tries to open the port (HermesService keeps one, on the main thread). {@link #failed} is called
     * for every failed try, scheduled or nudged, and gives the delay before the next scheduled try or -1 for none;
     * {@link #opened} when the port opens.
     */
    static final class Retry {
        int failures;
        long firstFailMs = -1;
        boolean gaveUp;
        /** The last failure started a new run (the caller records it once). */
        boolean started;

        long failed(long nowMs) {
            started = newRun(firstFailMs, gaveUp, nowMs);
            if (started) {
                firstFailMs = nowMs;
                failures = 0;
                gaveUp = false;
            }
            failures++;
            if (gaveUp) return -1; // given up: this was a nudge's one try, and nothing is scheduled
            long d = delayBefore(failures, nowMs - firstFailMs);
            if (d < 0) gaveUp = true;
            return d;
        }

        void opened() {
            gaveUp = false;
        }
    }

    // ── what handle does with a request ──

    /** What {@code HermesService.handle} does with a request. */
    enum Verdict {
        /** An event with the key: answer 204, then handle it. */
        EVENT,
        /** A phone-data read with the key. */
        PHONEDATA,
        /** The installer's progress: its own one-time token decides (SetupLines), no key needed. */
        SETUP,
        /** The plugin bundle: its own one-time token decides ({@link #tokenMatches}), no key needed. */
        BUNDLE,
        /** An event or a phone-data read without the key: 403 (phone data with its own forbidden answer). */
        NO_KEY
    }

    /** The decision for one request: {@code /setup} and the bundle keep their one-time tokens; the rest need the key. */
    static Verdict verdict(Request r) {
        switch (r.route) {
            case SETUP: return Verdict.SETUP;
            case BUNDLE: return Verdict.BUNDLE;
            case PHONEDATA: return r.keyOk() ? Verdict.PHONEDATA : Verdict.NO_KEY;
            default: return r.keyOk() ? Verdict.EVENT : Verdict.NO_KEY;
        }
    }

    /** A one-time token check in constant time: false when either is null or they differ. */
    static boolean tokenMatches(String want, String got) {
        return want != null && got != null && LocalAuth.same(want, got);
    }

    /**
     * A rate limit: true for the first time ({@code lastMs} < 0), then once {@code periodMs} has passed (a nudge every
     * {@link #NUDGE_MS}, a diagnostic event once a minute or an hour). Monotonic times.
     */
    static boolean every(long lastMs, long nowMs, long periodMs) {
        return lastMs < 0 || nowMs - lastMs >= periodMs || nowMs < lastMs;
    }
}
