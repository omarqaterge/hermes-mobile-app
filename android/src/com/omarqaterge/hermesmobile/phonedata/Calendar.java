package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Reads calendar events (read only) from the instances table, so repeating events expand: soonest first (sorted in memory), all-day events at local midnight, default now to 7 days ahead. */
public final class Calendar {
    private Calendar() {}

    /** Most instances looked at before sorting in memory; more than this sets truncated. */
    private static final int MAX_SCAN = 500;

    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("limit", "from_ms", "to_ms"));

    public static Result read(Context c, JSONObject args) throws JSONException {
        Caps.check(args, KEYS);
        long from = Caps.ms(args, "from_ms", System.currentTimeMillis());
        long to = Caps.ms(args, "to_ms", from + 7L * 24 * 60 * 60 * 1000);
        Caps.range(from, to);
        int limit = Caps.rows(args);
        long day = 24L * 60 * 60 * 1000;
        // Widen a day each side: an all-day event is stored at UTC midnight, which can fall outside the local window.
        Uri.Builder b = android.provider.CalendarContract.Instances.CONTENT_URI.buildUpon();
        android.content.ContentUris.appendId(b, Math.max(0, from - day));
        android.content.ContentUris.appendId(b, to + day);
        String begin = android.provider.CalendarContract.Instances.BEGIN;
        String[] proj = {android.provider.CalendarContract.Instances.TITLE, begin,
                android.provider.CalendarContract.Instances.END, android.provider.CalendarContract.Instances.ALL_DAY,
                android.provider.CalendarContract.Instances.EVENT_LOCATION, android.provider.CalendarContract.Instances.DESCRIPTION};
        List<JSONObject> found = new ArrayList<>();
        boolean truncated = false;
        Caps.Cut cut = new Caps.Cut();
        int scanned = 0;
        try (Cursor q = c.getContentResolver().query(b.build(), proj, null, null, begin + " ASC")) {
            while (q != null && q.moveToNext()) {
                if (scanned >= MAX_SCAN) { truncated = true; break; }
                scanned++;
                boolean allDay = q.getInt(3) != 0;
                long start = allDay ? localMidnight(q.getLong(1)) : q.getLong(1);
                long end = allDay ? localMidnight(q.getLong(2)) : q.getLong(2);
                if (start > to || end <= from) continue;
                found.add(new JSONObject()
                        .put("title", Caps.text(q.getString(0), Caps.MAX_FIELD, cut))
                        .put("start_ms", start)
                        .put("end_ms", end)
                        .put("all_day", allDay)
                        .put("place", Caps.text(q.getString(4), Caps.MAX_FIELD, cut))
                        .put("description", Caps.text(q.getString(5), Caps.MAX_CALENDAR_DESCRIPTION, cut)));
            }
        }
        Collections.sort(found, new Comparator<JSONObject>() {
            @Override public int compare(JSONObject x, JSONObject y) {
                return Long.compare(x.optLong("start_ms"), y.optLong("start_ms"));
            }
        });
        JSONArray rows = new JSONArray();
        for (JSONObject o : found) {
            if (rows.length() >= limit) { truncated = true; break; }
            rows.put(o);
        }
        return Caps.fit(rows, truncated || cut.cut);
    }

    /** The local midnight of the calendar date that {@code utcMs} (an all-day event's UTC midnight) falls on in UTC. */
    static long localMidnight(long utcMs) {
        java.util.Calendar u = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        u.setTimeInMillis(utcMs);
        java.util.Calendar l = java.util.Calendar.getInstance();
        l.clear();
        l.set(u.get(java.util.Calendar.YEAR), u.get(java.util.Calendar.MONTH), u.get(java.util.Calendar.DAY_OF_MONTH), 0, 0, 0);
        return l.getTimeInMillis();
    }
}
