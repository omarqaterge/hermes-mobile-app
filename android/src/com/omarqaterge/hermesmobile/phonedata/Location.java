package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;
import android.location.LocationManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads the phone's last known coarse position (docs/status/phone-data.md): one row, or none when there is no fix.
 * Never asks for updates, starts GPS or wakes anything; the coordinates are rounded to 2 decimals (about 1 km) so a
 * precise fix from the passive provider can't leak. Takes no arguments.
 */
public final class Location {
    private Location() {}

    public static Result read(Context c, JSONObject args) {
        if (args != null && args.length() > 0) throw new IllegalArgumentException("location takes no arguments");
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        JSONArray rows = new JSONArray();
        if (lm == null) return new Result(rows, false);
        android.location.Location fix = last(lm, LocationManager.NETWORK_PROVIDER);
        if (fix == null) {
            // Android 8-10 want the fine permission for the passive provider, which we don't hold: that is no fix, not
            // a failure. The network call above still throws when the coarse permission is gone.
            try {
                fix = last(lm, LocationManager.PASSIVE_PROVIDER);
            } catch (SecurityException e) {
                fix = null;
            }
        }
        if (fix == null) return new Result(rows, false);
        try {
            JSONObject row = new JSONObject();
            row.put("lat", round2(fix.getLatitude()));
            row.put("lon", round2(fix.getLongitude()));
            row.put("accuracy_m", fix.hasAccuracy() ? Math.max(1000L, Math.round(fix.getAccuracy())) : 1000L);
            row.put("time_ms", fix.getTime());
            rows.put(row);
        } catch (JSONException e) {
            throw new IllegalStateException("row");
        }
        return new Result(rows, false);
    }

    /** The provider's last fix or null; a provider this phone lacks counts as no fix. A missing permission still throws. */
    private static android.location.Location last(LocationManager lm, String provider) {
        try {
            return lm.getLastKnownLocation(provider);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
