#!/bin/bash
# Tests which "Share to Hermes" URIs the app opens (android/.../ShareSource.java) with a plain JDK: other apps' content://
# yes; file://, this app's own providers (also user-prefixed) and odd schemes no. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/ShareSource.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/ShareSourceTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class ShareSourceTest {
    static int fails = 0;
    static final String ME = "com.omarqaterge.hermesmobile";
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    public static void main(String[] a) {
        check(ShareSource.ok("content", "com.android.providers.media.documents", ME), "a document from another app");
        check(ShareSource.ok("content", "media", ME), "MediaStore");
        check(ShareSource.ok("content", "com.termux.files", ME), "Termux's file provider");
        check(ShareSource.ok("content", "0@media", ME), "a user-prefixed provider of another app");
        check(ShareSource.ok("content", "com.omarqaterge.hermesmobilex.files", ME), "a look-alike package that isn't ours");
        check(!ShareSource.ok("file", "", ME), "file:// (our private files)");
        check(!ShareSource.ok("FILE", null, ME), "file:// in capitals");
        check(!ShareSource.ok("content", ME + ".camera", ME), "our camera provider");
        check(!ShareSource.ok("content", ME + ".shizuku", ME), "our Shizuku provider");
        check(!ShareSource.ok("content", "0@" + ME + ".camera", ME), "our provider with a user prefix");
        check(!ShareSource.ok("content", "COM.OMARQATERGE.HERMESMOBILE.camera", ME), "our provider in capitals");
        check(!ShareSource.ok("content", ME, ME), "our package as the authority");
        check(!ShareSource.ok("content", "", ME), "no authority");
        check(!ShareSource.ok("android.resource", ME, ME), "android.resource://");
        check(!ShareSource.ok(null, "media", ME), "no scheme");
        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.ShareSourceTest
