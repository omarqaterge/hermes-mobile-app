package com.omarqaterge.hermesmobile;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pure badge-count plan for active reply notifications (plain JVM, no Android classes).
 *
 * Android launchers (AOSP Launcher3 and HyperOS) sum the badge count of active child notifications,
 * so setting the total unseen count on every reply card multiplies it (2 cards × 2 = 4). Instead,
 * each active {@code reply:<chat>} card carries 1, or the newest remaining card carries any unseen
 * chats whose cards were dismissed, so the sum across active reply cards always equals the unseen
 * chat count. Non-reply cards and the group summary carry 0.
 */
final class BadgePlan {
    static final String REPLY_PREFIX = "reply:";
    static final String ANSWER_URI_PREFIX = "hermux://answer?";

    private BadgePlan() {}

    static boolean isReplyTag(String tag) {
        return tag != null && tag.startsWith(REPLY_PREFIX);
    }

    static String sessionOfReplyTag(String tag) {
        return isReplyTag(tag) ? tag.substring(REPLY_PREFIX.length()) : "";
    }

    /** Count set on a freshly posted reply/error card: 1 for a finished reply, 0 for a failed-turn error card. */
    static int initialReplyCount(String kind) {
        return "reply".equals(kind) ? 1 : 0;
    }

    /** Derives the card tag for an inline RemoteInput answer; errorCard is honoured only when kind is "reply". */
    static String answerTag(String kind, String session, boolean errorCard) {
        String prefix = "ask".equals(kind) ? "ask:" : ("reply".equals(kind) && errorCard ? "error:" : "reply:");
        return prefix + (session == null ? "" : session);
    }

    /** Immutable target carried in a RemoteInput PendingIntent's data URI (which Intent.fillIn(other, 0) cannot overwrite). */
    static final class AnswerTarget {
        final String kind;
        final String session;
        final boolean errorCard;

        AnswerTarget(String kind, String session, boolean errorCard) {
            this.kind = kind;
            this.session = session;
            this.errorCard = errorCard;
        }
    }

    private static String encodeUtf8(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Builds the data URI placed on a RemoteInput PendingIntent's base Intent so fillIn() cannot alter kind, session or error_card. */
    static String answerUri(String kind, String session, boolean errorCard) {
        String k = "ask".equals(kind) ? "ask" : "reply";
        boolean err = "reply".equals(k) && errorCard;
        return ANSWER_URI_PREFIX + "kind=" + k + "&session=" + encodeUtf8(session) + "&error_card=" + (err ? "1" : "0");
    }

    /** Parses a RemoteInput data URI built by {@link #answerUri}, or returns null when absent or malformed. */
    static AnswerTarget parseAnswerUri(String raw) {
        if (raw == null || !raw.startsWith(ANSWER_URI_PREFIX)) return null;
        String query = raw.substring(ANSWER_URI_PREFIX.length());
        String kind = null, session = "", errorCard = "0";
        for (String pair : query.split("&", -1)) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            if (eq <= 0) return null;
            String k = pair.substring(0, eq);
            String v;
            try {
                v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
            } catch (IllegalArgumentException | UnsupportedEncodingException e) {
                return null;
            }
            if ("kind".equals(k)) kind = v;
            else if ("session".equals(k)) session = v;
            else if ("error_card".equals(k)) errorCard = v;
            else return null;
        }
        if (!"ask".equals(kind) && !"reply".equals(kind)) return null;
        if (!"0".equals(errorCard) && !"1".equals(errorCard)) return null;
        return new AnswerTarget(kind, session, "reply".equals(kind) && "1".equals(errorCard));
    }

    static final class Plan {
        /** Active reply tags to cancel (nothing unseen, or the chat was already seen). */
        final List<String> cancelTags;
        /** Desired badge count for each remaining active reply tag, summing to unseenCount when non-empty. */
        final Map<String, Integer> counts;

        Plan(List<String> cancelTags, Map<String, Integer> counts) {
            this.cancelTags = Collections.unmodifiableList(cancelTags);
            this.counts = Collections.unmodifiableMap(counts);
        }
    }

    /**
     * Plans which active {@code reply:<chat>} notifications to cancel and what per-card count each
     * remaining one should carry. {@code activeReplyTags} must be ordered oldest to newest.
     */
    static Plan plan(int unseenCount, Set<String> unseenIds, List<String> activeReplyTags) {
        List<String> cancel = new ArrayList<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        if (activeReplyTags == null || activeReplyTags.isEmpty()) return new Plan(cancel, counts);
        if (unseenCount <= 0 || unseenIds == null || unseenIds.isEmpty()) {
            for (String tag : activeReplyTags) {
                if (isReplyTag(tag)) cancel.add(tag);
            }
            return new Plan(cancel, counts);
        }
        List<String> kept = new ArrayList<>();
        Set<String> seenTags = new LinkedHashSet<>();
        for (String tag : activeReplyTags) {
            if (!isReplyTag(tag)) continue;
            String session = sessionOfReplyTag(tag);
            if (!session.isEmpty() && unseenIds.contains(session) && seenTags.add(tag)) {
                kept.add(tag);
            } else {
                cancel.add(tag);
            }
        }
        while (kept.size() > unseenCount) {
            cancel.add(kept.remove(0));
        }
        int k = kept.size();
        if (k > 0) {
            int lastCount = unseenCount - (k - 1);
            for (int i = 0; i < k; i++) {
                counts.put(kept.get(i), i == k - 1 ? lastCount : 1);
            }
        }
        return new Plan(cancel, counts);
    }
}
