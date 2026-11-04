package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Reads calendar events (read only) from the instances table, so repeating events expand: soonest first, default now to 7 days ahead. */
public final class Calendar {
    private Calendar() {}

    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("limit", "from_ms", "to_ms"));

    public static Result read(Context c, JSONObject args) throws JSONException {
        Caps.check(args, KEYS);
        long from = Caps.ms(args, "from_ms", System.currentTimeMillis());
        long to = Caps.ms(args, "to_ms", from + 7L * 24 * 60 * 60 * 1000);
        Caps.range(from, to);
        int limit = Caps.rows(args);
        Uri.Builder b = android.provider.CalendarContract.Instances.CONTENT_URI.buildUpon();
        android.content.ContentUris.appendId(b, from);
        android.content.ContentUris.appendId(b, to);
        String begin = android.provider.CalendarContract.Instances.BEGIN;
        String[] proj = {android.provider.CalendarContract.Instances.TITLE, begin,
                android.provider.CalendarContract.Instances.END, android.provider.CalendarContract.Instances.ALL_DAY,
                android.provider.CalendarContract.Instances.EVENT_LOCATION, android.provider.CalendarContract.Instances.DESCRIPTION};
        JSONArray rows = new JSONArray();
        boolean truncated = false;
        try (Cursor q = c.getContentResolver().query(b.build(), proj, null, null, begin + " ASC")) {
            while (q != null && q.moveToNext()) {
                if (rows.length() >= limit) { truncated = true; break; }
                rows.put(new JSONObject()
                        .put("title", Caps.text(q.getString(0), Caps.MAX_FIELD))
                        .put("start_ms", q.getLong(1))
                        .put("end_ms", q.getLong(2))
                        .put("all_day", q.getInt(3) != 0)
                        .put("place", Caps.text(q.getString(4), Caps.MAX_FIELD))
                        .put("description", Caps.text(q.getString(5), Caps.MAX_CALENDAR_DESCRIPTION)));
            }
        }
        return Caps.fit(rows, truncated);
    }
}
