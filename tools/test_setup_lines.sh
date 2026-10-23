#!/bin/bash
# Tests the app-first setup's progress-line policy (android/.../SetupLines.java) with a plain JDK: token check, line
# filter, the 50-line buffer, FAIL/DONE handling, and the JSON that bootstrap's say() posts. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/SetupLines.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/SetupLinesTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class SetupLinesTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    public static void main(String[] a) {
        SetupLines s = new SetupLines();
        check(s.add("t", "STEP packages") == SetupLines.BAD_TOKEN, "no token issued: every post is refused");
        s.start("abc123");
        check(s.active(), "copying the command makes it active");
        check(s.add("abc124", "STEP packages x") == SetupLines.BAD_TOKEN, "a wrong token is refused");
        check(s.add("", "STEP packages x") == SetupLines.BAD_TOKEN, "an empty token is refused");
        check(s.add("abc123", "STEP packages Termux packages (a few minutes)") == SetupLines.OK, "STEP with text is kept");
        check(s.add("abc123", "STEP packages ") == SetupLines.OK, "STEP with an empty text (say \"STEP $STEP $*\") is kept");
        check(s.add("abc123", "phone: tap Allow on Android’s prompt") == SetupLines.OK, "phone: hint (non-ASCII) is kept");
        check(s.add("abc123", "android: child-process limit lifted (via Shizuku)") == SetupLines.OK, "android: line is kept");
        check(s.add("abc123", "TODO files: allow Termux") == SetupLines.OK, "TODO line is kept");
        for (String bad : new String[]{"STEP Debian", "STEP packages\nDONE", "hello", "rm -rf /", "STEP " + "a".repeat(21), "phone: ", "DONE ", "MODEL SET x y", "phone: a\u0007b", "== HMSETUP DONE"})
            check(s.add("abc123", bad) == SetupLines.BAD_LINE, "dropped: " + bad.replace("\n", "\\n").replace("\u0007", "\\a"));
        check(s.add("abc123", "FAIL debian (line 120)") == SetupLines.OK && s.json().contains("\"fail\":\"debian\"") && s.active(), "FAIL names the step and keeps the token");
        check(s.add("abc123", "STEP debian again") == SetupLines.OK && s.json().contains("\"fail\":\"\""), "a new STEP clears the FAIL (pasted again)");
        for (int i = 0; i < 60; i++) s.add("abc123", "TODO line " + i);
        check(s.json().split("TODO line").length - 1 == 50 && !s.json().contains("TODO line 9\"") && s.json().contains("TODO line 59"), "only the last 50 lines are kept");
        check(s.add("abc123", "DONE") == SetupLines.OK && !s.active() && s.json().contains("\"done\":true"), "DONE ends the token, done=true");
        check(s.add("abc123", "STEP start x") == SetupLines.BAD_TOKEN, "after DONE the token is refused");
        check(s.json().contains("TODO line 59"), "lines stay readable after DONE");
        String[] p = SetupLines.parse("{\"token\":\"abc\",\"line\":\"phone: say \\\"hi\\\" \\\\ ok\"}");
        check(p != null && p[0].equals("abc") && p[1].equals("phone: say \"hi\" \\ ok"), "parse: say()'s escaped JSON");
        check(SetupLines.parse("{\"token\":\"abc\"}") == null, "parse: no line → null");
        check(SetupLines.parse("{\"token\":\"abc\",\"line\":\"a\\nb\"}") == null, "parse: escapes say() never writes → null");
        check(SetupLines.parse("{\"token\":\"" + "x".repeat(1100) + "\",\"line\":\"DONE\"}") == null, "parse: bodies over 1 kB → null");
        SetupLines r = new SetupLines();
        r.resume("tok");
        check(r.add("tok", "STEP hermes x") == SetupLines.OK, "resume (service restart) keeps accepting the copied token");
        StringBuilder q = new StringBuilder(); SetupLines.quote(q, "a\"b\\c\u2028");
        check(q.toString().equals("\"a\\\"b\\\\c\\u2028\""), "json quoting");
        SetupLines t = new SetupLines();
        t.start("tk");
        t.add("tk", "STEP packages x", "1000000100", 1000000200L);
        t.add("tk", "STEP debian x", null, 1000000300L);
        t.add("tk", "STEP hermes x", "abc", 1000000400L);
        t.add("tk", "STEP plugin x", "1999999999", 1000000500L);
        t.add("tk", "STEP start x", "1000000590", 1000000600L);
        check(t.json().contains("\"times\":[1000000100,1000000300,1000000400,1000000500,1000000590]"), "times: installer clock kept; missing, junk or >1 day off falls back to the receive time");
        String[] q3 = SetupLines.parse("{\"token\":\"abc\",\"line\":\"STEP debian x\",\"ts\":\"1761200000\"}");
        check(q3 != null && q3[2].equals("1761200000") && q3[1].equals("STEP debian x"), "parse: ts field");
        String[] q4 = SetupLines.parse("{\"token\":\"abc\",\"line\":\"DONE\"}");
        check(q4 != null && q4[2] == null && q4[1].equals("DONE"), "parse: an older bootstrap (no ts) still parses");
        SetupLines u = new SetupLines();
        u.start("u");
        for (int i = 0; i < 60; i++) u.add("u", "TODO line " + i, "" + (1000000000L + i), 1000000000L + i);
        check(u.json().contains("\"times\":[1000000010,") && u.json().contains(",1000000059]"), "times stay parallel to the 50 kept lines");
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.SetupLinesTest
