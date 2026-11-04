package com.omarqaterge.hermesmobile.phonedata;

import org.json.JSONObject;

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

    /** The asked-for row count, kept between 1 and {@link #MAX_ROWS}. */
    public static int rows(JSONObject args) {
        int n = args == null ? DEFAULT_ROWS : args.optInt("limit", DEFAULT_ROWS);
        return Math.max(1, Math.min(MAX_ROWS, n));
    }

    /** Text with control characters removed and cut to {@code max} characters; never null. */
    public static String text(String s, int max) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(Math.min(s.length(), max));
        for (int i = 0; i < s.length() && out.length() < max; i++) {
            char c = s.charAt(i);
            if (c == '\n' || c == '\t') out.append(' ');
            else if (!Character.isISOControl(c)) out.append(c);
        }
        int end = out.length();
        if (end > 0 && Character.isHighSurrogate(out.charAt(end - 1))) out.setLength(end - 1);
        return out.toString();
    }
}
