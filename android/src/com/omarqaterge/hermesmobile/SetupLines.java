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
 */
final class SetupLines {
    /** STEP x [text] · TODO text · FAIL x [text] · DONE · phone: text · android: text. No control characters. */
    static final Pattern LINE = Pattern.compile(
            "^(STEP [a-z-]{1,20}( [^\\x00-\\x1f\\x7f]{0,120})?|TODO [^\\x00-\\x1f\\x7f]{1,200}|FAIL [a-z-]{1,20}( [^\\x00-\\x1f\\x7f]{0,200})?"
                    + "|DONE|phone: [^\\x00-\\x1f\\x7f]{1,240}|android: [^\\x00-\\x1f\\x7f]{1,120})$");
    static final int MAX = 50;
    static final int OK = 204, BAD_TOKEN = 403, BAD_LINE = 400;

    private final ArrayDeque<String> lines = new ArrayDeque<>();
    private String token = "";
    private boolean done = false;
    private String fail = "";
    private String step = "";

    /** A new command was copied: a new token, a clean list. */
    synchronized void start(String tok) {
        token = tok == null ? "" : tok;
        lines.clear();
        done = false;
        fail = "";
        step = "";
    }

    /** After a service restart: the copied command's token is still valid (no lines kept). */
    synchronized void resume(String tok) {
        if (token.isEmpty() && tok != null) token = tok;
    }

    synchronized String token() {
        return token;
    }

    /** A command was copied and DONE hasn't come yet. */
    synchronized boolean active() {
        return !token.isEmpty();
    }

    synchronized boolean installing() {
        return !token.isEmpty() && fail.isEmpty();
    }

    synchronized String step() {
        return step;
    }

    /** OK (kept), BAD_TOKEN (no or wrong token: ignored) or BAD_LINE (unknown shape: dropped). */
    synchronized int add(String tok, String line) {
        if (token.isEmpty() || tok == null
                || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), tok.getBytes(StandardCharsets.UTF_8)))
            return BAD_TOKEN;
        if (line == null || !LINE.matcher(line).matches()) return BAD_LINE;
        lines.addLast(line);
        while (lines.size() > MAX) lines.removeFirst();
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

    /** {"active":…, "lines":[…], "done":…, "fail":"…"} for the page. */
    synchronized String json() {
        StringBuilder b = new StringBuilder("{\"active\":").append(!token.isEmpty()).append(",\"lines\":[");
        boolean first = true;
        for (String l : lines) {
            if (!first) b.append(',');
            first = false;
            quote(b, l);
        }
        b.append("],\"done\":").append(done).append(",\"fail\":");
        quote(b, fail);
        return b.append('}').toString();
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

    /** {"token":"…","line":"…"} as bootstrap's say() writes it (printf with \ and " escaped). Null if it isn't that. */
    static String[] parse(String body) {
        if (body == null || body.length() > 1024) return null;
        String tok = field(body, "token"), line = field(body, "line");
        return tok == null || line == null ? null : new String[]{tok, line};
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
