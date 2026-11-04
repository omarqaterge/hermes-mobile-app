package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Reads text messages (SMS only, no MMS or attachments; read only): inbox and sent, newest first. */
public final class Sms {
    private Sms() {}

    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("limit", "box", "sender"));

    public static Result read(Context c, JSONObject args) throws JSONException {
        Caps.check(args, KEYS);
        String box = "all";
        if (args != null && args.has("box")) {
            Object v = args.opt("box");
            if (!(v instanceof String) || !(v.equals("inbox") || v.equals("sent") || v.equals("all"))) {
                throw new IllegalArgumentException("box");
            }
            box = (String) v;
        }
        String sender = Caps.str(args, "sender");
        int limit = Caps.rows(args);
        String date = android.provider.Telephony.Sms.DATE;
        String type = android.provider.Telephony.Sms.TYPE;
        String[] proj = {android.provider.Telephony.Sms.ADDRESS, type, date, android.provider.Telephony.Sms.BODY};
        String sel;
        List<String> a = new ArrayList<>();
        if (box.equals("inbox")) { sel = type + " = ?"; a.add("1"); }
        else if (box.equals("sent")) { sel = type + " = ?"; a.add("2"); }
        else sel = type + " IN (1, 2)";
        if (sender != null) {
            sel += " AND " + android.provider.Telephony.Sms.ADDRESS + " LIKE ? ESCAPE '\\'";
            a.add(Caps.like(sender));
        }
        JSONArray rows = new JSONArray();
        boolean truncated = false;
        try (Cursor q = c.getContentResolver().query(android.provider.Telephony.Sms.CONTENT_URI, proj, sel,
                a.toArray(new String[0]), date + " DESC")) {
            while (q != null && q.moveToNext()) {
                if (rows.length() >= limit) { truncated = true; break; }
                rows.put(new JSONObject()
                        .put("address", Caps.text(q.getString(0), Caps.MAX_FIELD))
                        .put("box", q.getInt(1) == 2 ? "sent" : "inbox")
                        .put("time_ms", q.getLong(2))
                        .put("body", Caps.text(q.getString(3), Caps.MAX_SMS_BODY)));
            }
        }
        return Caps.fit(rows, truncated);
    }
}
