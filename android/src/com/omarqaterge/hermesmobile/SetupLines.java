package com.omarqaterge.hermesmobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.regex.Pattern;

/**
 * The installer's progress channel (app-first setup). The app copies a command with a one-time token; phone/bootstrap.sh
 * POSTs each progress line with it to HermesService's 127.0.0.1:9121/setup; the setup flow shows them. This class is the
 * whole policy: only the current token is accepted (constant-time compare), only known line shapes are kept, the last
 * MAX lines, and DONE ends the token. Plain Java (no Android classes) so tools/test_setup_lines.sh tests it with a JDK.
 *
 * <p>Whether the installer still runs is checked, not guessed from a clock: a copied command that sent nothing yet is
 * WAITING (it blocks nothing), and an installer that sends {@code ALIVE} every 30 s and then goes quiet for LOST_MS while
 * this process listens is LOST (killed before it could send FAIL). The probe's finished marker, which a run removes
 * when it starts, ends a run whose DONE line never arrived ({@link #finishedByProbe()}).
 */
final class SetupLines {
    /** STEP x [text] · TODO text · FAIL x [text] · DONE · phone: text · android: text. No control characters. */
    static final Pattern LINE = Pattern.compile(
            "^(STEP [a-z-]{1,20}( [^\\x00-\\x1f\\x7f]{0,120})?|TODO [^\\x00-\\x1f\\x7f]{1,200}|FAIL [a-z-]{1,20}( [^\\x00-\\x1f\\x7f]{0,200})?"
                    + "|DONE|ALIVE|phone: [^\\x00-\\x1f\\x7f]{1,240}|android: [^\\x00-\\x1f\\x7f]{1,120})$");
    static final int MAX = 50;
    static final int OK = 204, BAD_TOKEN = 403, BAD_LINE = 400;
    /** No line for this long, by this process's clock, after the installer has sent ALIVE: it is gone. It beats every
     *  30 s, so four beats in a row were missed. The clock stops in deep sleep, when the installer is stopped too. */
    static final long LOST_MS = 120_000;
    /** {@link #seen()}: nothing from this command yet · a line came · an ALIVE came (a bootstrap that beats). */
    static final int SEEN_NONE = 0, SEEN_LINE = 1, SEEN_BEAT = 2;

    /** Monotonic milliseconds (stops in deep sleep, like the installer and the main looper's delays). */
    static long nowMs() {
        return System.nanoTime() / 1_000_000;
    }

    /** The installer's last line, {@code DONE}: the plugin is checked at once (PluginSync), so nothing waits for a later start. */
    static boolean checksPlugin(String line) {
        return "DONE".equals(line);
    }

    private final ArrayDeque<String> lines = new ArrayDeque<>();
    /** Epoch seconds of each line (parallel to lines): the installer's own clock, else the receive time. */
    private final ArrayDeque<Long> times = new ArrayDeque<>();
    private String token = "";
    private boolean done = false;
    private String fail = "";
    private String step = "";
    private int seen = SEEN_NONE;
    /** nowMs() of the last line (ALIVE included), or of start/resume: a restarted process gives the installer LOST_MS. */
    private long lastMs = nowMs();

    /** A new command was copied: a new token, a clean list. */
    synchronized void start(String tok) {
        start(tok, nowMs());
    }

    synchronized void start(String tok, long nowMs) {
        token = tok == null ? "" : tok;
        lines.clear();
        times.clear();
        done = false;
        fail = "";
        step = "";
        seen = SEEN_NONE;
        lastMs = nowMs;
    }

    /** NONE: no command copied. WAITING: a command is copied and nothing came from it yet (blocks nothing). INSTALLING:
     *  the installer runs. LOST: it beat and then went quiet (killed without a FAIL line). FAILED: the installer sent FAIL
     *  (token kept, so pasting the command again reports). DONE: the installer finished. */
    enum State { NONE, WAITING, INSTALLING, LOST, FAILED, DONE }

    /** After a service restart: the copied command's token is still valid (no lines kept). */
    synchronized void resume(String tok) {
        resume(tok, "", SEEN_LINE);
    }

    synchronized void resume(String tok, String failedStep) {
        resume(tok, failedStep, SEEN_LINE);
    }

    /** As {@link #resume(String)}, and failedStep = the step of a FAIL line saved before the restart ("" if none), so a
     *  failed install does not read as installing again (a damaged step name is ignored); seenBefore = the saved
     *  {@link #seen()}. The installer gets LOST_MS from now: its beats sent while no process listened went nowhere. */
    synchronized void resume(String tok, String failedStep, int seenBefore) {
        resume(tok, failedStep, seenBefore, nowMs());
    }

    synchronized void resume(String tok, String failedStep, int seenBefore, long nowMs) {
        if (!token.isEmpty() || tok == null || tok.isEmpty()) return;
        token = tok;
        if (failedStep != null && failedStep.matches("[a-z-]{1,20}")) fail = failedStep;
        seen = seenBefore == SEEN_BEAT || seenBefore == SEEN_LINE ? seenBefore : SEEN_NONE;
        lastMs = nowMs;
    }

    synchronized State state() {
        return state(nowMs());
    }

    synchronized State state(long nowMs) {
        if (token.isEmpty()) return done ? State.DONE : State.NONE;
        if (!fail.isEmpty()) return State.FAILED;
        if (seen == SEEN_NONE) return State.WAITING;
        if (seen == SEEN_BEAT && nowMs - lastMs > LOST_MS) return State.LOST;
        return State.INSTALLING;
    }

    /** What came from this command so far (SEEN_*), saved with the token so a restart keeps it. */
    synchronized int seen() {
        return seen;
    }

