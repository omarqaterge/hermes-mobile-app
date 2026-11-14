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
    static final int MAX_BODY = EventsListener.PHONE_MAX_BODY;
    /** One socket read waits at most this long, and the whole request (headers and body) must be in within the deadline
     *  (EventsListener applies both once the request line is in). */
    static final int READ_TIMEOUT_MS = EventsListener.PHONE_READ_MS;
    static final long READ_DEADLINE_MS = EventsListener.PHONE_DEADLINE_MS;

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

    private static PhoneDataChats chats;

    /** The app's record of chats that asked to read phone data (ids only, in app-private preferences). */
    static synchronized PhoneDataChats chats(Context c) {
        if (chats == null) {
            final Context app = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            chats = new PhoneDataChats(new PhoneDataChats.Store() {
                @Override public String load() {
                    return app.getSharedPreferences("hm_phone_chats", Context.MODE_PRIVATE).getString("ids", null);
                }
                @Override public void save(String text) {
                    app.getSharedPreferences("hm_phone_chats", Context.MODE_PRIVATE).edit().putString("ids", text).apply();
                }
            });
        }
        return chats;
    }

    /** Write the record now if saves are waiting (they are batched to one a second); the app calls it when it pauses. */
    static void flushChats() {
        try {
            PhoneDataChats c;
            synchronized (PhoneDataRoute.class) { c = chats; }
            if (c != null) c.flush();
        } catch (Throwable ignored) {
            // best effort
        }
    }

    /** Remember the chat of a read request before anything else decides its outcome: refused, off, locked or failed all count. */
    private static void remember(Context c, JSONObject req) {
        try {
            if (req == null || !"read".equals(req.optString("op", ""))) return;
            java.util.List<Object> extra = new java.util.ArrayList<>();
            org.json.JSONArray a = req.optJSONArray("chats");
            if (a != null) for (int i = 0; i < a.length() && i < PhoneDataChats.MAX_LIST; i++) extra.add(a.opt(i));
            chats(c).record(req.opt("session"), extra);
        } catch (Throwable ignored) {
            // never changes the answer
        }
    }

    /**
     * {@code {"op":"taint","chats":[...]}}: the plugin says these chats have read phone data (a chat it already marks got
     * a new id when Hermes compressed it). Only ADDS ids to the record, with the limits of a read's {@code chats} (16
     * entries, 128 characters each); no grant is made or needed and no other state changes. A body without a valid id is
     * {@code bad_request}.
     */
    private static String taint(Context c, JSONObject req) {
        try {
            org.json.JSONArray a = req == null ? null : req.optJSONArray("chats");
            if (a == null) return fail("bad_request");
            java.util.List<Object> list = new java.util.ArrayList<>();
            for (int i = 0; i < a.length() && i < PhoneDataChats.MAX_LIST; i++) list.add(a.opt(i));
            return chats(c).taint(list) ? "{\"ok\":true}" : fail("bad_request");
        } catch (Throwable t) {
            return fail("failed");
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
                        .put("kinds", s.optJSONObject("kinds"))
                        .put("locked", MainActivity.keyguardLocked(c)).toString();
            }
            if ("taint".equals(op)) return taint(c, req); // the plugin: a chat that has read got a new id (no grant, no READY needed)
            remember(c, req);
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
            boolean switches = PhoneData.switchOn(c, "master") && PhoneData.switchOn(c, kind);
            boolean allowed = PhoneData.allowed(c, kind); // sweeps a kind whose permission is gone (so no_permission is answered once)
            String why = PhoneDataGrants.refusal(true, true, switches, allowed, PhoneData.permitted(c, kind), MainActivity.keyguardLocked(c));
            if (why != null) return done(c, kind, why);
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
