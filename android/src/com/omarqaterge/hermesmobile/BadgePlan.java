package com.omarqaterge.hermesmobile;

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
