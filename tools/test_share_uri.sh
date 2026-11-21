#!/bin/bash
# Tests which addresses "Share to Hermux" may read (android/.../ShareUri.java) with a plain JDK: content addresses of
# other apps only; never a file, the app's own providers or anything else. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/ShareUri.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/ShareUriTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class ShareUriTest {
    static int fails = 0;
    static final String ME = "com.omarqaterge.hermesmobile";
    static void check(boolean want, String scheme, String authority) {
        boolean got = ShareUri.ok(scheme, authority, ME);
        System.out.println((got == want ? "PASS  " : "FAIL  ") + (want ? "accepts " : "refuses ") + scheme + "://" + authority);
        if (got != want) fails++;
    }
    public static void main(String[] a) {
        // other apps' providers
        for (String auth : new String[] {"com.android.providers.media.documents", "media", "com.termux.documents", "10@media",
                "com.android.externalstorage.documents", "0@com.android.providers.downloads.documents"})
            check(true, "content", auth);
        // lookalikes of the app's name are other apps
        check(true, "content", "com.omarqaterge.hermesmobilex.files");
        check(true, "content", "com.omarqaterge.hermesmobile2");
        check(true, "content", "com.omarqaterge.hermesmobil");
        check(true, "content", "com.omarqaterge.hermes");
        check(true, "content", "xcom.omarqaterge.hermesmobile.camera");
        check(true, "content", "evil.com.omarqaterge.hermesmobile");
        check(true, "content", "10@com.omarqaterge.hermesmobilex");
        // the app's own providers, now and later, with or without a user id, in any letter case
        check(false, "content", ME);
        check(false, "content", ME + ".camera");
        check(false, "content", ME + ".shizuku");
        check(false, "content", ME + ".anything.later");
        check(false, "content", "0@" + ME + ".camera");
        check(false, "content", "10@" + ME);
        check(false, "content", "1@2@" + ME + ".camera");
        check(false, "content", "COM.OMARQATERGE.HERMESMOBILE.CAMERA");
        check(false, "content", "Com.OmarQaterge.HermesMobile");
        // another scheme: file reads the app's private files, the rest is not a share of a file
        for (String scheme : new String[] {"file", "http", "https", "android.resource", "data", "ftp", "intent", "javascript", "FILE", "File"})
            check(false, scheme, "media");
        check(false, "file", "");
        check(false, "file", null);
        // schemes are matched exactly: ContentResolver only opens a lower-case "content" as a content address
        check(false, "CONTENT", "media");
        check(false, "Content", "media");
        check(false, "content ", "media");
        check(false, " content", "media");
        check(false, "contеnt", "media"); // Cyrillic e
        check(false, "", "media");
        check(false, null, "media");
        // no authority
        check(false, "content", "");
        check(false, "content", null);
        check(false, "content", "10@");
        check(false, "content", "@");
        // no own package known: nothing passes
        boolean noOwn = !ShareUri.ok("content", "media", null) && !ShareUri.ok("content", "media", "");
        System.out.println((noOwn ? "PASS  " : "FAIL  ") + "refuses everything when the app's own name is unknown");
        if (!noOwn) fails++;

        // before API 35: when must the sender have handed over its own access (a URI grant)?
        boolean[] grant = {
            ShareUri.needsGrant(false, null, false),                              // a provider that can't be seen
            ShareUri.needsGrant(false, "android.permission.READ_CONTACTS", true),
            ShareUri.needsGrant(true, "android.permission.READ_CONTACTS", true),  // this app could open it by itself
            !ShareUri.needsGrant(true, "android.permission.READ_CONTACTS", false), // only a grant opens it anyway
            !ShareUri.needsGrant(true, null, false),                              // open to every app
            !ShareUri.needsGrant(true, null, true),
        };
        for (int i = 0; i < grant.length; i++) {
            System.out.println((grant[i] ? "PASS  " : "FAIL  ") + "needsGrant case " + (i + 1));
            if (!grant[i]) fails++;
        }

        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.ShareUriTest
