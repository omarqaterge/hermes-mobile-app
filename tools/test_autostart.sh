#!/bin/bash
# Tests the Autostart step's maker table (android/.../Autostart.java) with a plain JDK: which phones get the step, that
# every maker has a page list, and that every package the table opens is in the manifest's <queries> (Android 11+
# hides other packages from resolveActivity otherwise, and the step would always fall back to App info). Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/Autostart.java "$T/src/com/omarqaterge/hermesmobile/"
grep -o '<package android:name="[^"]*"' android/AndroidManifest.xml | sed 's/.*name="//; s/"$//' > "$T/queries.txt"
cat > "$T/src/com/omarqaterge/hermesmobile/AutostartTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.nio.file.*;
import java.util.*;
public class AutostartTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static String name(String m, String b) { Autostart.Vendor v = Autostart.vendor(m, b); return v == null ? null : v.makers[0]; }
    public static void main(String[] a) throws Exception {
        // Build.MANUFACTURER / Build.BRAND pairs as phones report them
        check("xiaomi".equals(name("Xiaomi", "Xiaomi")), "Xiaomi → xiaomi");
        check("xiaomi".equals(name("Xiaomi", "Redmi")) && "xiaomi".equals(name("Xiaomi", "POCO")), "Redmi / POCO (made by Xiaomi) → xiaomi");
        check("huawei".equals(name("HUAWEI", "HUAWEI")) && "huawei".equals(name("HONOR", "HONOR")), "Huawei / Honor → huawei table");
        check("oppo".equals(name("OPPO", "OPPO")) && "oppo".equals(name("realme", "realme")) && "oppo".equals(name("OnePlus", "OnePlus")), "OPPO / realme / OnePlus → the ColorOS table");
        check("vivo".equals(name("vivo", "iQOO")), "vivo / iQOO → vivo");
        check("tecno".equals(name("TECNO MOBILE LIMITED", "TECNO")), "TECNO MOBILE LIMITED → tecno (whole words)");
        check("asus".equals(name("asus", "asus")) && "meizu".equals(name("Meizu", "meizu")) && "letv".equals(name("LeMobile", "LeEco")), "Asus / Meizu / LeEco");
        for (String[] p : new String[][]{{"Google", "google"}, {"samsung", "samsung"}, {"motorola", "motorola"}, {"unknown", "generic"}, {"Fairphone", "Fairphone"}, {"Sony", "Sony"}, {"Nothing", "Nothing"}, {"", ""}, {null, null}})
            check(name(p[0], p[1]) == null, "no Autostart step on " + p[0] + "/" + p[1]);
        check(name("Xiaomini", "x") == null, "no partial-word matches");
        Set<String> q = new HashSet<>(Files.readAllLines(Paths.get(a[0])));
        for (Autostart.Vendor v : Autostart.VENDORS) {
            check(v.pages.length > 0 && !v.name.isEmpty() && !v.where.isEmpty(), v.makers[0] + ": has pages, a switch name and where to look");
            for (Autostart.Page p : v.pages) {
                check(Arrays.asList("list", "app", "settings").contains(p.kind), v.makers[0] + ": page kind " + p.kind);
                check((p.cls != null) != (p.action != null), v.makers[0] + ": page is a class or an action, not both");
                check(p.cls == null || p.pkg != null, v.makers[0] + ": a class page names its package");
                if (p.pkg != null) check(q.contains(p.pkg), v.makers[0] + ": " + p.pkg + " is in the manifest's <queries>");
            }
        }
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.AutostartTest "$T/queries.txt"
