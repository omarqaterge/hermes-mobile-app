package com.omarqaterge.hermesmobile;

import android.content.Context;

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
 * live here in the app, never in the plugin, because the agent can edit anything in Termux. Off until the feature's
 * final pull request sets {@link #READY}.
 */
final class PhoneData {
    private PhoneData() {}

    /** False: the Settings section stays hidden and every read is refused with reason {@code not_ready}. */
    static final boolean READY = false;

    static final String[] KINDS = {"contacts", "calendar", "calls", "sms", "location", "photos"};

    static boolean isKind(String kind) {
        for (String k : KINDS) if (k.equals(kind)) return true;
        return false;
    }

    /** May this kind be read now: READY, master on, the kind's switch on and its Android permission held. */
    static boolean allowed(Context c, String kind) {
        return false;
    }

    /** Booleans only, never data: {@code {"ready":false,"master":false,"kinds":{"contacts":false,...}}}. */
    static JSONObject status(Context c) throws Exception {
        JSONObject kinds = new JSONObject();
        for (String k : KINDS) kinds.put(k, false);
        return new JSONObject().put("ready", READY).put("master", false).put("kinds", kinds);
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
