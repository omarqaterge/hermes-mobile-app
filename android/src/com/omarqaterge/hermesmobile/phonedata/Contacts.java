package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Reads contacts (read only): name search, by name, with each contact's numbers and emails (at most 5 of each). */
public final class Contacts {
    private Contacts() {}

    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("limit", "query"));
    private static final int MAX_PER_CONTACT = 5;

    public static Result read(Context c, JSONObject args) throws JSONException {
        Caps.check(args, KEYS);
        String query = Caps.str(args, "query");
        int limit = Caps.rows(args);
        String name = android.provider.ContactsContract.Contacts.DISPLAY_NAME;
        String[] proj = {android.provider.ContactsContract.Contacts._ID, name};
        String sel = null;
        String[] selArgs = null;
        if (query != null) {
            sel = name + " LIKE ? ESCAPE '\\'";
            selArgs = new String[]{Caps.like(query)};
        }
        List<Long> ids = new ArrayList<>();
        List<String> names = new ArrayList<>();
        boolean truncated = false;
        Caps.Cut cut = new Caps.Cut();
        try (Cursor q = c.getContentResolver().query(android.provider.ContactsContract.Contacts.CONTENT_URI, proj, sel, selArgs,
                name + " COLLATE NOCASE ASC")) {
            while (q != null && q.moveToNext()) {
                if (ids.size() >= limit) { truncated = true; break; }
                ids.add(q.getLong(0));
                names.add(Caps.text(q.getString(1), Caps.MAX_FIELD, cut));
            }
        }
        // One query for all the numbers and one for all the emails, not one per contact.
        List<List<String>> numbers = detail(c, android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                android.provider.ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER, ids, cut);
        List<List<String>> emails = detail(c, android.provider.ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                android.provider.ContactsContract.CommonDataKinds.Email.CONTACT_ID,
                android.provider.ContactsContract.CommonDataKinds.Email.ADDRESS, ids, cut);
        JSONArray rows = new JSONArray();
        for (int i = 0; i < ids.size(); i++) {
            rows.put(new JSONObject().put("name", names.get(i))
                    .put("numbers", new JSONArray(numbers.get(i))).put("emails", new JSONArray(emails.get(i))));
        }
        return Caps.fit(rows, truncated || cut.cut);
    }

    private static List<List<String>> detail(Context c, Uri uri, String idCol, String valCol, List<Long> ids, Caps.Cut cut) {
        List<List<String>> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) out.add(new ArrayList<String>());
        if (ids.isEmpty()) return out;
        StringBuilder in = new StringBuilder(idCol + " IN (");
        String[] a = new String[ids.size()];
        for (int i = 0; i < a.length; i++) {
            in.append(i == 0 ? "?" : ",?");
            a[i] = String.valueOf(ids.get(i));
        }
        in.append(")");
        try (Cursor q = c.getContentResolver().query(uri, new String[]{idCol, valCol}, in.toString(), a, null)) {
            while (q != null && q.moveToNext()) {
                int at = ids.indexOf(q.getLong(0));
                String v = Caps.text(q.getString(1), Caps.MAX_FIELD, cut);
                if (at < 0 || v.isEmpty() || out.get(at).contains(v)) continue;
                if (out.get(at).size() < MAX_PER_CONTACT) out.get(at).add(v);
                else cut.cut = true;
            }
        }
        return out;
    }
}
