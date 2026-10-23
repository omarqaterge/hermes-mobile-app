package com.omarqaterge.hermesmobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;

import moe.shizuku.api.BinderContainer;

/**
 * Tells the setup flow whether Shizuku is running, without the Shizuku library and without asking Shizuku for permission.
 * When Shizuku's server starts, and whenever this app's process starts while it runs, the server calls "sendBinder" on
 * the provider "&lt;package&gt;.shizuku" of every app that lists moe.shizuku.manager.permission.API_V23 in its manifest
 * (listed, not granted: the user is never asked). We only keep the binder and ping it; we never use it. A dead binder
 * (Shizuku stopped) pings false. The provider permission is one only the shell/system holds, so other apps can't call it.
 */
public class ShizukuProvider extends ContentProvider {
    private static final String EXTRA_BINDER = "moe.shizuku.privileged.api.intent.extra.BINDER";
    private static volatile IBinder binder;

    /** True while the binder Shizuku's server handed us is alive. */
    static boolean running() {
        IBinder b = binder;
        return b != null && b.pingBinder();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if (!"sendBinder".equals(method) || extras == null) return null;
        extras.setClassLoader(BinderContainer.class.getClassLoader());
        try {
            BinderContainer c = extras.getParcelable(EXTRA_BINDER);
            if (c != null && c.binder != null) binder = c.binder;
        } catch (Exception ignored) {
            return null;
        }
        return new Bundle();
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
