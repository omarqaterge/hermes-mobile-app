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

    // ── on-screen words of the Progress and Done states (design 5.3, 5.4) ──
    static final String STOP = "Stop";
    static final String STOPPING = "Stopping…";
    static final String STOPPED = "Stopped";
    static final String STOP_FAILED = "Couldn't stop Hermux. Open the chat to stop it.";
    static final String WATCH = "Watch";
    static final String DONE_TITLE = "Done";
    /** The headline while the plugin has said nothing about the step (as the chip says). */
    static final String WORKING_LINE = "Working…";
    /** An other busy chat with no title (as the notification says). */
    static final String ANOTHER_CHAT = "Another chat";
    /** At most this many other busy chats get a line; the rest are counted ("+N more chats"). */
    static final int OTHERS_SHOWN = 2;

    /** "2 of 5 tasks". */
    static String tasks(int done, int total) {
        return Math.max(0, done) + " of " + Math.max(0, total) + " tasks";
    }

    /** "7 steps so far" ("1 step so far"); "" before the first step. */
    static String stepsSoFar(int n) {
        return n <= 0 ? "" : n == 1 ? "1 step so far" : n + " steps so far";
    }

    /** "+N more chats" ("+1 more chat"), or "" for none. */
    static String moreChats(int n) {
        return n <= 0 ? "" : n == 1 ? "+1 more chat" : "+" + n + " more chats";
    }

    /** "Using <app>". */
    static String using(String app) {
        String a = app == null ? "" : app.trim();
        return "Using " + (a.isEmpty() ? "an app" : a);
    }

    /** The turn's running time: "0:07", "1:24", "12:05", then "1:02:03". */
    static String clock(long secs) {
        long s = Math.max(0, secs), h = s / 3600, m = s % 3600 / 60, r = s % 60;
        String ss = (r < 10 ? "0" : "") + r;
        if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
        return m + ":" + ss;
    }

    /** How long a turn took, as the Done card says it: "45s", "2m 14s", "1h 3m". */
    static String took(long secs) {
        if (secs < 60) return secs + "s";
        if (secs < 3600) return (secs / 60) + "m " + (secs % 60) + "s";
        return (secs / 3600) + "h " + (secs % 3600 / 60) + "m";
    }

    /** The Done state's dim line: "9 steps · 1m 31s"; a part Hermes didn't send is left out; "" for neither. */
    static String doneStats(int steps, long secs) {
        String a = steps <= 0 ? "" : steps == 1 ? "1 step" : steps + " steps", b = secs <= 0 ? "" : took(secs);
        return a.isEmpty() ? b : b.isEmpty() ? a : a + " · " + b;
    }

    /** One other busy chat's line: "Title: step", with the step's backticks dropped (as on the notification). */
    static String otherLine(String title, String text) {
        String t = title == null || title.trim().isEmpty() ? ANOTHER_CHAT : title.trim();
        String s = text == null ? "" : text.replace("`", "").trim();
        return s.isEmpty() ? t : t + ": " + s;
    }

    /** A chat at work, as the Progress state shows it: what it does now, its task list (if it keeps one), its clock,
     *  and whether Hermux uses an app for it. The chat the chip shows has all of it; another busy chat only its step. */
    static final class Progress {
        final String session, chat, title, headline;
        /** When the turn started (epoch ms; 0 = not known) and how many steps it took so far. */
        final long since;
        final int steps;
        /** The task list: one letter per task (d done, a current, p to do, x dropped), "" for none; the current task's
         *  name; tasks done and in all (dropped ones not counted). */
        final String states, current;
        final int done, total;
        /** A stop is on its way for this chat (the panel's Stop, or the card's); when the service sent it (epoch ms, 0
         *  = not known); and whether the plugin accepted it (the turn is winding down). */
        final boolean stopping, stopOk;
        final long stopAt;
        /** The app Hermux uses for this chat ("" for none), and a number that changes with its picture (0 = none yet). */
        final String app;
        final int picture;

        Progress(String session, String chat, String title, String headline, long since, int steps, String states,
                 String current, int done, int total, boolean stopping, String app, int picture) {
            this(session, chat, title, headline, since, steps, states, current, done, total, stopping, 0, false, app, picture);
        }

        Progress(String session, String chat, String title, String headline, long since, int steps, String states,
                 String current, int done, int total, boolean stopping, long stopAt, boolean stopOk, String app, int picture) {
            this.session = session == null ? "" : session;
            this.chat = chat == null || chat.isEmpty() ? HERMUX : chat;
            this.title = title == null ? "" : title;
            String h = headline == null ? "" : headline.trim();
            this.headline = h.isEmpty() ? WORKING_LINE : h;
            this.since = Math.max(0, since);
            this.steps = Math.max(0, steps);
            String st = states == null ? "" : states.replaceAll("[^dapx]", "");
            this.states = total > 0 ? st : "";
            this.current = current == null ? "" : current.trim();
            this.done = Math.max(0, done);
            this.total = Math.max(0, total);
            this.stopping = stopping;
            this.stopAt = stopping ? Math.max(0, stopAt) : 0;
            this.stopOk = stopping && stopOk;
            this.app = app == null ? "" : app;
            this.picture = picture;
        }

        /** Hermes keeps a task list for this turn: the bar, not the sweep. */
        boolean hasTasks() {
            return !states.isEmpty();
        }
    }

    /** The last turn that finished with a reply, for the Done state: which chat, the start of the reply, its steps and
     *  time, when it arrived. Recorded whatever the Done chip's rules say (they decide only the chip). */
    static final class Done {
        final String session, chat, reply;
        final int steps;
        final long secs, at;

        Done(String session, String chat, String reply, int steps, long secs, long at) {
            this.session = session == null ? "" : session;
            this.chat = chat == null || chat.isEmpty() ? HERMUX : chat;
            this.reply = reply == null ? "" : reply.trim();
            this.steps = Math.max(0, steps);
            this.secs = Math.max(0, secs);
            this.at = at;
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

    /** Every chat at work, the one the chip shows first (at most four: the plugin names three others). */
    final List<Progress> working;
    /** How many chats are at work in all (the plugin counts those it does not name). */
    final int busy;
    /** The last turn of each chat that finished with a reply, the newest first (at most {@link #MAX_DONE}); {@link #done}
     *  is the newest, or null. One per chat, so two chats finishing one after the other each keep their own. */
    final List<Done> dones;
    final Done done;
    static final int MAX_DONE = 8;

    IslandState(String kind, Ask ask, Outcome outcome, Expired expired, List<Approval> approvals) {
        this(kind, ask, outcome, expired, approvals, null, 0, null);
    }

    IslandState(String kind, Ask ask, Outcome outcome, Expired expired, List<Approval> approvals, List<Progress> working,
                int busy, List<Done> dones) {
        this.kind = kind == null ? NONE : kind;
        this.ask = ask;
        this.outcome = outcome;
        this.expired = expired;
        List<Approval> a = new ArrayList<>();
        if (approvals != null) for (Approval x : approvals) if (x != null && a.size() < MAX_APPROVALS) a.add(x);
        this.approvals = Collections.unmodifiableList(a);
        List<Progress> w = new ArrayList<>();
        if (working != null) for (Progress p : working) if (p != null && w.size() < 4) w.add(p);
        this.working = Collections.unmodifiableList(w);
        this.busy = Math.max(w.size(), busy);
        List<Done> d = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        if (dones != null) for (Done x : dones) if (x != null && d.size() < MAX_DONE && seen.add(x.session)) d.add(x);
        this.dones = Collections.unmodifiableList(d);
        this.done = d.isEmpty() ? null : d.get(0);
    }

    /** The latest reply of chat {@code session} ("" = the newest of any chat), or null. */
    Done doneOf(String session) {
        String s = session == null ? "" : session;
        for (Done d : dones) if (s.isEmpty() || d.session.equals(s)) return d;
        return null;
    }

    // ── the Progress and Done states (design 5.3, 5.4) ──

    /** The chat {@code session} while it is at work ("" = the one the chip shows), or null when it isn't. */
    Progress progressFor(String session) {
        String s = session == null ? "" : session;
        if (s.isEmpty()) return working.isEmpty() ? null : working.get(0);
        for (Progress p : working) if (p.session.equals(s)) return p;
        return null;
    }

    /** Chat {@code session} is at work (exactly that chat; an empty id never is). */
    boolean atWork(String session) {
        if (session == null || session.isEmpty()) return false;
        for (Progress p : working) if (p.session.equals(session)) return true;
        return false;
    }

    /** The other busy chats' lines under the body of {@code shown}: two at most. */
    List<String> otherLines(Progress shown) {
        List<String> out = new ArrayList<>();
        for (Progress p : working) {
            if (shown != null && p.session.equals(shown.session)) continue;
            if (out.size() < OTHERS_SHOWN) out.add(otherLine(p.title, p.headline));
        }
        return out;
    }

    /** How many other busy chats have no line of their own ("+N more chats"). */
    int moreChats(Progress shown) {
        int others = busy - (shown != null && atWork(shown.session) ? 1 : 0);
        return Math.max(0, others - otherLines(shown).size());
    }

    /** The reply of chat {@code session}'s turn that started at {@code since} (epoch ms), or null when none came yet. */
    Done doneFor(String session, long since) {
        if (session == null || session.isEmpty()) return null;
        Done d = doneOf(session);
        return d != null && d.at >= since ? d : null;
    }

    /** Where a turn on the panel stands (besides DONE). */
    static final String WORKING = "working", ENDING = "ending", ENDED = "ended";
    /** The reply comes a moment after the turn ends (or just before): this long the panel waits for it. */
    static final long DONE_GRACE_MS = 2000;

    /**
     * The fate of the turn of chat {@code session} that started at {@code since}, at {@code now}: DONE once its reply
     * arrived (even before the status says the turn is over); WORKING while the chat is still at work; ENDING for
     * DONE_GRACE_MS after the panel first saw it stop ({@code endedAt}, 0 = not yet), in case the reply is on its
     * way; then ENDED: it stopped with nothing to show (stopped elsewhere, or it failed), and the panel closes.
     */
    static String turnFate(String session, long since, long endedAt, IslandState st, long now) {
        if (st == null) return ENDED;
        if (st.doneFor(session, since) != null) return DONE;
        if (st.atWork(session)) return WORKING;
        if (endedAt <= 0 || now - endedAt < DONE_GRACE_MS) return ENDING;
        return ENDED;
    }

    /**
     * The fate of the panel's Stop for {@code session}, sent at {@code sentAt}: Outcome.STOPPED once the turn is over
     * (even if an overlapping stop returned 404 / FAILED); FAILED when the chat still works and the service could not
     * stop it; otherwise SENDING ("Stopping...").
     */
    static String stopFate(String session, long sentAt, IslandState st) {
        if (st == null) return SENDING;
        if (!st.atWork(session)) return Outcome.STOPPED;
        Outcome o = st.outcome;
        if (o != null && o.answers("stop", session, sentAt) && Outcome.FAILED.equals(o.result)) return Outcome.FAILED;
        return SENDING;
    }

    /**
     * Whether the 15 s wait for the stop of {@code session} sent at {@code sentAt} ends with the failure line: only
     * when nothing came of it. Not when its outcome came (Stopped: the panel waits for the turn to end; a failure:
     * {@link #stopFate} shows it), not when the service holds it as accepted, and not once the chat is no longer at
     * work. So a stop that succeeded is never shown as failed, however long the turn takes to wind down.
     */
    static boolean stopUnheard(String session, long sentAt, IslandState st) {
        if (st == null) return true;
        if (st.outcome != null && st.outcome.answers("stop", session, sentAt)) return false;
        Progress a = st.progressFor(session);
        if (a == null || session == null || session.isEmpty()) return false; // the turn is over: Stopped, not a failure
        return !a.stopOk;
    }

    /** A stop on its way for {@code a} that the panel hasn't taken in yet: sent after {@code seen}, the send time of
     *  the last one it did (a failed stop the service still holds doesn't start Stopping again). */
    static boolean newStop(Progress a, long seen) {
        return a != null && a.stopping && (a.stopAt > 0 ? a.stopAt > seen : seen == 0);
    }

    /** Whether a new stop for {@code session} should be skipped because one for that chat is already accepted or still
     *  in flight (within {@code timeoutMs} on a monotonic clock). */
    static boolean stopBusy(String session, String stopping, boolean accepted, boolean inFlight, long inFlightSince, long nowMono, long timeoutMs) {
        if (session == null || session.isEmpty() || !session.equals(stopping)) return false;
        return accepted || (inFlight && nowMono - inFlightSince < timeoutMs);
    }

    /** Whether a 200 from a stop request for {@code session} in {@code episode} marks the chat's stop as accepted:
     *  only for the chat and stop episode currently active (retries within one episode share it; a later turn doesn't). */
    static boolean stop200Counts(String session, String stopping, long episode, long currentEpisode) {
        return session != null && !session.isEmpty() && session.equals(stopping) && episode == currentEpisode;
    }

    /** Whether a failed stop attempt ({@code attempt}) for {@code session} clears Stopping and reports FAILED: only
     *  when it is the latest attempt for that chat and no racing 200 has already been accepted. */
    static boolean stopFailCounts(String session, String stopping, long attempt, long latestAttempt, boolean accepted) {
        return session != null && !session.isEmpty() && session.equals(stopping) && attempt == latestAttempt && !accepted;
    }

    /** What the panel changes to after the request {@code overA} or the question {@code overQ} on it was answered
     *  (here or elsewhere): another permission request still waiting, else a single question still waiting that isn't
     *  {@code overQ}, else NONE (it closes). */
    String nextAfter(Approval overA, Ask overQ) {
        if (next(overA) != null) return PERMISSION;
        Ask a = askToShow();
        return a != null && !a.same(overQ) ? QUESTION : NONE;
    }

    /** A request or question arrived while the panel shows Progress or Done: the state it changes to, or NONE. */
    String arrived() {
        if (!approvals.isEmpty()) return PERMISSION;
        return askToShow() != null ? QUESTION : NONE;
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
