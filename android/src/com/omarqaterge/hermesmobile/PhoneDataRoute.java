package com.omarqaterge.hermesmobile;

import android.content.Context;

import com.omarqaterge.hermesmobile.phonedata.Result;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * {@code POST /phonedata} on the service's loopback port (the contract in docs/status/phone-data.md): the plugin asks
 * the app to read the phone, and the app decides. The key was checked by {@link HermesService#handle}; this class
 * applies the rest of the checks in the contract's order and runs the read on its own small thread pool, so a slow read
 * (a location fix) never holds up the single thread that takes {@code /event}. Nothing here logs or returns data, args
 * or exception text except the rows of a successful read; the diagnostic log gets a kind and an outcome token only.
 */
final class PhoneDataRoute {
    private PhoneDataRoute() {}

    /** The largest request body (the args are tiny). */
    static final int MAX_BODY = 4096;
    /** One socket read waits at most this long, and the whole request (headers and body) must be in within the deadline. */
    static final int READ_TIMEOUT_MS = 1500;
    static final long READ_DEADLINE_MS = 4000;

    /** Two reads at a time, four waiting; more is answered {@code failed} at once. Threads end when idle. */
    static final ThreadPoolExecutor POOL = new ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4), r -> {
        Thread t = new Thread(r, "hermes-phonedata");
        t.setDaemon(true);
        return t;
    });

    static {
        POOL.allowCoreThreadTimeOut(true);
    }

    /** Runs {@code job} off the caller's thread; false when the pool is full (the caller answers {@code failed}). */
    static boolean submit(Runnable job) {
        try {
            POOL.execute(job);
            return true;
        } catch (RejectedExecutionException e) {
            return false;
        }
    }

    static String fail(String reason) {
        return "{\"ok\":false,\"reason\":\"" + reason + "\"}";
    }

    /** The answer to one request body. Never throws; the answer holds no exception text. */
    static String answer(Context c, String body) {
        JSONObject req = null;
        try {
            req = new JSONObject(body);
        } catch (Exception ignored) {
            // answered below: not_ready first, then bad_request
        }
        String op = req == null ? "" : req.optString("op", "");
        try {
            if ("status".equals(op)) {
                JSONObject s = PhoneData.status(c);
                return new JSONObject().put("ok", true).put("ready", s.optBoolean("ready")).put("master", s.optBoolean("master"))
                        .put("kinds", s.optJSONObject("kinds")).toString();
            }
            if (!PhoneData.READY) return fail("not_ready");
            return read(c, req);
        } catch (Throwable t) {
            return fail("failed");
        }
    }

    private static String read(Context c, JSONObject req) {
        String kind = "?";
        try {
            // bad_request: the shape only; the reader checks the args' keys and limits again.
            if (req == null || !"read".equals(req.optString("op", ""))) return fail("bad_request");
            Object s = req.opt("session"), n = req.opt("nonce"), k = req.opt("kind"), a = req.opt("args");
            if (!(s instanceof String) || !(n instanceof String) || !(k instanceof String) || !(a instanceof String)) return fail("bad_request");
            String session = (String) s, nonce = (String) n, args = (String) a;
            kind = (String) k;
            if (session.isEmpty() || session.length() > 128 || !nonce.matches("[0-9a-f]{12}") || !PhoneData.isKind(kind)
                    || args.length() > PhoneDataGrants.MAX_ARGS) {
                kind = PhoneData.isKind(kind) ? kind : "?";
                return done(c, kind, "bad_request");
            }
            JSONObject argObj;
            try {
                argObj = new JSONObject(args);
            } catch (JSONException e) {
                return done(c, kind, "bad_request");
            }
            String gate = gate(c, kind);
            if (gate != null) return done(c, kind, gate);
            if (MainActivity.keyguardLocked(c)) return done(c, kind, "locked");
            // The pass first, so a grant is not used up needlessly; otherwise the one-use grant for exactly this read.
            boolean pass = PhoneDataGrants.hasFullAccess(session);
            if (!pass && !PhoneDataGrants.consume(nonce, kind, args)) return done(c, kind, "no_grant");
            try {
                Result r = PhoneData.read(c, kind, argObj);
                String out = new JSONObject().put("ok", true).put("kind", kind).put("items", r.items).put("truncated", r.truncated).toString();
                log(c, kind, pass ? "ok_full" : "ok");
                return out;
            } catch (IllegalArgumentException e) {
                return done(c, kind, "bad_request");
            } catch (Throwable t) {
                return done(c, kind, "failed");
            }
        } catch (Throwable t) {
            return done(c, kind, "failed");
        }
    }

    /** The contract's off / no_permission, or null when the kind may be read. {@code no_permission} is answered when the
     *  master and the kind's switches are on but Android no longer lets the app read: {@code PhoneData.allowed} then
     *  switches the kind off (it sweeps), so the next read answers {@code off}. */
    static String gate(Context c, String kind) {
        boolean switches = PhoneData.switchOn(c, "master") && PhoneData.switchOn(c, kind);
        boolean allowed = PhoneData.allowed(c, kind); // sweeps a kind whose permission is gone
        if (allowed) return null;
        return PhoneDataGrants.gateReason(switches, PhoneData.permitted(c, kind));
    }

    private static String done(Context c, String kind, String reason) {
        log(c, kind, reason);
        return fail(reason);
    }

    /** Fixed tokens only: the kind and how it ended. Never a value from the request. */
    private static void log(Context c, String kind, String outcome) {
        try {
            HermuxApp.log(c).event("phonedata", "read", "kind", kind, "outcome", outcome);
        } catch (Throwable ignored) {
            // logging never matters here
        }
    }
}
