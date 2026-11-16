package com.omarqaterge.hermesmobile;

/**
 * The phases of one app install through Android's installer (the in-app update; a helper app has the same shape), and
 * what each event does to them. Pure Java, no Android imports, so a plain JDK tests it. The point: "an install is
 * still in flight" lasts until Android ANSWERS (success, failure, cancel) or the session is gone, not until the commit
 * call returns, so a second tap while the system prompt waits cannot stack a second session.
 */
final class InstallPhase {
    private InstallPhase() {}

    enum Phase {
        /** Nothing in flight: a new install may start. */
        IDLE,
        /** Requested; the download and the checks run. */
        DOWNLOADING,
        /** The session is committed; Android has not said anything yet. */
        COMMITTED,
        /** Android wants the user to confirm; the prompt waits for the app to be on screen. */
        PROMPT_WAITING,
        /** The prompt was put on screen; no final answer yet. */
        PROMPT_SHOWN
    }

    enum Event {
        /** The page asked for the install and nothing is in flight. */
        REQUEST,
        /** The session commit returned. */
        COMMIT_RETURNED,
        /** Android sent STATUS_PENDING_USER_ACTION with its prompt. */
        PROMPT_ARRIVED,
        /** The prompt activity was started. */
        PROMPT_OPENED,
        /** Android's final answer: success, failure or cancel. */
        ANSWERED,
        /** The download or a check failed, or the prompt could not open. */
        FAILED,
        /** The session is gone from Android's list with no answer, or the package is already installed. */
        SESSION_GONE
    }

    /** What a page's Retry / second tap does now. */
    enum Retry { START, SHOW_PROMPT, WAIT }

    static Phase next(Phase p, Event e) {
        switch (e) {
            case REQUEST: return p == Phase.IDLE ? Phase.DOWNLOADING : p;
            case COMMIT_RETURNED: return p == Phase.DOWNLOADING ? Phase.COMMITTED : p;
            case PROMPT_ARRIVED:
                // commit() can deliver the prompt before it returns; a repeat re-arms the prompt
                return p == Phase.IDLE ? p : Phase.PROMPT_WAITING;
            case PROMPT_OPENED: return p == Phase.PROMPT_WAITING ? Phase.PROMPT_SHOWN : p;
            case ANSWERED:
            case FAILED:
            case SESSION_GONE: return Phase.IDLE;
            default: return p;
        }
    }

    /** Android sends its prompt within a second or so of the commit. Committed this long with no prompt and no answer: lost. */
    static final long LOST_PROMPT_MS = 15000;

    /**
     * The prompt was lost (the receiver was gone when it arrived): COMMITTED, with no prompt and no answer, for longer
     * than LOST_PROMPT_MS. A prompt that is waiting or shown is never lost: the user may simply not have answered yet.
     */
    static boolean promptLost(Phase p, long msSinceCommit) { return p == Phase.COMMITTED && msSinceCommit > LOST_PROMPT_MS; }

    /** retry(p), except that a lost prompt means start fresh (the caller abandons the old session first). */
    static Retry retry(Phase p, long msSinceCommit) { return promptLost(p, msSinceCommit) ? Retry.START : retry(p); }

    /** May a new install start now? Only when nothing is in flight. */
    static boolean canStart(Phase p) { return p == Phase.IDLE; }

    static Retry retry(Phase p) {
        if (p == Phase.IDLE) return Retry.START;
        if (p == Phase.PROMPT_WAITING || p == Phase.PROMPT_SHOWN) return Retry.SHOW_PROMPT;
        return Retry.WAIT;
    }

    /** Is Android holding a session for this install? Then a session that has vanished means the install is over. */
    static boolean hasSession(Phase p) {
        return p == Phase.COMMITTED || p == Phase.PROMPT_WAITING || p == Phase.PROMPT_SHOWN;
    }
}
