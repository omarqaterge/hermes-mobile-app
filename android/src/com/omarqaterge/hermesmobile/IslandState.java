package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * What the island panel shows: one unchangeable snapshot of the service's live state, built by
 * HermesService.islandState() on every change, and the rules that read it. Plain Java with no Android imports, so a
 * plain JDK can test it (tools/test_island_state.sh). It never sends or allows anything: the panel answers through
 * HermesService's own paths, and this class only says what is on screen.
 */
final class IslandState {
    /** Which state the panel shows, in the chip's order: Permission, then Question, then Progress, then Done. */
    static final String NONE = "none", PERMISSION = "approval", QUESTION = "ask", PROGRESS = "working", DONE = "done";

    // ── on-screen words of the Question state (design 5.2) ──
    static final String HERMUX = "Hermux";
    static final String ASKS = "Hermux asks";
    static final String NO_QUESTION = "Hermux has a question";
    static final String ASK_CLOSED = "This question is closed";
    static final String TYPE_HINT = "Type your answer";
    static final String OPEN_CHAT = "Open chat";
    static final String SEND = "Send";
    static final String ASK_FAILED = "Couldn't send your answer. Open the chat; your text is kept.";
    /** Spoken when an answer is confirmed (the panel shows a check, not words). */
    static final String SENT_SPOKEN = "Sent";
    /** At most this many choices are shown (the plugin sends five at most). */
    static final int MAX_CHOICES = 5;

    /** The state shown, by the chip's order. Done only counts when nothing is working (as on the chip). */
    static String pick(boolean approval, boolean ask, boolean working, boolean done) {
        if (approval) return PERMISSION;
        if (ask) return QUESTION;
        if (working) return PROGRESS;
        if (done) return DONE;
        return NONE;
    }

    /** The line above the headline: the chat's title ("Hermux" when it has none), with "· bot" when the bot isn't
     *  the default one. */
    static String chatLine(String title, String profile) {
        String t = title == null ? "" : title.trim();
        if (t.isEmpty()) t = HERMUX;
        String p = profile == null ? "" : profile.trim();
        return p.isEmpty() || "default".equals(p) ? t : t + " · " + p;
    }

    /** The question waiting, as the panel shows it. */
    static final class Ask {
        final String session, chat, question;
        final List<String> choices;
        /** False for a batch of questions: those open the app, the panel shows single questions only. */
        final boolean single;

        Ask(String session, String chat, String question, List<String> rawChoices, boolean single) {
            this.session = session == null ? "" : session;
            this.chat = chat == null || chat.isEmpty() ? HERMUX : chat;
            String q = question == null ? "" : question.trim();
            this.question = q.isEmpty() ? NO_QUESTION : q;
            List<String> c = new ArrayList<>();
            if (rawChoices != null) for (String s : rawChoices) {
                String v = s == null ? "" : s.trim();
                if (!v.isEmpty() && c.size() < MAX_CHOICES) c.add(v); // whole: a tap answers with this text
            }
            this.choices = Collections.unmodifiableList(c);
            this.single = single;
        }

        /** The same question: same chat, same words, same choices. A chat's new question replaces its old one. */
        boolean same(Ask o) {
            return o != null && session.equals(o.session) && question.equals(o.question) && choices.equals(o.choices)
                    && single == o.single;
        }
    }

    /** The last answer the service sent, or tried to: which request, what came of it, a short reason, when. */
    static final class Outcome {
        static final String ALLOWED = "allowed", DENIED = "denied", SENT = "sent", FAILED = "failed", STOPPED = "stopped";
        final String kind, session, request, result, reason;
        final long at;

        Outcome(String kind, String session, String request, String result, String reason, long at) {
            this.kind = kind == null ? "" : kind;
            this.session = session == null ? "" : session;
            this.request = request == null ? "" : request;
            this.result = result == null ? "" : result;
            this.reason = reason == null ? "" : reason;
            this.at = at;
        }

        /** Whether this is the outcome of an answer of this kind for this chat, sent at {@code since} or later. */
        boolean answers(String kind, String session, long since) {
            return this.kind.equals(kind) && this.session.equals(session == null ? "" : session) && at >= since;
        }
    }

    /** A question that ran out of time (ASK_TTL_MS) with no answer: which chat, its words as shown, when. */
    static final class Expired {
        final String session, question;
        final long at;

        Expired(String session, String question, long at) {
            this.session = session == null ? "" : session;
            this.question = new Ask(session, null, question, null, true).question; // the words as the panel shows them
            this.at = at;
        }

        /** Whether this is the question {@code a}: same chat, same words. */
        boolean is(Ask a) {
            return a != null && session.equals(a.session) && question.equals(a.question);
        }
    }

    final String kind;
    /** The question waiting (the oldest, as on the chip), or null. */
    final Ask ask;
    /** The last outcome, or null. */
    final Outcome outcome;
    /** The last question that expired, or null. */
    final Expired expired;

    IslandState(String kind, Ask ask, Outcome outcome) {
        this(kind, ask, outcome, null);
    }

    IslandState(String kind, Ask ask, Outcome outcome, Expired expired) {
        this.kind = kind == null ? NONE : kind;
        this.ask = ask;
        this.outcome = outcome;
        this.expired = expired;
    }

    /** Where a question on the panel stands. EXPIRED is CLOSED because it ran out of time, which the panel marks with
     *  the reject buzz (design 4, Haptics); answered elsewhere it closes quietly. */
    static final String OPEN = "open", SENDING = "sending", CLOSED = "closed", EXPIRED = "expired";

    /**
     * The fate of the question {@code shown}, given whether the panel sent an answer (at {@code sentAt}) and the
     * live state {@code now}: SENDING until the service records the outcome of that answer (Outcome.SENT or
     * Outcome.FAILED are returned as they are), then OPEN while the same question still waits, EXPIRED when the
     * service says this very question ran out of time, otherwise CLOSED (answered elsewhere, or replaced by a newer
     * question from the chat). A question that vanished with no outcome of ours was answered elsewhere.
     */
    static String askFate(Ask shown, boolean sent, long sentAt, IslandState now) {
        if (shown == null) return CLOSED;
        if (sent) {
            Outcome o = now == null ? null : now.outcome;
            if (o != null && o.answers(QUESTION, shown.session, sentAt))
                return Outcome.SENT.equals(o.result) ? Outcome.SENT : Outcome.FAILED;
            return SENDING;
        }
        Ask live = now == null ? null : now.ask;
        if (live != null && live.single && live.same(shown)) return OPEN;
        return now != null && now.expired != null && now.expired.is(shown) ? EXPIRED : CLOSED;
    }

    /** The question the panel opens on: the live one, when it is a single question. */
    Ask askToShow() {
        return ask != null && ask.single ? ask : null;
    }
}
