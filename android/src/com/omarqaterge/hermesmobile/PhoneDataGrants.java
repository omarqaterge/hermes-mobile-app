package com.omarqaterge.hermesmobile;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * What lets one phone-data read through: a one-use grant from a real tap on Allow in the app, or the app's own record
 * that the user put this chat in Full access. Nothing the agent writes can create either
 * (docs/decisions/phone-data-read-only.md): grants are made only by {@code phoneDataGrant} (the page, per-page key) and
 * the pass only by {@code phoneDataFullAccess}. Memory only, so a restart forgets both. Plain Java (no Android classes)
 * so tools/test_phone_data_grants.sh tests it with a JDK.
 */
final class PhoneDataGrants {
    private PhoneDataGrants() {}

    /** A grant lives this long (the approval itself times out sooner). */
    static final long TTL_MS = 2 * 60_000L;
    /** Live grants kept; the oldest is dropped for a new one. */
    static final int MAX_GRANTS = 16;
    /** Chats in Full access kept at once (far more than anyone opens); the oldest is dropped. */
    static final int MAX_SESSIONS = 64;
    /** The canonical args text is at most this long (the contract's args are tiny). */
    static final int MAX_ARGS = 1024;
    static final String PREFIX = "phone_data:v1:";

    /** Tests set the clock; the app uses the system one. */
    static LongSupplier clock = System::currentTimeMillis;

    /** A parsed approval text. {@code args} is the decoded, canonical args text (printable ASCII, one JSON object). */
    static final class Parsed {
        final String kind;
        final String nonce;
        final String args;

        Parsed(String kind, String nonce, String args) {
            this.kind = kind;
            this.nonce = nonce;
            this.args = args;
        }
    }

    private static final class Grant {
        final String kind;
        final String args;
        final long expires;

        Grant(String kind, String args, long expires) {
            this.kind = kind;
            this.args = args;
            this.expires = expires;
        }
    }

    private static final Map<String, Grant> GRANTS = new LinkedHashMap<>();
    private static final Set<String> FULL = new LinkedHashSet<>();

    /** True when the text is a phone-data approval (well formed or not): such text gets the app's own wording and no
     *  "session" or "always" answer. */
    static boolean isPhoneData(String text) {
        return text != null && text.startsWith("phone_data:");
    }

    /** Strictly parses {@code phone_data:v1:<kind>:<12 lowercase hex>:<even-length lowercase hex of the args text>}.
     *  Null for anything else: a wrong prefix or version, an unknown kind, a nonce or hex of the wrong shape, too long,
     *  bytes that are not valid UTF-8 or not printable ASCII (the contract's args text is ASCII), or text that isn't one
     *  JSON object. */
    static Parsed parse(String description) {
        if (description == null || description.length() > PREFIX.length() + 40 + 2 * MAX_ARGS) return null;
        String[] p = description.split(":", -1);
        if (p.length != 5 || !"phone_data".equals(p[0]) || !"v1".equals(p[1])) return null;
        if (!PhoneData.isKind(p[2]) || !isHex(p[3], 12, 12) || !isHex(p[4], 2, 2 * MAX_ARGS) || p[4].length() % 2 != 0) return null;
        byte[] raw = new byte[p[4].length() / 2];
        for (int i = 0; i < raw.length; i++) raw[i] = (byte) ((Character.digit(p[4].charAt(2 * i), 16) << 4) | Character.digit(p[4].charAt(2 * i + 1), 16));
        String args;
        try {
            args = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
        for (int i = 0; i < args.length(); i++) {
            char c = args.charAt(i);
            if (c < 0x20 || c > 0x7e) return null;
        }
        if (!args.startsWith("{") || !args.endsWith("}")) return null;
        return new Parsed(p[2], p[3], args);
    }

    private static boolean isHex(String s, int min, int max) {
        if (s.length() < min || s.length() > max) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    /** The user tapped Allow on this approval (its description, in the contract's format). False if it isn't one.
     *  The same nonce again with the same read is a no-op (a double tap); with a different one it is refused. */
    static boolean issue(String description) {
        Parsed p = parse(description);
        if (p == null) return false;
        synchronized (GRANTS) {
            long now = clock.getAsLong();
            purge(now);
            Grant old = GRANTS.get(p.nonce);
            if (old != null) return old.kind.equals(p.kind) && old.args.equals(p.args);
            while (GRANTS.size() >= MAX_GRANTS) {
                Iterator<String> it = GRANTS.keySet().iterator();
                it.next();
                it.remove();
            }
            GRANTS.put(p.nonce, new Grant(p.kind, p.args, now + TTL_MS));
            return true;
        }
    }

    /** Uses up the grant for exactly this nonce, kind and args text; true when one was live, at most once. A wrong
     *  guess returns false the same way whichever part was wrong, and does NOT use the grant up: otherwise anything
     *  that knows a nonce could burn the user's tap, and the grant only ever lets this one exact read through. */
    static boolean consume(String nonce, String kind, String args) {
        if (nonce == null || kind == null || args == null) return false;
        synchronized (GRANTS) {
            purge(clock.getAsLong());
            Grant g = GRANTS.get(nonce);
            if (g == null) return false;
            boolean same = same(g.kind, kind) & same(g.args, args);
            if (!same) return false;
            GRANTS.remove(nonce);
            return true;
        }
    }

    private static boolean same(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static void purge(long now) {
        for (Iterator<Grant> it = GRANTS.values().iterator(); it.hasNext(); ) if (it.next().expires <= now) it.remove();
    }

    /** The user moved this chat into or out of Full access in the app. Memory only: a restart forgets it. An empty
     *  session turns nothing on; turning it off with an empty session clears every chat (the page does this when it
     *  loads, because after a reload it no longer knows which chats were in Full access). */
    static void fullAccess(String session, boolean on) {
        synchronized (FULL) {
            if (session == null || session.isEmpty()) {
                if (!on) FULL.clear();
                return;
            }
            if (session.length() > 128) return;
            FULL.remove(session);
            if (!on) return;
            while (FULL.size() >= MAX_SESSIONS) {
                Iterator<String> it = FULL.iterator();
                it.next();
                it.remove();
            }
            FULL.add(session);
        }
    }

    static boolean hasFullAccess(String session) {
        if (session == null || session.isEmpty()) return false;
        synchronized (FULL) {
            return FULL.contains(session);
        }
    }

    /** Why a kind can't be read, once {@code PhoneData.allowed} said no: {@code no_permission} when the master and the kind's
     *  switches were on but Android no longer lets the app read, otherwise {@code off}. */
    static String gateReason(boolean switchesWereOn, boolean permitted) {
        return switchesWereOn && !permitted ? "no_permission" : "off";
    }

    /** For tests only: forget everything. */
    static void reset() {
        synchronized (GRANTS) {
            GRANTS.clear();
        }
        synchronized (FULL) {
            FULL.clear();
        }
    }

    /** Live grants (tests). */
    static int liveGrants() {
        synchronized (GRANTS) {
            purge(clock.getAsLong());
            return GRANTS.size();
        }
    }
}
