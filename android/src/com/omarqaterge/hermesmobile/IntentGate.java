package com.omarqaterge.hermesmobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Keeps other apps from using the extras that only this app's own notifications and shortcuts are meant to send.
 * MainActivity is exported (launcher, assistant, Share to Hermux), so any app can start it with extras that open a
 * chosen chat with text in the box ("session", "draft"), start the update flow ("updateUrl"), clear the Done chip,
 * open the background-app viewer or ask for the unlock screen. Every intent this app builds for MainActivity goes
 * through {@link #mark}, which adds a random secret kept in the app's private preferences ("intent_nonce"); on arrival
 * {@link #strip} removes those extras from an intent that does not carry it.
 * Known limit: the "shortcut" extra, the share intents and the assist intents are not gated (the launcher's static
 * shortcuts and the system's assist gesture can't carry a secret, and sharing is meant for other apps), so another
 * app can still open a new chat or start Live mode that way; Live mode still needs the unlocked phone.
 * Notifications posted and the "last chat" shortcut made by an older version carry no secret: tapping one opens the
 * app without opening its chat until it is posted or made again.
 */
final class IntentGate {
    /** The extra that carries the secret on the app's own intents. */
    static final String EXTRA = "hm_gate";
    private static final String PREF = "intent_nonce";

    private IntentGate() {}

    /** The per-install secret: 24 random bytes as hex, made once and kept in the "hermes" preferences. */
    static synchronized String nonce(Context c) {
        SharedPreferences p = c.getSharedPreferences("hermes", Context.MODE_PRIVATE);
        String n = p.getString(PREF, "");
        if (n.length() == 48) return n;
        byte[] b = new byte[24];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder(48);
        for (byte x : b) s.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        n = s.toString();
        p.edit().putString(PREF, n).commit(); // not apply(): a secret lost with the process would orphan posted notifications
        return n;
    }

    /** Puts the secret on an intent this app builds for MainActivity; never use it on an intent for another app. */
    static Intent mark(Context c, Intent i) {
        return i.putExtra(EXTRA, nonce(c));
    }

    /** Called with every intent MainActivity receives, before any extra is read: without the secret, the gated extras go. */
    static void strip(Context c, Intent i) {
        if (i == null) return;
        try {
            String got = i.getStringExtra(EXTRA);
            boolean ours = got != null && java.security.MessageDigest.isEqual(
                    got.getBytes(java.nio.charset.StandardCharsets.UTF_8), nonce(c).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            if (!ours) {
                i.removeExtra("session");
                i.removeExtra("draft");
                i.removeExtra("clearDone");
                i.removeExtra("updateUrl");
                i.removeExtra(MainActivity.EXTRA_BG_VIEW);
                i.removeExtra(MainActivity.EXTRA_UNLOCK);
            }
            i.removeExtra(EXTRA); // not kept around: nothing else reads it
        } catch (RuntimeException e) {
            // a malformed extras bundle (it can't be unparcelled): treated as carrying no secret, and dropped whole
            try {
                i.replaceExtras((android.os.Bundle) null);
            } catch (RuntimeException ignored) {
            }
        }
    }
}
