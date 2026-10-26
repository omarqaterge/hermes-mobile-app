#!/bin/bash
# Compile-check the Android Java without the Android SDK (cloud sessions): javac against Robolectric's
# android-all jar from Maven Central (framework classes of Android 16) and a stub R generated from res/.
# It only proves the code compiles; it builds no APK. Needs JDK 21+ (the jar's class files). Usage: tools/java-check.sh
set -euo pipefail
cd "$(dirname "$0")/../android"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/hermes-mobile"
JAR="$CACHE/android-all-16.jar"
mkdir -p "$CACHE"
[ -s "$JAR" ] || curl -sSfL -o "$JAR" \
  https://repo1.maven.org/maven2/org/robolectric/android-all/16-robolectric-13921718/android-all-16-robolectric-13921718.jar
OUT=$(mktemp -d); trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/gen/com/omarqaterge/hermesmobile" "$OUT/classes"
{
  echo "package com.omarqaterge.hermesmobile; public final class R {"
  for kind in drawable mipmap xml layout; do
    names=$(find res -path "res/$kind*" -type f 2>/dev/null | sed 's#.*/##; s#\..*##' | sort -u)
    echo "  public static final class $kind {"
    i=0; for n in $names; do i=$((i+1)); echo "    public static final int $n = 0x7f0$i;"; done
    echo "  }"
  done
  echo "  public static final class string {"
  i=0; for n in $(grep -o 'name="[^"]*"' res/values/strings.xml | sed 's/name="//; s/"//'); do i=$((i+1)); echo "    public static final int $n = 0x7f1$i;"; done
  echo "  }"
  echo "}"
} > "$OUT/gen/com/omarqaterge/hermesmobile/R.java"
set +e
javac -encoding UTF-8 -source 11 -target 11 -Xlint:-options -nowarn -classpath "$JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java') 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS'
rc=${PIPESTATUS[0]}
[ "$rc" = 0 ] && echo "java-check: OK" || { echo "java-check: FAILED"; exit 1; }
# The Shizuku keeper's decision logic (plain JVM, no Android classes); the cwd is android/ here.
../tools/test_shizuku_keeper.sh > "$OUT/keeper.txt" 2>&1 || { grep -v '^PASS' "$OUT/keeper.txt"; echo "java-check: keeper test FAILED"; exit 1; }
echo "java-check: keeper test $(tail -1 "$OUT/keeper.txt")"
