package com.omarqaterge.hermesmobile;

/**
 * Which addresses count as this project's release files, the only ones the in-app update downloads and installs.
 * GitHub hands out release links under the repository's current name, so both of its names are accepted, exactly
 * (docs/status/repo-rename.md). Plain Java, tested on a JDK by tools/test_update_url.sh.
 */
final class UpdateUrl {
    private static final String[] RELEASES = {
        "/omarqaterge/hermes-mobile-app/releases/download/",
        "/omarqaterge/hermux/releases/download/",
    };

    private UpdateUrl() {}

    /** The parts of an already parsed URL; path is the decoded one, so an encoded ".." is seen too. */
    static boolean ok(String scheme, String host, String path) {
        if (!"https".equals(scheme) || !"github.com".equals(host) || path == null) return false;
        if (!path.endsWith(".apk") || path.contains("..")) return false;
        for (String prefix : RELEASES) if (path.startsWith(prefix)) return true;
        return false;
    }
}
