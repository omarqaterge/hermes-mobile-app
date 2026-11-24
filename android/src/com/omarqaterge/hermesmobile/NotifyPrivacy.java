package com.omarqaterge.hermesmobile;

/**
 * Pure notification privacy rules (plain JVM, no Android classes).
 *
 * A chat that has read phone data ({@link PhoneDataChats}) must never expose its reply, error,
 * working step, question, learning or scheduled-job text in any notification body, the Done chip,
 * the island Done/Progress/Ask state, or background read-aloud: generic plain words take its place
 * and read-aloud is skipped. Every reply, error, Done, working, ask, learning and cron notification
 * also gets {@code VISIBILITY_PRIVATE} with a generic public title on the lock screen.
 */
final class NotifyPrivacy {
    static final String REPLY_READY = "Reply ready";
    static final String TURN_FAILED = "Turn failed";
    static final String JOB_FINISHED = "Job finished";
    static final String JOB_FAILED = "Job failed";
    static final String WORKING = "Working";
    static final String ASK_OPEN_APP = "Hermes has a question, open Hermux to answer";
    static final String LEARNED = "Learned something new";
    static final String APPROVAL_LOCKED = "Hermux needs your approval";

    private NotifyPrivacy() {}

    /** Whether an approval notification's own content must be redacted (tainted chat or phone-data read while locked,
     *  so nothing leaks even when Android's "Show all notification content" lock-screen setting is on). */
    static boolean redactApproval(boolean phoneData, boolean keyguardLocked) {
        return phoneData && keyguardLocked;
    }

    /**
     * Whether this session counts as having read phone data. Fails closed: null, empty, or invalid
     * session ids count as tainted whenever any chat has read, or the record overflowed or lost an id.
     */
    static boolean hasReadPhoneData(PhoneDataChats chats, String session) {
        if (chats == null) return true;
        if (!PhoneDataChats.validId(session)) return chats.any();
        return chats.contains(session);
    }

    /** Reply snippet for the Done chip and island Done state: generic words when the chat has read phone data. */
    static String safeReply(String reply, boolean phoneData) {
        if (phoneData) return REPLY_READY;
        return reply == null ? "" : reply;
    }

    /** Body for a reply, error, cron, working, ask or learning notification: generic words for phone-data chats. */
    static String safeBody(String kind, String body, boolean phoneData) {
        return safeBody(kind, body, phoneData, false);
    }

    static String safeBody(String kind, String body, boolean phoneData, boolean failed) {
        if (phoneData) {
            if ("error".equals(kind)) return TURN_FAILED;
            if ("cron".equals(kind)) return failed ? JOB_FAILED : JOB_FINISHED;
            if ("working".equals(kind)) return WORKING;
            if ("ask".equals(kind)) return ASK_OPEN_APP;
            if ("learning".equals(kind)) return LEARNED;
            return REPLY_READY;
        }
        return body == null ? "" : body;
    }

    /** Whether background read-aloud may speak this reply (mobile chats with text that have not read phone data). */
    static boolean mayReadAloud(String platform, String speakText, boolean phoneData) {
        return "mobile".equals(platform) && speakText != null && !speakText.isEmpty() && !phoneData;
    }

    /** Generic lock-screen title for setPublicVersion (no chat title, no reply/step/question text). */
    static String publicTitle(String kind) {
        if ("reply".equals(kind)) return "New reply";
        if ("error".equals(kind)) return "Turn failed";
        if ("cron".equals(kind)) return "Scheduled job";
        if ("ask".equals(kind)) return "Hermux has a question";
        return "Hermux";
    }
}
