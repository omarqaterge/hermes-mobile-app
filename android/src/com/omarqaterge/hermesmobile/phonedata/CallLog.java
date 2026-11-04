package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Reads the call log (read only): newest first, default the last 7 days. Row shape in docs/status/phone-data.md. */
public final class CallLog {
    private CallLog() {}

    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("limit", "from_ms", "to_ms"));

    public static Result read(Context c, JSONObject args) throws JSONException {
        Caps.check(args, KEYS);
        long to = Caps.ms(args, "to_ms", System.currentTimeMillis());
        long from = Caps.ms(args, "from_ms", Math.max(0, to - 7L * 24 * 60 * 60 * 1000));
        Caps.range(from, to);
        int limit = Caps.rows(args);
        String date = android.provider.CallLog.Calls.DATE;
        String[] proj = {android.provider.CallLog.Calls.NUMBER, android.provider.CallLog.Calls.CACHED_NAME,
                android.provider.CallLog.Calls.TYPE, date, android.provider.CallLog.Calls.DURATION};
        JSONArray rows = new JSONArray();
        boolean truncated = false;
        try (Cursor q = c.getContentResolver().query(android.provider.CallLog.Calls.CONTENT_URI, proj,
                date + " >= ? AND " + date + " <= ?", new String[]{String.valueOf(from), String.valueOf(to)}, date + " DESC")) {
            while (q != null && q.moveToNext()) {
                if (rows.length() >= limit) { truncated = true; break; }
                rows.put(new JSONObject()
                        .put("number", Caps.text(q.getString(0), Caps.MAX_FIELD))
                        .put("name", Caps.text(q.getString(1), Caps.MAX_FIELD))
                        .put("type", type(q.getInt(2)))
                        .put("time_ms", q.getLong(3))
                        .put("duration_s", q.getLong(4)));
            }
        }
        return Caps.fit(rows, truncated);
    }

    /** The contract's word for a call type; voicemail and answered-elsewhere are "other". */
    static String type(int t) {
        switch (t) {
            case android.provider.CallLog.Calls.INCOMING_TYPE: return "incoming";
            case android.provider.CallLog.Calls.OUTGOING_TYPE: return "outgoing";
            case android.provider.CallLog.Calls.MISSED_TYPE: return "missed";
            case android.provider.CallLog.Calls.REJECTED_TYPE: return "rejected";
            case android.provider.CallLog.Calls.BLOCKED_TYPE: return "blocked";
            default: return "other";
        }
    }
}
