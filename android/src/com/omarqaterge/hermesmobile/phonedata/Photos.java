package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.database.Cursor;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Reads the newest photos' metadata (docs/status/phone-data.md): time, size and dimensions only. It projects no name,
 * path, URI, bucket, EXIF or GPS column and never opens a file. Takes only {@code limit}.
 */
public final class Photos {
    private Photos() {}

    public static Result read(Context c, JSONObject args) {
        if (args != null) {
            for (Iterator<String> it = args.keys(); it.hasNext(); ) {
                if (!"limit".equals(it.next())) throw new IllegalArgumentException("unknown argument");
            }
        }
        int limit = Caps.rows(args);
        JSONArray rows = new JSONArray();
        boolean truncated = false;
        String[] projection = {
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
        };
        // No LIMIT in the sort order: the loop stops at the limit instead. Plain columns, newest date taken first, then
        // date added; rows with no date taken sort after dated ones. A row's time is the date taken, else date added.
        Cursor cur = c.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection,
            null, null, MediaStore.Images.Media.DATE_TAKEN + " DESC, " + MediaStore.Images.Media.DATE_ADDED + " DESC");
        if (cur == null) return new Result(rows, false);
        try {
            while (cur.moveToNext()) {
                if (rows.length() >= limit) {
                    truncated = true;
                    break;
                }
                long taken = cur.isNull(0) ? 0 : cur.getLong(0);
                long added = cur.isNull(1) ? 0 : cur.getLong(1) * 1000L;
                JSONObject row = new JSONObject();
                row.put("time_ms", taken > 0 ? taken : added);
                row.put("size_bytes", cur.isNull(2) ? 0 : cur.getLong(2));
                row.put("width", cur.isNull(3) ? 0 : cur.getInt(3));
                row.put("height", cur.isNull(4) ? 0 : cur.getInt(4));
                rows.put(row);
            }
        } catch (JSONException e) {
            throw new IllegalStateException("row");
        } finally {
            cur.close();
        }
        return new Result(rows, truncated);
    }
}
