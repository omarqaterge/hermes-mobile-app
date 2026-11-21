package com.omarqaterge.hermesmobile;

/**
 * Which addresses "Share to Hermux" may read. Any app can send this app a share, and the app opens the address it is
 * given with its own rights, so a share naming the app's own private file (a file: address) or one of the app's own
 * content providers would make it read and attach its own data. Only content addresses of other apps pass. Plain
 * Java, tested on a JDK by tools/test_share_uri.sh.
 */
final class ShareUri {
    private ShareUri() {}

    /**
     * The parts of an already parsed address. The scheme must be exactly "content": that is the only spelling Android's
     * ContentResolver opens as a content address, so no other letter case is accepted. The authority, without an
     * optional "userId@" prefix, must be neither the app's own package name nor start with it and a dot, which covers
     * every provider the app declares now or later (they are all named after the package).
     */
    static boolean ok(String scheme, String authority, String ownPackage) {
        if (!"content".equals(scheme) || authority == null || ownPackage == null || ownPackage.isEmpty()) return false;
        String auth = authority.substring(authority.lastIndexOf('@') + 1); // Android's own rule for "10@media"
        if (auth.isEmpty()) return false;
        int n = ownPackage.length();
        boolean own = auth.length() >= n && sameName(auth, ownPackage, n) && (auth.length() == n || auth.charAt(n) == '.');
        return !own;
    }

    /**
     * Before API 35 (from it Android checks the sender itself): must the sender have handed over its own access to the
     * address (a URI grant)? Yes when the address's provider can't be seen (so nothing is known about it), and when
     * the provider asks for a read permission this app holds: then this app could open the address by itself, whoever
     * sent it. Otherwise no: the provider is open to every app, or only a grant can open it anyway.
     */
    static boolean needsGrant(boolean providerFound, String readPermission, boolean permissionHeld) {
        return !providerFound || (readPermission != null && permissionHeld);
    }

    /**
     * The first n characters of auth against name; only A-Z count as the same letter as a-z (equalsIgnoreCase and
     * toLowerCase also fold other characters onto ASCII, such as a long s onto s). Case is ignored so that no
     * spelling of the app's own name gets through, even if some Android version compared authorities loosely.
     */
    private static boolean sameName(String auth, String name, int n) {
        if (auth.length() < n || name.length() < n) return false;
        for (int i = 0; i < n; i++) {
            char a = auth.charAt(i), b = name.charAt(i);
            if (a >= 'A' && a <= 'Z') a = (char) (a + ('a' - 'A'));
            if (b >= 'A' && b <= 'Z') b = (char) (b + ('a' - 'A'));
            if (a != b) return false;
        }
        return true;
    }
}
