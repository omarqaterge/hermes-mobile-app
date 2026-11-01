#!/bin/bash
# Fetches the pinned sherpa-onnx build that on-device dictation (LocalStt.java) runs on, checks its SHA-256 and prints
# the cache paths: line 1 the Java API jar (pure Java, for javac/d8/lint), line 2 the folder with lib/<abi>/*.so for the
# APK. Both come from the k2-fsa/sherpa-onnx GitHub release; the cache is shared by every checkout and CI.
# Usage: tools/sherpa-onnx.sh [--jar-only]   (android/build.sh; tools/java-check.sh and tools/api-check.sh need only the jar)
set -euo pipefail
VERSION=2.0.1
JAR_SHA=8320e2457b6e38dd624fb619d3552e11ef78ffeb394622056126b16f2fd99d12
AAR_SHA=07e042d97f3a6bd5b7fe74d4eef0513dc01a714b16c15a903250095aba43a575
ABIS="arm64-v8a armeabi-v7a" # phones; x86 emulators are not supported by the APK's dictation engine
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/v$VERSION"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/hermes-mobile/sherpa-onnx-$VERSION"
mkdir -p "$CACHE"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi; }
fetch() { # url file sha
  [ -s "$2" ] && [ "$(sha "$2")" = "$3" ] && return 0
  curl -sSfL --retry 3 -o "$2.part" "$1"
  [ "$(sha "$2.part")" = "$3" ] || { rm -f "$2.part"; echo "sherpa-onnx: checksum mismatch for $1" >&2; exit 1; }
  mv "$2.part" "$2"
}

JAR="$CACHE/sherpa-onnx-jvm.jar"
fetch "$BASE/sherpa-onnx-jvm-$VERSION.jar" "$JAR" "$JAR_SHA"
if [ "${1:-}" != "--jar-only" ] && [ ! -f "$CACHE/lib/.done" ]; then
  AAR="$CACHE/sherpa-onnx.aar"
  fetch "$BASE/sherpa-onnx-static-link-onnxruntime-$VERSION.aar" "$AAR" "$AAR_SHA"
  rm -rf "$CACHE/lib" "$CACHE/x" && mkdir -p "$CACHE/x"
  for abi in $ABIS; do
    unzip -q -o "$AAR" "jni/$abi/*" -d "$CACHE/x"
    mkdir -p "$CACHE/lib/$abi"
    mv "$CACHE/x/jni/$abi/"*.so "$CACHE/lib/$abi/"
  done
  rm -rf "$CACHE/x" "$AAR"
  touch "$CACHE/lib/.done"
fi
echo "$JAR"
echo "$CACHE"
