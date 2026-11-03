package com.omarqaterge.hermesmobile;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Pattern;

/**
 * The diagnostic log on the phone: what happened in the app, never what the user said or did. This class is the whole
 * policy: an event is an area, an event name and short fields, each checked against a fixed shape when it is written,
 * so free text (a message, a path, an exception's words) can't get in; two files of MAX_BYTES at most in a folder
 * Android doesn't back up; lines older than MAX_AGE_SEC dropped on read; RATE_MAX events a minute at most. Nothing here
 * sends anything: Report a problem reads it, only when the user includes it. Plain Java (no Android classes) so
 * tools/test_diag_log.sh tests it with a JDK.
 */
final class DiagLog {
    static final int MAX_BYTES = 128 * 1024;
    static final long MAX_AGE_SEC = 7 * 86_400;
    static final int RATE_MAX = 30;
    /** Long enough for a model or exception name, too short for a sentence or for the common keys (40 and more). */
    static final int MAX_VALUE = 32;
    static final int MAX_FIELDS = 8;
    static final int MAX_FRAMES = 8;

    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_]{0,23}");
    private static final Pattern VALUE = Pattern.compile("[A-Za-z0-9_.:+-]{1," + MAX_VALUE + "}");
    /** A filtered stack, built only by stackOf: Class.method:line,Class.method:line */
    private static final Pattern STACK = Pattern.compile("[A-Za-z0-9_.:$<>,-]{1,400}");

    private final File current;
    private final File older;
    private boolean enabled = true;
    private long rateMinute = 0;
    private int rateCount = 0;
    private int dropped = 0;

    /** folder: the app's no-backup folder on the phone. */
    DiagLog(File folder) {
        current = new File(folder, "events.log");
        older = new File(folder, "events.log.1");
    }

    synchronized void setEnabled(boolean on) {
        enabled = on;
        if (!on) clear();
    }

    synchronized boolean enabled() {
        return enabled;
    }

    /** One event; fields are name, value, name, value. Anything the wrong shape is written as "?". Never throws. */
    void event(String area, String name, String... fields) {
        event(System.currentTimeMillis() / 1000, area, name, fields);
    }

    synchronized void event(long atSec, String area, String name, String... fields) {
        try {
            if (!enabled) return;
            long minute = System.currentTimeMillis() / 60_000;
            if (minute != rateMinute) {
                rateMinute = minute;
                rateCount = 0;
            }
            if (++rateCount > RATE_MAX) {
                dropped++;
                return;
            }
            String extra = "";
            if (dropped > 0) {
                extra = stamp(atSec) + " log dropped count=" + dropped + "\n";
                dropped = 0;
            }
            write(extra + stamp(atSec) + " " + line(area, name, fields) + "\n");
        } catch (Exception ignored) {
            // Logging must never take the app down.
        }
    }

    /** "area event a=1 b=2", every part checked. Exposed for the tests. */
    static String line(String area, String name, String... fields) {
        StringBuilder s = new StringBuilder(safeName(area)).append(' ').append(safeName(name));
        int n = fields == null ? 0 : Math.min(fields.length / 2, MAX_FIELDS);
        for (int i = 0; i < n; i++) {
            String k = safeName(fields[2 * i]);
            String v = fields[2 * i + 1];
            boolean ok = v != null && ("at".equals(k) ? STACK : VALUE).matcher(v).matches();
            s.append(' ').append(k).append('=').append(ok ? v : "?");
        }
        return s.toString();
    }

    private static String safeName(String n) {
        return n != null && NAME.matcher(n).matches() ? n : "unknown";
    }

    /** An uncaught exception: type names and the frames of our own code, never the exception's words. */
    void crash(Throwable t, String threadName, String ownPackage) {
        synchronized (this) {
            rateCount = 0; // a crash is the one event that must not be lost to the limit
        }
        String type = t == null ? "?" : t.getClass().getSimpleName();
        Throwable root = t;
        for (int i = 0; root != null && root.getCause() != null && root.getCause() != root && i < 8; i++) root = root.getCause();
        String rootType = root == null || root == t ? "" : root.getClass().getSimpleName();
        String thread = "main".equals(threadName) ? "main" : "other";
        if (rootType.isEmpty()) event("crash", "java", "type", type, "thread", thread, "at", stackOf(t, ownPackage));
        else event("crash", "java", "type", type, "cause", rootType, "thread", thread, "at", stackOf(root, ownPackage));
    }

    /** Up to MAX_FRAMES frames of our own package, without the package's name. Other frames are left out: they say
     *  little, and only our own code's names are known to hold nothing of the user's. */
    static String stackOf(Throwable t, String ownPackage) {
        if (t == null) return "none";
        StringBuilder s = new StringBuilder();
        int n = 0;
        for (StackTraceElement f : t.getStackTrace()) {
            String c = f.getClassName();
            if (ownPackage == null || !c.startsWith(ownPackage + ".")) continue;
            if (n++ == MAX_FRAMES) break;
            if (s.length() > 0) s.append(',');
            s.append(c.substring(ownPackage.length() + 1)).append('.').append(f.getMethodName()).append(':').append(f.getLineNumber());
        }
        return s.length() == 0 ? "none" : s.toString();
    }

    /** Every line younger than MAX_AGE_SEC, oldest first. */
    synchronized List<String> read(long nowSec) {
        List<String> out = new ArrayList<>();
        long oldest = nowSec - MAX_AGE_SEC;
        for (File f : new File[]{older, current}) {
            if (!f.isFile()) continue;
            try {
                for (String l : Files.readAllLines(f.toPath(), StandardCharsets.UTF_8)) {
                    int sp = l.indexOf(' ');
                    if (sp <= 0) continue;
                    try {
                        long at = Long.parseLong(l.substring(0, sp));
                        if (at >= oldest) out.add(pretty(at) + l.substring(sp));
                    } catch (NumberFormatException ignored) {
                        // not one of ours
                    }
                }
            } catch (Exception ignored) {
                // unreadable: as if empty
            }
        }
        return out;
    }

    synchronized void clear() {
        current.delete();
        older.delete();
        dropped = 0;
    }

    private void write(String text) throws Exception {
        File dir = current.getParentFile();
        if (dir != null) dir.mkdirs();
        if (current.length() + text.length() > MAX_BYTES) {
            older.delete();
            current.renameTo(older);
        }
        try (FileOutputStream o = new FileOutputStream(current, true)) {
            o.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String stamp(long atSec) {
        return Long.toString(atSec);
    }

    /** Month, day and time in UTC: no year and no time zone. */
    static String pretty(long atSec) {
        SimpleDateFormat f = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(atSec * 1000));
    }
}
