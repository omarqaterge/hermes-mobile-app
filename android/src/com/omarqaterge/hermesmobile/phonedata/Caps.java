package com.omarqaterge.hermesmobile.phonedata;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Set;

/** The size limits of phone-data results, applied in the app because the plugin isn't trusted to apply them. */
public final class Caps {
    private Caps() {}

    public static final int DEFAULT_ROWS = 20;
    public static final int MAX_ROWS = 50;
    public static final int MAX_BYTES = 16 * 1024;
    public static final int MAX_FIELD = 200;
    public static final int MAX_SMS_BODY = 300;
    public static final int MAX_CALENDAR_DESCRIPTION = 200;
    public static final int MAX_QUERY = 64;
    public static final long MAX_RANGE_MS = 90L * 24 * 60 * 60 * 1000;

    /** Set by the {@code text} helpers when they cut something off, so a reader can report {@code truncated}. */
    public static final class Cut {
        public boolean cut;
    }

    /** The asked-for row count: the default when absent; refuses (IllegalArgumentException) a non-integer or a value outside 1 to {@link #MAX_ROWS}. */
    public static int rows(JSONObject args) {
        if (args == null || !args.has("limit")) return DEFAULT_ROWS;
        Object v = args.opt("limit");
        if (!(v instanceof Integer || v instanceof Long)) throw new IllegalArgumentException("limit");
        long n = ((Number) v).longValue();
        if (n < 1 || n > MAX_ROWS) throw new IllegalArgumentException("limit");
        return (int) n;
    }

    /** Text with unsafe characters removed and cut to {@code max} characters; never null. */
    public static String text(String s, int max) {
        return text(s, max, null);
    }

    /**
     * Text cut to {@code max} characters, never null. Control characters (a newline, tab or return becomes a space), the
     * line and paragraph separators and format characters (bidi controls, tag characters) are removed, except U+200D so
     * emoji keep their joins. {@code cut.cut} is set when a character was dropped for length.
     */
    public static String text(String s, int max, Cut cut) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(Math.min(s.length(), max));
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            int t = Character.getType(cp);
            if (cp == '\n' || cp == '\t' || cp == '\r') cp = ' ';
            else if (Character.isISOControl(cp) || t == Character.LINE_SEPARATOR || t == Character.PARAGRAPH_SEPARATOR
                    || (t == Character.FORMAT && cp != 0x200D)) continue;
            if (out.length() + Character.charCount(cp) > max) {
                if (cut != null) cut.cut = true;
                break;
            }
            out.appendCodePoint(cp);
        }
        return out.toString();
    }

    /** Refuses (IllegalArgumentException, which the service answers as bad_request) any key not in {@code allowed}, and a non-integer {@code limit}. */
    public static void check(JSONObject args, Set<String> allowed) {
        if (args == null) return;
        for (Iterator<String> it = args.keys(); it.hasNext(); ) {
            if (!allowed.contains(it.next())) throw new IllegalArgumentException("unknown argument");
        }
        if (args.has("limit")) {
            Object v = args.opt("limit");
            if (!(v instanceof Integer || v instanceof Long)) throw new IllegalArgumentException("limit");
        }
    }

    /** A text argument (query, sender): null when absent or empty; refuses a non-string or one over {@link #MAX_QUERY}. */
    public static String str(JSONObject args, String key) {
        if (args == null || !args.has(key)) return null;
        Object v = args.opt(key);
        if (!(v instanceof String) || ((String) v).length() > MAX_QUERY) throw new IllegalArgumentException(key);
        String s = (String) v;
        return s.isEmpty() ? null : s;
    }

    /** A time argument in ms: {@code def} when absent; refuses anything but a whole non-negative number. */
    public static long ms(JSONObject args, String key, long def) {
        if (args == null || !args.has(key)) return def;
        Object v = args.opt(key);
        if (!(v instanceof Integer || v instanceof Long) || ((Number) v).longValue() < 0) throw new IllegalArgumentException(key);
        return ((Number) v).longValue();
    }

    /** Refuses a reversed range or one longer than {@link #MAX_RANGE_MS}. */
    public static void range(long from, long to) {
        if (to < from || to - from > MAX_RANGE_MS) throw new IllegalArgumentException("range");
    }

    /** {@code %s%} with the LIKE wildcards of {@code s} escaped; use with {@code LIKE ? ESCAPE '\'}. */
    public static String like(String s) {
        return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    /** The rows as a result whose whole answer (rows plus a 256-byte reserve for the wrapper) stays under {@link #MAX_BYTES}: later rows are dropped, and truncated set, until it fits. */
    public static Result fit(JSONArray rows, boolean truncated) {
        JSONArray out = new JSONArray();
        int size = 2 + 256;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject o = rows.optJSONObject(i);
            if (o == null) continue;
            int n = o.toString().getBytes(StandardCharsets.UTF_8).length + 1;
            if (size + n > MAX_BYTES) return new Result(out, true);
            size += n;
            out.put(o);
        }
        return new Result(out, truncated);
    }
}
