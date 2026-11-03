#!/bin/bash
# Tests which addresses the in-app update accepts (android/.../UpdateUrl.java) with a plain JDK: release files under
# the names of this repository, in any letter case, nothing looser. URLs are split with java.net.URI, which decodes the path as android.net.Uri does. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/UpdateUrl.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/UpdateUrlTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.net.URI;
public class UpdateUrlTest {
    static int fails = 0;
    static boolean ok(String url) {
        URI u = URI.create(url);
        return UpdateUrl.ok(u.getScheme(), u.getHost(), u.getPath());
    }
    static void check(boolean want, String url) {
        boolean got = ok(url);
        System.out.println((got == want ? "PASS  " : "FAIL  ") + (want ? "accepts " : "refuses ") + url);
        if (got != want) fails++;
    }
    public static void main(String[] a) {
        String apk = "/releases/download/v0.8.70/hermes-mobile.apk";
        // what GitHub's API returns: browser_download_url under the current name, before and after the rename
        check(true, "https://github.com/omarqaterge/hermes-mobile-app" + apk);
        check(true, "https://github.com/omarqaterge/hermux" + apk);
        check(true, "https://github.com/hermuxlab/hermux" + apk);
        // both release file names
        check(true, "https://github.com/omarqaterge/hermes-mobile-app/releases/download/v0.9.6/hermux.apk");
        check(true, "https://github.com/hermuxlab/hermux/releases/download/v0.9.6/hermux.apk");
        // GitHub ignores case in owner and repository names, and its API returns the canonical casing
        check(true, "https://github.com/HermuxLab/hermux" + apk);
        check(true, "https://github.com/hermuxlab/HERMUX" + apk);
        check(true, "https://github.com/omarqaterge/Hermux" + apk);
        check(true, "https://github.com/omarqaterge/HERMUX" + apk);
        check(true, "https://github.com/OmarQaterge/Hermes-Mobile-App" + apk);
        // only the names ignore case: the rest stays exact
        check(false, "https://github.com/hermuxlab/hermux/Releases/download/v0.9.6/hermux.apk");
        check(false, "https://github.com/hermuxlab/hermux/releases/DOWNLOAD/v0.9.6/hermux.apk");
        check(false, "https://github.com/hermuxlab/hermux/releases/download/v0.9.6/hermux.APK");
        check(false, "HTTPS://github.com/hermuxlab/hermux" + apk);
        // characters that Unicode case folding would turn into a letter of a name: long s, dotless i, dotted I, Kelvin
        check(false, "https://github.com/omarqaterge/herme%C5%BF-mobile-app" + apk);
        check(false, "https://github.com/omarqaterge/hermes-mob%C4%B1le-app" + apk);
        check(false, "https://github.com/omarqaterge/hermes-mob%C4%B0le-app" + apk);
        check(false, "https://github.com/hermu%E2%84%AAlab/hermux" + apk);
        // lookalike names
        for (String repo : new String[] {"hermux-evil", "hermuxx", "hermu", "hermux.git", "hermes-mobile-app-evil",
                "hermes-mobile-appx", "hermes-mobile", "xhermux", "hermes-mobile-app/hermux", "hermux/hermux"})
            check(false, "https://github.com/omarqaterge/" + repo + apk);
        for (String name : new String[] {"hermuxlab2/hermux", "hermuxlabs/hermux", "xhermuxlab/hermux", "hermux-lab/hermux", "hermuxlab-evil/hermux",
                "HermuxLab2/hermux", "hermuxlab/hermuxx", "hermuxlab/hermux-evil", "hermuxlab/hermes-mobile-app", "hermux/hermux", "hermuxlab/hermuxlab",
                "someone/hermuxlab/hermux", "hermuxlab//hermux", "/hermuxlab/hermux", "hermuxlab/hermux/x"})
            check(false, "https://github.com/" + name + apk);
        check(false, "https://github.com/hermuxlab" + apk);
        // another owner
        check(false, "https://github.com/someone/hermux" + apk);
        check(false, "https://github.com/someone/hermes-mobile-app" + apk);
        check(false, "https://github.com/omarqaterge-evil/hermux" + apk);
        check(false, "https://github.com/xomarqaterge/hermux" + apk);
        check(false, "https://github.com/someone/omarqaterge/hermux" + apk);
        // not https
        check(false, "http://github.com/omarqaterge/hermux" + apk);
        check(false, "ftp://github.com/omarqaterge/hermux" + apk);
        // another host
        for (String host : new String[] {"evil.com", "github.com.evil.com", "evilgithub.com", "www.github.com", "api.github.com",
                "raw.githubusercontent.com", "GitHub.com"})
            check(false, "https://" + host + "/omarqaterge/hermux" + apk);
        check(false, "https://github.com@evil.com/omarqaterge/hermux" + apk);
        // not an app file in the releases folder
        check(false, "https://github.com/omarqaterge/hermux/releases/download/v0.8.70/hermes-mobile.zip");
        check(false, "https://github.com/omarqaterge/hermux/releases/download/v0.8.70/hermes-mobile.apk.txt");
        check(false, "https://github.com/omarqaterge/hermux/raw/main/hermes-mobile.apk");
        check(false, "https://github.com/omarqaterge/hermux/releases/hermes-mobile.apk");
        // walking out of the folder, plain and encoded
        check(false, "https://github.com/omarqaterge/hermux/releases/download/../../../evil/x/hermes-mobile.apk");
        check(false, "https://github.com/omarqaterge/hermux/releases/download/%2e%2e/%2e%2e/%2e%2e/evil/x/hermes-mobile.apk");
        // nothing at all
        boolean nulls = !UpdateUrl.ok(null, null, null) && !UpdateUrl.ok("https", "github.com", null) && !UpdateUrl.ok("https", null, "/omarqaterge/hermux" + apk);
        System.out.println((nulls ? "PASS  " : "FAIL  ") + "missing parts are refused");
        if (!nulls) fails++;

        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.UpdateUrlTest
