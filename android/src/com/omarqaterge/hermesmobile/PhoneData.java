package com.omarqaterge.hermesmobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import com.omarqaterge.hermesmobile.phonedata.CallLog;
import com.omarqaterge.hermesmobile.phonedata.Calendar;
import com.omarqaterge.hermesmobile.phonedata.Contacts;
import com.omarqaterge.hermesmobile.phonedata.Location;
import com.omarqaterge.hermesmobile.phonedata.Photos;
import com.omarqaterge.hermesmobile.phonedata.Result;
import com.omarqaterge.hermesmobile.phonedata.Sms;

import org.json.JSONObject;

/**
 * Phone data for the agent: the switches and the read dispatch (docs/decisions/phone-data-read-only.md). The switches
 * live here in the app, never in the plugin, because the agent can edit anything in Termux. Launched 2026-11-05: every
 * switch still starts off.
 */
final class PhoneData {
    private PhoneData() {}

    /** The launch switch, true since 2026-11-05. Set to false only to pull the feature from a build: the Settings section then
     *  stays hidden and every read is refused with reason {@code not_ready}. (An app too old for the plugin, or the plugin too
     *  old for the app, still answers {@code not_ready} or 404 and the tool says it isn't available.) */
    static final boolean READY = true;

    static final String[] KINDS = {"contacts", "calendar", "calls", "sms", "location", "photos"};

    static boolean isKind(String kind) {
        for (String k : KINDS) if (k.equals(kind)) return true;
        return false;
    }

    private static final String MASTER = "master";

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("hm", Context.MODE_PRIVATE);
    }

    /** Is this the master switch or a kind: the names {@link #setSwitch} takes. */
    static boolean isSwitch(String name) {
        return MASTER.equals(name) || isKind(name);
    }

    /** The master switch ({@code master}) or a kind's own switch. Off unless the user turned it on. */
    static boolean switchOn(Context c, String name) {
        return isSwitch(name) && prefs(c).getBoolean("phoneData." + name, false);
    }

    /** Stores a switch. Turning on is only called after the screen lock was confirmed (MainActivity.phoneDataSet). */
    static void setSwitch(Context c, String name, boolean on) {
        if (!isSwitch(name)) return;
        // a turn-on or an explicit off ends "Android removed this permission"
        prefs(c).edit().putBoolean("phoneData." + name, on).remove("phoneData.removed." + name).apply();
    }

    /** Android took this kind's permission away while its switch was on: the switch was cleared, and stays off until the
     *  user turns it on again with the screen lock (a later grant in Android's settings or by {@code pm grant} can't revive it). */
    static boolean removed(Context c, String kind) {
        return isKind(kind) && prefs(c).getBoolean("phoneData.removed." + kind, false);
    }

    /** Was this kind's Android permission dialog ever answered (so a refusal with no rationale means "won't ask again"). */
    static boolean asked(Context c, String kind) {
        return isKind(kind) && prefs(c).getBoolean("phoneData.asked." + kind, false);
    }

    static void markAsked(Context c, String kind) {
        if (isKind(kind)) prefs(c).edit().putBoolean("phoneData.asked." + kind, true).apply();
    }

    /** A kind whose switch is on but whose permission is gone: clear the switch and remember {@code removed}. */
    private static void sweep(Context c, String kind) {
        if (switchOn(c, kind) && !permitted(c, kind)) {
            prefs(c).edit().putBoolean("phoneData." + kind, false).putBoolean("phoneData.removed." + kind, true).apply();
        }
    }

    /** The Android permission this kind needs: photos use READ_MEDIA_IMAGES on Android 13+ and READ_EXTERNAL_STORAGE before. */
    static String permission(String kind) {
        switch (kind) {
            case "contacts": return "android.permission.READ_CONTACTS";
            case "calendar": return "android.permission.READ_CALENDAR";
            case "calls": return "android.permission.READ_CALL_LOG";
            case "sms": return "android.permission.READ_SMS";
            case "location": return "android.permission.ACCESS_COARSE_LOCATION";
            case "photos":
                return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_IMAGES" : "android.permission.READ_EXTERNAL_STORAGE";
            default: return null;
        }
    }

    /** Does the app hold this kind's Android permission now. */
    static boolean permitted(Context c, String kind) {
        String p = permission(kind);
        return p != null && c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    /** May this kind be read now: READY, master on, the kind's switch on and its Android permission held. A kind whose
     *  permission is gone is switched off (and marked removed) here, whoever asks first. */
    static boolean allowed(Context c, String kind) {
        if (!isKind(kind)) return false;
        sweep(c, kind);
        return READY && switchOn(c, MASTER) && switchOn(c, kind) && permitted(c, kind);
    }

    /** Booleans only, never data: {@code {"ready":false,"master":false,"kinds":{"contacts":false,...}}}. */
    static JSONObject status(Context c) throws Exception {
        JSONObject kinds = new JSONObject();
        for (String k : KINDS) kinds.put(k, allowed(c, k));
        return new JSONObject().put("ready", READY).put("master", READY && switchOn(c, MASTER)).put("kinds", kinds);
    }

    /** What Settings shows (phoneDataState): {@link #status} plus {@code switches} (each stored switch), {@code removed}
     *  (kinds whose permission Android took away), {@code perms} (kind to Android permission held) and {@code secure}
     *  (the phone has a screen lock). Booleans only. */
    static String stateJson(Context c) {
        try {
            JSONObject st = status(c); // sweeps first
            JSONObject sw = new JSONObject().put("master", switchOn(c, MASTER));
            JSONObject rem = new JSONObject();
            JSONObject perms = new JSONObject();
            for (String k : KINDS) {
                sw.put(k, switchOn(c, k));
                rem.put(k, removed(c, k));
                perms.put(k, permitted(c, k));
            }
            return st.put("switches", sw).put("removed", rem).put("perms", perms).put("secure", ApprovalLock.secure(c)).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Runs one reader. Callers check {@link #allowed} and the grant first; the readers apply the caps themselves. */
    static Result read(Context c, String kind, JSONObject args) throws Exception {
        switch (kind) {
            case "contacts": return Contacts.read(c, args);
            case "calendar": return Calendar.read(c, args);
            case "calls": return CallLog.read(c, args);
            case "sms": return Sms.read(c, args);
            case "location": return Location.read(c, args);
            case "photos": return Photos.read(c, args);
            default: throw new IllegalArgumentException("unknown kind");
        }
    }
}
