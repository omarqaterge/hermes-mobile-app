#!/bin/bash
# Tests when the in-app update installs a download (android/.../UpdateVersion.java) with a plain JDK: a higher
# versionCode, or the same code with a newer version name; nothing older or equal. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/UpdateVersion.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/UpdateVersionTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class UpdateVersionTest {
    static int fails = 0;
    static void check(String what, boolean ok) {
        System.out.println((ok ? "PASS  " : "FAIL  ") + what);
        if (!ok) fails++;
    }
    static String r(long gc, String gn, long mc, String mn) { return UpdateVersion.refusal(gc, gn, mc, mn); }
    public static void main(String[] a) {
        check("a higher code updates", r(908, "0.9.8", 907, "0.9.7") == null);
        check("old to new numbering updates", r(9009, "0.9.9", 908, "0.9.8") == null);
        check("a higher code updates even with an odd name", r(9009, "x", 908, "0.9.8") == null);
        check("same code, newer name (a test build took the code) updates", r(908, "0.9.8", 908, "0.9.7") == null);
        check("same code, same name: already have it", "You already have this version.".equals(r(908, "0.9.8", 908, "0.9.8")));
        check("same code, older name: already have it", "You already have this version.".equals(r(908, "0.9.7", 908, "0.9.8")));
        check("lower code, older name: already have it", "You already have this version.".equals(r(907, "0.9.7", 908, "0.9.8")));
        String low = r(9009, "0.9.9", 10000, "0.9.7");
        check("lower code, newer name: says why and what to do", low != null && low.contains("0.9.9") && low.contains("test build") && low.contains("Uninstall"));
        check("names: part by part", UpdateVersion.newer("0.10.0", "0.9.100") && !UpdateVersion.newer("0.9.100", "0.10.0"));
        check("names: v, suffixes and missing parts", UpdateVersion.newer("v0.9.8", "0.9.7+devtools") && !UpdateVersion.newer("1.0", "1.0.0") && !UpdateVersion.newer(null, "0.1"));
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.UpdateVersionTest
