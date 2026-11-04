package com.omarqaterge.hermesmobile;

import android.content.Context;

import com.omarqaterge.hermesmobile.phonedata.Result;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.DateFormat;
import java.util.Date;
import java.util.Iterator;
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
            // off: the master, the kind's switch or its Android permission is missing (the contract also names
            // no_permission; PhoneData.allowed is one yes/no, so both answer off until it can tell them apart).
            if (!PhoneData.allowed(c, kind)) return done(c, kind, "off");
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

    // ── wording: what the user is asked to allow, written from the decoded args, never from plugin text ──

    private static final int MAX_TEXT = 64;

    /** The plain sentence for a phone-data approval text, or null when it doesn't parse or its args are not exactly the
     *  contract's (then the app offers Deny only). The decoded text is data: it is shown as text, never as markup. */
    static String wording(String description) {
        PhoneDataGrants.Parsed p = PhoneDataGrants.parse(description);
        if (p == null) return null;
        try {
            JSONObject a = new JSONObject(p.args);
            String[] allowed = allowedKeys(p.kind);
            for (Iterator<String> it = a.keys(); it.hasNext(); ) {
                String key = it.next();
                boolean ok = false;
                for (String x : allowed) ok |= x.equals(key);
                if (!ok) return null;
            }
            int limit = 20;
            if (a.has("limit")) {
                Object l = a.get("limit");
                if (!(l instanceof Integer) || (Integer) l < 1 || (Integer) l > 50) return null;
                limit = (Integer) l;
            }
            String query = text(a, "query");
            String sender = text(a, "sender");
            if ((a.has("query") && query == null) || (a.has("sender") && sender == null)) return null;
            Long from = ms(a, "from_ms"), to = ms(a, "to_ms");
            if ((a.has("from_ms") && from == null) || (a.has("to_ms") && to == null)) return null;
            String box = "all";
            if (a.has("box")) {
                Object b = a.get("box");
                if (!(b instanceof String) || !("inbox".equals(b) || "sent".equals(b) || "all".equals(b))) return null;
                box = (String) b;
            }
            switch (p.kind) {
                case "contacts":
                    return "Read up to " + limit + (limit == 1 ? " contact" : " contacts")
                            + (query != null && !query.isEmpty() ? " matching “" + query + "”" : "") + " from your address book";
                case "calendar":
                    return "Read up to " + limit + (limit == 1 ? " calendar event" : " calendar events") + range(from, to, "in the next 7 days");
                case "calls":
                    return "Read up to " + limit + (limit == 1 ? " call log entry" : " call log entries") + range(from, to, "from the last 7 days");
                case "sms":
                    return "Read up to " + limit + (limit == 1 ? " text message" : " text messages")
                            + ("inbox".equals(box) ? " you received" : "sent".equals(box) ? " you sent" : "")
                            + (sender != null && !sender.isEmpty() ? " from or to “" + sender + "”" : "");
                case "location":
                    return "Read your approximate location";
                case "photos":
                    return "Read the date, size and dimensions of your latest " + limit + (limit == 1 ? " photo" : " photos") + " (no pictures)";
                default:
                    return null;
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String[] allowedKeys(String kind) {
        switch (kind) {
            case "contacts": return new String[]{"limit", "query"};
            case "calendar":
            case "calls": return new String[]{"limit", "from_ms", "to_ms"};
            case "sms": return new String[]{"limit", "box", "sender"};
            case "photos": return new String[]{"limit"};
            default: return new String[0];
        }
    }

    /** A string arg of at most 64 characters with control characters turned into spaces; null if absent or not that. */
    private static String text(JSONObject a, String key) {
        if (!a.has(key)) return null;
        Object v = a.opt(key);
        if (!(v instanceof String) || ((String) v).length() > MAX_TEXT) return null;
        return ((String) v).replaceAll("[\\p{Cntrl}\\p{Cf}\\u2028\\u2029]", " ").trim();
    }

    private static Long ms(JSONObject a, String key) {
        if (!a.has(key)) return null;
        Object v = a.opt(key);
        if (v instanceof Integer) return ((Integer) v).longValue();
        if (v instanceof Long) return (Long) v;
        return null;
    }

    private static String range(Long from, Long to, String dflt) {
        if (from == null && to == null) return " " + dflt;
        DateFormat f = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
        return " between " + (from == null ? "now" : f.format(new Date(from))) + " and " + (to == null ? "the end of the default range" : f.format(new Date(to)));
    }

    /** The text of a phone-data approval notification: the wording, or a warning when the request can't be read. */
    static String notificationText(String description) {
        String w = wording(description);
        return w != null ? w + "?" : "Hermux got a phone data request it can't read. Deny it.";
    }
}
