package com.omarqaterge.hermesmobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the camera app one file to write a photo into, and share targets a copy of an image from the lightbox
 * (no androidx FileProvider in this Gradle-less build). Only files in cache/camera named like "photo-<digits>.jpg"
 * and in cache/share named like "share-<digits>.<jpg|jpeg|png|webp|gif>" are served; the provider isn't exported,
 * the other app gets access through a one-off URI grant.
 */
public class CameraProvider extends ContentProvider {
    static final String AUTHORITY = "com.omarqaterge.hermesmobile.camera";
    static final String SHARED = "share-\\d{1,20}\\.(jpg|jpeg|png|webp|gif)";

    static File dir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "camera");
        d.mkdirs();
        return d;
    }

    static File shareDir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "share");
        d.mkdirs();
        return d;
    }

    static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTHORITY + "/" + f.getName());
    }

    File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name != null && name.matches("photo-\\d{1,20}\\.jpg")) return new File(dir(getContext()), name);
        if (name != null && name.matches(SHARED)) return new File(shareDir(getContext()), name);
        throw new FileNotFoundException("no such file");
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{f.getName(), f.length()});
        return c;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches(SHARED) || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        return "image/" + name.substring(name.lastIndexOf('.') + 1);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
