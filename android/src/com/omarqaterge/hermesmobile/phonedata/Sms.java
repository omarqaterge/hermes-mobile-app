package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;
import android.telephony.PhoneNumberUtils;

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

    /** Most rows looked at when the sender is a phone number, which is confirmed in Java after the SQL narrowing. */
    private static final int MAX_SCAN = 500;

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
        String digits = null;
        if (sender != null) {
            if (sender.matches("[0-9+()\\-. ]+")) {
                String d = sender.replaceAll("[^0-9]", "");
                if (d.length() >= 7) digits = d;
            }
            // A phone number is narrowed on its last 7 digits, then confirmed with PhoneNumberUtils.compare below.
            sel += " AND " + android.provider.Telephony.Sms.ADDRESS + " LIKE ? ESCAPE '\\'";
            a.add(Caps.like(digits != null ? digits.substring(digits.length() - 7) : sender));
        }
        JSONArray rows = new JSONArray();
        boolean truncated = false;
        Caps.Cut cut = new Caps.Cut();
        int scanned = 0;
        try (Cursor q = c.getContentResolver().query(android.provider.Telephony.Sms.CONTENT_URI, proj, sel,
                a.toArray(new String[0]), date + " DESC")) {
            while (q != null && q.moveToNext()) {
                if (rows.length() >= limit || scanned >= MAX_SCAN) { truncated = true; break; }
                scanned++;
                if (digits != null && !PhoneNumberUtils.compare(String.valueOf(q.getString(0)), digits)) continue;
                rows.put(new JSONObject()
                        .put("address", Caps.text(q.getString(0), Caps.MAX_FIELD, cut))
                        .put("box", q.getInt(1) == 2 ? "sent" : "inbox")
                        .put("time_ms", q.getLong(2))
                        .put("body", Caps.text(q.getString(3), Caps.MAX_SMS_BODY, cut)));
            }
        }
        return Caps.fit(rows, truncated || cut.cut);
    }
}
