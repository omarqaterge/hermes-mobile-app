package com.omarqaterge.hermesmobile.phonedata;

import org.json.JSONArray;

/** What one reader returns: the rows, and whether a cap cut anything off. */
public final class Result {
    public final JSONArray items;
    public final boolean truncated;

    public Result(JSONArray items, boolean truncated) {
        this.items = items;
        this.truncated = truncated;
    }
}
