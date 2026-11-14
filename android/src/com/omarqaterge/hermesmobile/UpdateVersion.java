package com.omarqaterge.hermesmobile;

/**
 * Whether a downloaded update may replace the installed app, from both builds' version codes and names. Android
 * installs a same-or-higher code over the installed one and refuses a lower one, so a newer version with the same
 * code (a hand-made test build took the next release's code) still updates. Plain Java, tested on a JDK by
 * tools/test_update_version.sh.
 */
final class UpdateVersion {
    private UpdateVersion() {}

    /** Null when the update can go ahead, else the message to show. */
    static String refusal(long gotCode, String gotName, long mineCode, String mineName) {
        boolean newerName = newer(gotName, mineName);
        if (gotCode > mineCode) return null;
        if (gotCode == mineCode && newerName) return null;
        if (!newerName) return "You already have this version.";
        return "Can't update to " + gotName + ": this copy of Hermux has a higher build number (it is probably a test build). "
            + "Uninstall it and install " + gotName + " from the release page; uninstalling deletes the app's data.";
    }

    /** "0.9.8" newer than "0.9.7": dotted numbers compared part by part, a leading v and any "-…"/"+…" ignored. */
    static boolean newer(String a, String b) {
        long[] x = parts(a), y = parts(b);
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            long d = (i < x.length ? x[i] : 0) - (i < y.length ? y[i] : 0);
            if (d != 0) return d > 0;
        }
        return false;
    }

    private static long[] parts(String v) {
        if (v == null) return new long[0];
        String s = v.trim().replaceFirst("^[vV]", "").replaceFirst("[-+].*$", "");
        String[] p = s.split("\\.");
        long[] out = new long[p.length];
        for (int i = 0; i < p.length; i++) {
            try {
                out[i] = Long.parseLong(p[i]);
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }
}
