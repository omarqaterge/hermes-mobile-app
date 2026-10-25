package com.omarqaterge.hermesmobile;

import java.util.Locale;

/**
 * "Share to Hermes": which shared URIs the app may open. The sharing app picks the URI, and this app opens it with its
 * own permissions, so a file:// path (any file the app itself can read, e.g. its shared_prefs with the event key) or a
 * content:// URI of this app's own providers would hand the sharer's choice of our private files to the chat. Only
 * other apps' content:// URIs are opened (they come with that app's read grant). Plain Java, so tools/test_share_source.sh
 * can run it with a JDK.
 */
final class ShareSource {
    private ShareSource() {
    }

    static boolean ok(String scheme, String authority, String ownPackage) {
        if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals("content")) return false;
        if (authority == null || authority.isEmpty()) return false;
        // ContentResolver also accepts "<user>@<authority>" (another user's provider): compare the authority itself.
        String a = authority.replaceFirst("^[0-9]+@", "").toLowerCase(Locale.ROOT);
        String own = ownPackage.toLowerCase(Locale.ROOT);
        return !(a.equals(own) || a.startsWith(own + "."));
    }
}
