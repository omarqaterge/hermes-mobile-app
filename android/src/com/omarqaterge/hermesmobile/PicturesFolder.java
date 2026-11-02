package com.omarqaterge.hermesmobile;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

/**
 * Where Save puts pictures: Pictures/Hermux (until 2026-11 it was Pictures/Hermes). Saving needs API 29 (MediaStore's
 * RELATIVE_PATH), so pictures in the old folder exist only on Android 10 and newer.
 *
 * {@link #moveOld} moves the pictures this app saved itself (OWNER_PACKAGE_NAME is this package) from the old folder to
 * the new one, by updating each row's RELATIVE_PATH: MediaStore renames the file on the same volume, so nothing is
 * copied and nothing can end up twice. The app holds no storage permission, so it can't see or touch anyone else's
 * files there. A picture whose move fails (an owner lost after a reinstall, say) stays where it was.
 * Android 11+ only: there MediaStore gives a moved file a free name ("x (1).jpg") when the target has one already;
 * Android 10's move may not, and could overwrite a picture, so on Android 10 old pictures stay in Pictures/Hermes.
 * Bounded: one query per process start, at most {@link #MAX_TRIES} starts, then never again.
 */
final class PicturesFolder {
    static final String NAME = "Hermux";
    static final String OLD_NAME = "Hermes";
    static final int MAX_TRIES = 3;
    static final int MOVE_SDK = 30;
    private static boolean ran; // once per process: an activity recreated (rotation, theme) doesn't count as a start

    private PicturesFolder() {
    }

    /** RELATIVE_PATH for new saves. */
    static String relativePath() {
        return Environment.DIRECTORY_PICTURES + "/" + NAME;
    }

    /** Once per start on a background thread, until a pass moved everything (or found nothing) or MAX_TRIES ran. */
    static void moveOld(Context c) {
        if (Build.VERSION.SDK_INT < 30 || ran) return; // nothing was saved before Android 10; Android 10 keeps them
        ran = true;
        SharedPreferences p = c.getSharedPreferences("hm", Context.MODE_PRIVATE);
        int tries = p.getInt("picturesMoveTries", 0);
        if (tries >= MAX_TRIES) return;
        Context app = c.getApplicationContext();
        new Thread(() -> {
            int left = moveNow(app);
            // left < 0: the query itself failed; count it as a try too, so a phone where it always fails stops asking
            p.edit().putInt("picturesMoveTries", left == 0 ? MAX_TRIES : tries + 1).apply();
        }, "hm-pictures").start();
    }

    /** Moves what it can; returns how many of the app's pictures are still in the old folder (-1: couldn't look). */
    static int moveNow(Context c) {
        if (Build.VERSION.SDK_INT < 30) return 0; // MOVE_SDK, written out for lint
        ContentResolver cr = c.getContentResolver();
        Uri images = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String old = Environment.DIRECTORY_PICTURES + "/" + OLD_NAME;
        String sel = MediaStore.MediaColumns.RELATIVE_PATH + " IN (?, ?) AND " + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ?";
        String[] args = { old + "/", old, c.getPackageName() };
        // All ids first: a moved row stops matching, which would shift a cursor that is still being read.
        java.util.ArrayList<Long> ids = new java.util.ArrayList<>();
        try (Cursor q = cr.query(images, new String[] { MediaStore.MediaColumns._ID }, sel, args, null)) {
            if (q == null) return -1;
            while (q.moveToNext()) ids.add(q.getLong(0));
        } catch (Exception e) {
            return -1;
        }
        int left = 0;
        for (long id : ids) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath() + "/");
            try {
                if (cr.update(ContentUris.withAppendedId(images, id), v, null, null) != 1) left++;
            } catch (Exception e) {
                left++; // left where it was
            }
        }
        return left;
    }
}
