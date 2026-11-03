package com.omarqaterge.hermesmobile;

/**
 * Which addresses count as this project's release files, the only ones the in-app update downloads and installs.
 * GitHub hands out release links under the repository's current name, so its names are accepted: today's, the one it
 * is moving to, and the organization reserved for a possible later move (docs/status/repo-rename.md). GitHub ignores
 * case in owner and repository names, so this does too, for those and nothing else. Plain Java, tested on a JDK by
 * tools/test_update_url.sh.
 */
final class UpdateUrl {
    private static final String[] REPOS = {
        "/omarqaterge/hermes-mobile-app",
        "/omarqaterge/hermux",
        "/hermuxlab/hermux",
    };
    private static final String RELEASES = "/releases/download/";

    private UpdateUrl() {}

    /** The parts of an already parsed URL; path is the decoded one, so an encoded ".." is seen too. */
    static boolean ok(String scheme, String host, String path) {
        if (!"https".equals(scheme) || !"github.com".equals(host) || path == null) return false;
        if (!path.endsWith(".apk") || path.contains("..")) return false;
        for (String repo : REPOS) if (startsWithName(path, repo) && path.startsWith(RELEASES, repo.length())) return true;
        return false;
    }

    /**
     * Only A-Z count as the same letter as a-z. equalsIgnoreCase, toLowerCase and Android's case-insensitive regex also
     * fold other characters onto ASCII (a long s onto s, a dotless i onto i), and the path here is the decoded one.
     */
    private static boolean startsWithName(String path, String name) {
        if (path.length() < name.length()) return false;
        for (int i = 0; i < name.length(); i++) {
            char c = path.charAt(i);
            if (c >= 'A' && c <= 'Z') c = (char) (c + ('a' - 'A'));
            if (c != name.charAt(i)) return false;
        }
        return true;
    }
}
