#!/bin/bash
# Tests the diagnostic log's policy (android/.../DiagLog.java) with a plain JDK: free text can't get in (a message, a path,
# a key or an exception's words), crash lines hold only type names and our own frames, the two files stay bounded, old
# lines go, the rate limit, and off deletes. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/DiagLog.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/DiagLogTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.io.File;
import java.util.List;
public class DiagLogTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static final String OWN = "com.omarqaterge.hermesmobile";
    public static void main(String[] a) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        File dir = new File(a[0]);

        // Free text can't get in, whatever a caller passes.
        String[] canaries = {
            "call my doctor about the results", "/sdcard/Documents/private.pdf", "/data/data/com.termux/files/home/notes.md",
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "me@example.org",
            "https://example.org/a?token=x", "a b", "line\nbreak", "x=1", "\"quoted\""
        };
        for (String c : canaries) {
            String l = DiagLog.line("area", "event", "field", c);
            check(l.equals("area event field=?"), "a value of the wrong shape becomes ?: " + c.replace("\n", "\\n"));
        }
        check(DiagLog.line("area", "event", "code", "401", "type", "TimeoutError", "v", "1.4.0+devtools").equals("area event code=401 type=TimeoutError v=1.4.0+devtools"), "short codes, names and versions are kept");
        check(DiagLog.line("Bad Area", "e vent", "a key", "1").equals("unknown unknown unknown=1"), "names of the wrong shape become unknown");
        check(DiagLog.line("a", "b", "odd").equals("a b"), "a field without a value is dropped");
        check(DiagLog.line("a", "b", (String[]) null).equals("a b"), "no fields at all");
        check(DiagLog.line("a", "b", "at", "MainActivity.onCreate:12,HermesService.serve:9").contains("at=MainActivity.onCreate:12,HermesService.serve:9"), "a stack is allowed only in the at field");
        check(DiagLog.line("a", "b", "other", "MainActivity.onCreate:12,HermesService.serve:9").equals("a b other=?"), "a stack anywhere else is not");
        String many = DiagLog.line("a", "b", "f1","1","f2","2","f3","3","f4","4","f5","5","f6","6","f7","7","f8","8","f9","9");
        check(!many.contains("f9"), "at most " + DiagLog.MAX_FIELDS + " fields");

        // A crash: type names and our own frames, never the words.
        DiagLog log = new DiagLog(dir);
        Exception inner = new IllegalStateException("cause says call my doctor");
        RuntimeException e = new RuntimeException("Couldn't open /sdcard/Documents/private.pdf for me@example.org", inner);
        e.setStackTrace(new StackTraceElement[]{
            new StackTraceElement("java.io.FileInputStream", "open", null, 1),
            new StackTraceElement(OWN + ".MainActivity", "readShared", null, 77),
            new StackTraceElement("com.other.Lib", "secretName", null, 5),
        });
        inner.setStackTrace(new StackTraceElement[]{new StackTraceElement(OWN + ".MainActivity$Bridge", "sharedItem", null, 12)});
        log.crash(e, "main", OWN);
        log.crash(new OutOfMemoryError("big"), "worker-with-a-name", OWN);
        List<String> lines = log.read(now);
        String all = String.join("\n", lines);
        check(all.contains("crash java type=RuntimeException cause=IllegalStateException thread=main at=MainActivity$Bridge.sharedItem:12"), "the crash line has the types and the root cause's frame: " + (lines.isEmpty() ? "" : lines.get(0)));
        check(all.contains("type=OutOfMemoryError thread=other"), "a thread's name is not kept");
        for (String no : new String[]{"doctor", "private.pdf", "example.org", "secretName", "com.other", "worker-with", "omarqaterge"})
            check(!all.contains(no), "the crash line doesn't hold: " + no);
        e = new RuntimeException("x");
        e.setStackTrace(new StackTraceElement[]{new StackTraceElement("java.lang.Thread", "run", null, 1), new StackTraceElement(OWN + ".Voice", "speak", null, 3), new StackTraceElement("com.other.Lib", "x", null, 5)});
        check(DiagLog.stackOf(e, OWN).equals("Voice.speak:3"), "only our own frames");
        check(DiagLog.stackOf(new RuntimeException(), "no.such.pkg").equals("none"), "no frames of our own");

        // Lines read back with a date and no year, and old ones go.
        log.clear();
        log.event(now - DiagLog.MAX_AGE_SEC - 10, "old", "line");
        log.event(now - 60, "new", "line");
        lines = log.read(now);
        check(lines.size() == 1 && lines.get(0).matches("\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d new line"), "older than a week is dropped, the rest has a date: " + lines);
        check(DiagLog.pretty(0).equals("01-01 00:00:00"), "UTC, without a year");

        // A line of anything else in the file is not read back.
        log.clear();
        log.event("a", "b");
        java.nio.file.Files.write(new File(dir, "events.log").toPath(), "not one of ours\n".getBytes(), java.nio.file.StandardOpenOption.APPEND);
        check(log.read(now).size() == 1, "a line that isn't ours is skipped");

        // Bounded: two files of MAX_BYTES at most.
        log.clear();
        DiagLog big = new DiagLog(dir);
        java.lang.reflect.Field rate = DiagLog.class.getDeclaredField("rateCount");
        rate.setAccessible(true);
        for (int i = 0; i < 12000; i++) {
            rate.setInt(big, 0);
            big.event(now, "fill", "the_log", "number", String.valueOf(i), "more", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        }
        long c = new File(dir, "events.log").length(), o = new File(dir, "events.log.1").length();
        check(c <= DiagLog.MAX_BYTES && o <= DiagLog.MAX_BYTES && o > 0, "two files, each under the limit: " + c + " and " + o);
        lines = big.read(now);
        check(lines.get(lines.size() - 1).contains("number=11999"), "the newest line is kept");

        // The rate limit, and it says how many went missing.
        big.clear();
        DiagLog limited = new DiagLog(dir);
        long m0 = System.currentTimeMillis() / 60_000;
        for (int i = 0; i < DiagLog.RATE_MAX + 20; i++) limited.event(now, "flood", "e");
        if (System.currentTimeMillis() / 60_000 == m0) {
            check(limited.read(now).size() == DiagLog.RATE_MAX, "at most " + DiagLog.RATE_MAX + " events a minute");
            limited.crash(new RuntimeException("x"), "main", OWN);
            check(limited.read(now).stream().anyMatch(l -> l.contains("crash java")), "a crash gets past the limit");
        }

        // Off: nothing written, and what was kept is deleted.
        limited.setEnabled(false);
        check(!new File(dir, "events.log").exists(), "off deletes the log");
        limited.event("after", "off");
        limited.crash(new RuntimeException("x"), "main", OWN);
        check(!new File(dir, "events.log").exists() && limited.read(now).isEmpty(), "off writes nothing, not even a crash");
        limited.setEnabled(true);
        limited.event("back", "on");
        check(limited.read(now).size() == 1, "on again keeps new events");
        limited.clear();
        check(limited.read(now).isEmpty(), "clear deletes both files");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.DiagLogTest "$T/data"
