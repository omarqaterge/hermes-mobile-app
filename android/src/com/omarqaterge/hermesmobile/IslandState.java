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

    // ── on-screen words of the Permission state (design 5.1) ──
    static final String RUN_COMMAND = "Run a command?";
    static final String READ_PHONE = "Let Hermux read your phone?";
    static final String UNREADABLE = "Unreadable phone data request";
    static final String DENY = "Deny";
    static final String ALLOW_ONCE = "Allow once";
    static final String ALLOW_SESSION = "Allow this session";
    static final String REVIEW = "Review in Hermux";
    static final String SENDING_LABEL = "Sending\u2026";
    static final String ALLOWED = "Allowed";
    static final String ALLOWED_SESSION = "Allowed for this session";
    static final String DENIED = "Denied";
    static final String APPROVAL_FAILED = "Couldn't send your answer. Try again, or open the chat.";
    static final String REQUEST_EXPIRED = "This request expired";
    static final String ANSWERED_ELSEWHERE = "Answered in the app";
    /** The body when Hermux said nothing about the request (as the notification says). */
    static final String A_COMMAND = "A command";
    /** At most this many waiting requests are carried in a snapshot (the panel shows one and counts the rest). */
    static final int MAX_APPROVALS = 16;
    /** The timer is spoken ("N seconds left") when this many seconds are left. */
    static final int[] SPOKEN_SECONDS = {30, 10, 5};
    /** A request that vanishes this close to its deadline ran out of time (Hermes's own clock and ours differ a
     *  little); earlier it was answered somewhere else. */
    static final long EXPIRY_SLACK_MS = 1500;

    /** "1 more waiting" / "N more waiting", or "" for none. */
    static String moreWaiting(int n) {
        return n <= 0 ? "" : n + " more waiting";
    }

    /** What TalkBack says for the timer. */
    static String secondsLeft(int n) {
        return n == 1 ? "1 second left" : n + " seconds left";
    }

    /** The whole seconds the timer shows for {@code leftMs} (it reads 1 until the very end, then 0). */
    static int seconds(long leftMs) {
        return leftMs <= 0 ? 0 : (int) ((leftMs + 999) / 1000);
    }

    /** Whether the timer, going from {@code before} to {@code now} whole seconds, says the time left out loud. */
    static boolean speaks(int before, int now) {
        if (now >= before) return false;
        for (int s : SPOKEN_SECONDS) if (now <= s && before > s) return true;
        return false;
    }

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

    /** One permission request waiting, as the panel shows it (never its key: the service answers with its own copy of
     *  the request, looked up again by chat and request id). */
    static final class Approval {
        final String session, request, chat, what, command;
        /** "Allow this session" is offered; a phone-data read (never allowed from the panel), and one whose text could
         *  not be read (no Allow anywhere). */
        final boolean allowSession, phoneData, unreadable;
        /** When it stops waiting (epoch ms) and how long it waits in all (ms). */
        final long deadline, total;

        Approval(String session, String request, String chat, String what, String command, String body, boolean allowSession,
                 boolean phoneData, boolean unreadable, long deadline, long total) {
            this.session = session == null ? "" : session;
            this.request = request == null ? "" : request;
            this.chat = chat == null || chat.isEmpty() ? HERMUX : chat;
            String w = what == null ? "" : what.trim(), c = command == null ? "" : command.trim();
            this.phoneData = phoneData || unreadable;
            this.unreadable = unreadable;
            if (this.phoneData) c = ""; // a phone-data read shows the app's own wording, never a command
            if (w.isEmpty() && c.isEmpty()) w = body == null || body.trim().isEmpty() ? A_COMMAND : body.trim();
            this.what = capital(w);
            this.command = c;
            this.allowSession = allowSession && !this.phoneData;
            this.deadline = deadline;
            this.total = Math.max(1000, total);
        }

        /** The headline: a command, a phone-data read, or one that could not be read. */
        String headline() {
            return unreadable ? UNREADABLE : phoneData ? READ_PHONE : RUN_COMMAND;
        }

        /** The panel may send Allow for it (never a phone-data read). */
        boolean allowable() {
            return !phoneData;
        }

        /** The same request: same chat, same request id. */
        boolean same(Approval o) {
            return o != null && session.equals(o.session) && request.equals(o.request);
        }

        /** The share of its time left at {@code now} (1 = full, 0 = run out). */
        double left(long now) {
            return Math.max(0, Math.min(1, (deadline - now) / (double) total));
        }
    }

    /** The first letter capitalised (the plain-words line). */
    static String capital(String s) {
        if (s == null || s.isEmpty()) return "";
        int n = Character.charCount(s.codePointAt(0));
        return s.substring(0, n).toUpperCase(java.util.Locale.ROOT) + s.substring(n);
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

        /** The same, for this very request. */
        boolean answers(String kind, String session, String request, long since) {
            return answers(kind, session, since) && this.request.equals(request == null ? "" : request);
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
    /** Every permission request waiting, the oldest first (the chip shows the first), at most MAX_APPROVALS. Carried
     *  whatever "When Hermux needs me" says: a panel the user opened follows the live request. */
    final List<Approval> approvals;

    IslandState(String kind, Ask ask, Outcome outcome) {
        this(kind, ask, outcome, null);
    }

    IslandState(String kind, Ask ask, Outcome outcome, Expired expired) {
        this(kind, ask, outcome, expired, null);
    }

    IslandState(String kind, Ask ask, Outcome outcome, Expired expired, List<Approval> approvals) {
        this.kind = kind == null ? NONE : kind;
        this.ask = ask;
        this.outcome = outcome;
        this.expired = expired;
        List<Approval> a = new ArrayList<>();
        if (approvals != null) for (Approval x : approvals) if (x != null && a.size() < MAX_APPROVALS) a.add(x);
        this.approvals = Collections.unmodifiableList(a);
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

    /** Where a permission request on the panel stands (besides OPEN, SENDING and the outcomes ALLOWED, DENIED and
     *  FAILED): GONE when it was answered somewhere else. EXPIRED is shared with the Question state. */
    static final String GONE = "gone";

    /** The live request that is {@code shown}, or null when it no longer waits. */
    Approval live(Approval shown) {
        if (shown == null) return null;
        for (Approval a : approvals) if (a.same(shown)) return a;
        return null;
    }

    /** The request the panel shows: the one tapped (chat and request id) while it still waits, else the oldest. */
    Approval approvalToShow(String session, String request) {
        String s = session == null ? "" : session, r = request == null ? "" : request;
        if (!s.isEmpty()) for (Approval a : approvals) if (a.session.equals(s) && (r.isEmpty() || a.request.equals(r))) return a;
        return approvals.isEmpty() ? null : approvals.get(0);
    }

    /** How many other requests wait besides {@code shown}. */
    int othersWaiting(Approval shown) {
        int n = 0;
        for (Approval a : approvals) if (!a.same(shown)) n++;
        return n;
    }

    /** The next request to move on to after {@code done} was answered, or null. */
    Approval next(Approval done) {
        for (Approval a : approvals) if (!a.same(done)) return a;
        return null;
    }

    /**
     * The fate of the request {@code shown} at {@code now} (epoch ms), given whether the panel sent an answer (at
     * {@code sentAt}) and the live state {@code st}: SENDING until the service records the outcome for this very
     * request (Outcome.ALLOWED, DENIED or FAILED are returned as they are); otherwise OPEN while it still waits and
     * time is left, EXPIRED once its time is up (or it vanished within EXPIRY_SLACK_MS of its deadline), and GONE when
     * it vanished earlier with no answer of ours: it was answered somewhere else.
     */
    static String approvalFate(Approval shown, boolean sent, long sentAt, IslandState st, long now) {
        if (shown == null) return GONE;
        if (sent) {
            Outcome o = st == null ? null : st.outcome;
            if (o != null && o.answers(PERMISSION, shown.session, shown.request, sentAt)) {
                if (Outcome.ALLOWED.equals(o.result) || Outcome.DENIED.equals(o.result)) return o.result;
                return Outcome.FAILED;
            }
            return SENDING;
        }
        boolean waiting = st != null && st.live(shown) != null;
        if (waiting) return now >= shown.deadline ? EXPIRED : OPEN;
        return now >= shown.deadline - EXPIRY_SLACK_MS ? EXPIRED : GONE;
    }

    /** The question the panel opens on: the live one, when it is a single question. */
    Ask askToShow() {
        return ask != null && ask.single ? ask : null;
    }
}
