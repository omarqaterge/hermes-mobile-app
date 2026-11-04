package com.omarqaterge.hermesmobile.phonedata;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/** Reads phone data of this kind; the row shape is in docs/status/phone-data.md. Not built yet: returns nothing. */
public final class Photos {
    private Photos() {}

    public static Result read(Context c, JSONObject args) {
        return new Result(new JSONArray(), false);
    }
}
