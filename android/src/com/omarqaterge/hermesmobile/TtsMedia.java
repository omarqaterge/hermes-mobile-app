package com.omarqaterge.hermesmobile;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.SystemClock;

/**
 * The "Reading aloud" media card for Voice: a framework MediaSession (so headset buttons, the lock screen and the
 * control centre's player reach it) plus a Notification.MediaStyle notification with ⏪5 ⏯ ⏩5 ✕. No androidx: this APK is
 * built without Gradle. Buttons go to HermesService (ACTION_TTS, extra "cmd") and session callbacks straight to
 * Voice.control(), which acts on the instance reading now. Native on purpose: the page is frozen ~1 min after the app
 * leaves the screen, so controls that went through it would stop working.
 * Main thread only (the session is created there, so its callbacks arrive there too).
 */
final class TtsMedia {
    static final String CH_PLAYBACK = "playback";
    static final String ACTION_TTS = "com.omarqaterge.hermesmobile.TTS";
    static final int NOTIFICATION_ID = 7;

    private static final String ACT_REW5 = "com.omarqaterge.hermesmobile.REW5", ACT_FF5 = "com.omarqaterge.hermesmobile.FF5";
    private static MediaSession session;
    private static Context app;

    private TtsMedia() { }

    /** Shows or updates the card. playing = false shows ▶ (paused). */
    static void show(Context ctx, String title, String chat, boolean playing, long positionMs, long durationMs) {
        app = ctx.getApplicationContext();
        if (session == null) {
            session = new MediaSession(app, "hermes-tts");
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { Voice.control("play"); }
                @Override public void onPause() { Voice.control("pause"); }
                // headsets send skip next / previous: same 5 s jump as the card's buttons (not advertised as actions, so the
                // shade draws our two custom 5 s buttons instead of prev / next)
                @Override public void onSkipToNext() { Voice.control("ff"); }
                @Override public void onSkipToPrevious() { Voice.control("rew"); }
                @Override public void onFastForward() { Voice.control("ff"); }
                @Override public void onRewind() { Voice.control("rew"); }
                @Override public void onSeekTo(long pos) { Voice.control("seek:" + pos); }
                @Override public void onCustomAction(String action, android.os.Bundle extras) {
                    if (ACT_REW5.equals(action)) Voice.control("rew");
                    else if (ACT_FF5.equals(action)) Voice.control("ff");
                }
                @Override public void onStop() { Voice.control("stop"); }
            });
        }
        String name = title == null || title.trim().isEmpty() ? "Reading aloud" : title.trim();
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, name)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Hermes")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(1, durationMs))
                .build());
        // position + speed + the time it was true at: the system extrapolates the bar itself, no timer on our side
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP)
                .addCustomAction(new PlaybackState.CustomAction.Builder(ACT_REW5, "Back 5 s", android.R.drawable.ic_media_rew).build())
                .addCustomAction(new PlaybackState.CustomAction.Builder(ACT_FF5, "Forward 5 s", android.R.drawable.ic_media_ff).build())
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        Math.max(0, Math.min(positionMs, durationMs)), playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .build());
        session.setActive(true);

        Intent open = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (chat != null && !chat.isEmpty()) open.putExtra("session", chat);
        PendingIntent content = PendingIntent.getActivity(app, 70, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = new Notification.Builder(app, CH_PLAYBACK)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setContentTitle(name)
                .setContentText(playing ? "Hermes is reading aloud" : "Paused")
                .setVisibility(Notification.VISIBILITY_PUBLIC) // controls on the lock screen
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .setOngoing(playing) // paused: can be swiped away, which stops the reading
                .setContentIntent(content)
                .setDeleteIntent(command("stop", 75))
                .addAction(action(android.R.drawable.ic_media_rew, "Back 5 s", command("rew", 71)))
                .addAction(playing ? action(android.R.drawable.ic_media_pause, "Pause", command("pause", 72))
                        : action(android.R.drawable.ic_media_play, "Play", command("play", 72)))
                .addAction(action(android.R.drawable.ic_media_ff, "Forward 5 s", command("ff", 73)))
                .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", command("stop", 74)))
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        try {
            app.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, b.build());
        } catch (Exception ignored) {
            // notifications not allowed: the session alone still takes media buttons
        }
    }

    /** Removes the card and releases the session (reading ended, stopped, or the reader went away). */
    static void hide() {
        if (app != null) {
            try {
                app.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
            } catch (Exception ignored) { }
        }
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
    }

    private static Notification.Action action(int icon, String label, PendingIntent pi) {
        return new Notification.Action.Builder(Icon.createWithResource(app, icon), label, pi).build();
    }

    private static PendingIntent command(String cmd, int req) {
        Intent i = new Intent(app, HermesService.class).setAction(ACTION_TTS).putExtra("cmd", cmd);
        return PendingIntent.getService(app, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