    /** Milliseconds until a beating installer that stays quiet reads as LOST, or -1 when no such check is due (one
     *  delayed look, re-armed by each line: HermesService.lostCheck). */
    synchronized long lostCheckIn(long nowMs) {
        if (state(nowMs) != State.INSTALLING || seen != SEEN_BEAT) return -1;
        return Math.max(0, lastMs + LOST_MS - nowMs) + 1000;
    }

    /** The probe found ~/.hermes-mobile/installed. A bootstrap that beats removes it before its first ALIVE, so with a
     *  beat seen it was written by this run's DONE: end the token as DONE would. True if this call ended it. Without a
     *  beat (nothing came yet, or an older bootstrap) the marker may be an earlier install's: nothing changes. */
    synchronized boolean finishedByProbe() {
        if (token.isEmpty() || seen != SEEN_BEAT) return false;
        done = true;
        fail = "";
        token = "";
        return true;
    }

    /** The step of the pending FAIL line, "" if none (saved with the token so a restart restores FAILED). */
    synchronized String failedStep() {
        return fail;
    }

    synchronized String token() {
        return token;
    }

    /** A command was copied and DONE hasn't come yet (WAITING, INSTALLING, LOST or FAILED). */
    synchronized boolean active() {
        return !token.isEmpty();
    }

    /** The installer runs right now: the jobs that would clash with it (plugin runs, starting Hermes, the Shizuku keeper,
     *  the local-key switch) wait. Not while WAITING or LOST, so a command never pasted or an installer killed blocks
     *  nothing. */
    synchronized boolean installing() {
        return state() == State.INSTALLING;
    }

    synchronized String step() {
        return step;
    }

    /** OK (kept), BAD_TOKEN (no or wrong token: ignored) or BAD_LINE (unknown shape: dropped). */
    synchronized int add(String tok, String line) {
        return add(tok, line, null, System.currentTimeMillis() / 1000);
    }

    /** ts = the installer's epoch seconds as text (null/odd/more than a day from nowSec: nowSec is used instead). */
    synchronized int add(String tok, String line, String ts, long nowSec) {
        return add(tok, line, ts, nowSec, nowMs());
    }

    /** As above; ALIVE (the installer's beat) is accepted and kept out of the list. */
    synchronized int add(String tok, String line, String ts, long nowSec, long nowMs) {
        if (token.isEmpty() || tok == null
                || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), tok.getBytes(StandardCharsets.UTF_8)))
            return BAD_TOKEN;
        if (line == null || !LINE.matcher(line).matches()) return BAD_LINE;
        lastMs = nowMs;
        if (line.equals("ALIVE")) {
            seen = SEEN_BEAT;
            return OK;
        }
        if (seen == SEEN_NONE) seen = SEEN_LINE;
        lines.addLast(line);
        times.addLast(stamp(ts, nowSec));
        while (lines.size() > MAX) {
            lines.removeFirst();
            times.removeFirst();
        }
        if (line.startsWith("STEP ")) {
            step = line.split(" ", 3)[1];
            fail = "";
        } else if (line.startsWith("FAIL ")) {
            fail = line.split(" ", 3)[1]; // the token stays: pasting the same command again keeps reporting
        } else if (line.equals("DONE")) {
            done = true;
            token = ""; // later posts get 403; the lines stay readable
        }
        return OK;
    }

    static long stamp(String ts, long nowSec) {
        if (ts == null || !ts.matches("[0-9]{9,11}")) return nowSec;
        long t = Long.parseLong(ts);
        return Math.abs(t - nowSec) > 86400 ? nowSec : t;
    }

    /** {"active":…, "lines":[…], "times":[…], "done":…, "fail":"…", "lost":…} for the page. */
    synchronized String json() {
        return json(nowMs());
    }

    synchronized String json(long nowMs) {
        StringBuilder b = new StringBuilder("{\"active\":").append(!token.isEmpty()).append(",\"lines\":[");
        boolean first = true;
        for (String l : lines) {
            if (!first) b.append(',');
            first = false;
            quote(b, l);
        }
        b.append("],\"times\":[");
        first = true;
        for (Long t : times) {
            if (!first) b.append(',');
            first = false;
            b.append(t.longValue());
        }
        b.append("],\"done\":").append(done).append(",\"fail\":");
        quote(b, fail);
        return b.append(",\"lost\":").append(state(nowMs) == State.LOST).append('}').toString();
    }

    static void quote(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        b.append('"');
    }

    /** {"token":"…","line":"…","ts":"…"} as bootstrap's say() writes it (printf with \ and " escaped): {token, line, ts};
     *  ts is null from an older bootstrap. Null if it isn't that. */
    static String[] parse(String body) {
        if (body == null || body.length() > 1024) return null;
        String tok = field(body, "token"), line = field(body, "line");
        return tok == null || line == null ? null : new String[]{tok, line, field(body, "ts")};
    }

    private static String field(String body, String name) {
        String k = "\"" + name + "\"";
        int i = body.indexOf(k);
        if (i < 0) return null;
        i = body.indexOf(':', i + k.length());
        if (i < 0) return null;
        i++;
        while (i < body.length() && body.charAt(i) == ' ') i++;
        if (i >= body.length() || body.charAt(i) != '"') return null;
        StringBuilder out = new StringBuilder();
        for (i++; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '"') return out.toString();
            if (c == '\\') {
                if (++i >= body.length()) return null;
                char e = body.charAt(i);
                if (e == '"' || e == '\\' || e == '/') out.append(e);
                else return null; // say() only escapes \ and "; anything else is not ours
            } else out.append(c);
        }
        return null;
    }
}
