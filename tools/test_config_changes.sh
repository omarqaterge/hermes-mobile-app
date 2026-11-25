#!/bin/bash
# Source check for MainActivity's configuration handling: fontScale, uiMode and smallestScreenSize stay in
# MainActivity's android:configChanges so changing system font size or dark mode never recreates the activity (closing
# the canvas, Settings or open sheets), and onConfigurationChanged keeps WebView textZoom at 100 % and notifies the page
# for both System theme (__hmSystemTheme) and Phone default text size (__hmPhoneTextScale). Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re, sys, xml.etree.ElementTree as ET

fails = 0
def check(ok, what):
    global fails
    print(("PASS  " if ok else "FAIL  ") + what)
    if not ok:
        fails += 1

NS = "{http://schemas.android.com/apk/res/android}"
tree = ET.parse("android/AndroidManifest.xml")
main_act = None
for act in tree.findall(".//application/activity"):
    if act.get(NS + "name") == ".MainActivity":
        main_act = act
        break

cfg = set((main_act.get(NS + "configChanges") or "").split("|")) if main_act is not None else set()
needed = {"orientation", "screenSize", "screenLayout", "smallestScreenSize", "keyboardHidden", "keyboard", "uiMode", "density", "fontScale"}
missing = sorted(needed - cfg)
check(main_act is not None and not missing, f"MainActivity configChanges covers fontScale, uiMode, smallestScreenSize and rotation (missing: {missing})")

src = open("android/src/com/omarqaterge/hermesmobile/MainActivity.java", encoding="utf-8").read()
def body(text, sig):
    i = text.find(sig)
    if i < 0:
        return ""
    j = text.find("{", i)
    depth, k = 0, j
    while k < len(text):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        if depth == 0:
            return text[j + 1:k]
        k += 1
    return ""

on_cfg = body(src, "public void onConfigurationChanged(")
check("window.__hmSystemTheme" in on_cfg, "onConfigurationChanged notifies the page for System theme (__hmSystemTheme)")
check("window.__hmPhoneTextScale" in on_cfg, "onConfigurationChanged notifies the page for Phone default text size (__hmPhoneTextScale)")
check("cfg.fontScale" in on_cfg and "currentFontScale" in on_cfg, "onConfigurationChanged records the new cfg.fontScale")
check("setTextZoom(100)" in on_cfg, "onConfigurationChanged keeps WebView textZoom pinned at 100%")

bridge_scale = body(src, "public float phoneTextScale(")
first_line = bridge_scale.strip().split("\n")[0].strip() if bridge_scale.strip() else ""
check(first_line.startswith("if (!ok(key)) return"), "Bridge.phoneTextScale checks the per-page key first")
check("currentFontScale" in bridge_scale, "Bridge.phoneTextScale reads the updated currentFontScale")

check(bool(re.search(r"volatile\s+float\s+currentFontScale\b", src)), "currentFontScale is volatile (shared between UI and JavaBridge threads)")

print("ALL PASSED" if fails == 0 else f"{fails} FAILED")
sys.exit(0 if fails == 0 else 1)
PY
