package com.omarqaterge.hermesmobile;

/**
 * Pure notification privacy rules (plain JVM, no Android classes).
 *
 * A chat that has read phone data ({@link PhoneDataChats}) must never expose its reply or error text
 * in any notification body, the Done chip, the island Done state, or background read-aloud: generic
 * plain words take its place and read-aloud is skipped. Every reply, error, Done and cron notification
 * also gets {@code VISIBILITY_PRIVATE} with a generic public title on the lock screen.
 */
final class NotifyPrivacy {
    static final String REPLY_READY = "Reply ready";
    static final String TURN_FAILED = "Turn failed";
    static final String JOB_FINISHED = "Job finished";

    private NotifyPrivacy() {}

    /** Reply snippet for the Done chip and island Done state: generic words when the chat has read phone data. */
    static String safeReply(String reply, boolean phoneData) {
        if (phoneData) return REPLY_READY;
        return reply == null ? "" : reply;
    }

    /** Body for a reply, error or cron card: generic words when the chat has read phone data. */
    static String safeBody(String kind, String body, boolean phoneData) {
        if (phoneData) {
            if ("error".equals(kind)) return TURN_FAILED;
            if ("cron".equals(kind)) return JOB_FINISHED;
            return REPLY_READY;
        }
        return body == null ? "" : body;
    }

    /** Whether background read-aloud may speak this reply (mobile chats with text that have not read phone data). */
    static boolean mayReadAloud(String platform, String speakText, boolean phoneData) {
        return "mobile".equals(platform) && speakText != null && !speakText.isEmpty() && !phoneData;
    }

    /** Generic lock-screen title for setPublicVersion (no chat title, no reply text). */
    static String publicTitle(String kind) {
        if ("reply".equals(kind)) return "New reply";
        if ("error".equals(kind)) return "Turn failed";
        if ("cron".equals(kind)) return "Scheduled job";
        return "Hermux";
    }
}
