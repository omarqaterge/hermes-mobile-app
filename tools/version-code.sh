#!/bin/bash
# Prints the Android versionCode for a release version: `a.b.c` (a leading v is fine, a missing c counts as 0) gives
# a*1000000 + b*1000 + c, so every part has room up to 999 and a bigger part never reaches the next one's numbers.
# Fails (exit 1, a message on stderr) for anything else, or when the code would not be above 908, the last code of
# the old a*10000 + b*100 + c numbering (v0.9.8): an update must always get a higher code than every earlier release.
set -euo pipefail
v="${1#v}"
[[ "$v" =~ ^([0-9]{1,4})\.([0-9]{1,3})(\.([0-9]{1,3}))?$ ]] || { echo "version-code: '$1' is not a.b.c with b and c at most 999" >&2; exit 1; }
a=$((10#${BASH_REMATCH[1]})); b=$((10#${BASH_REMATCH[2]})); c=$((10#${BASH_REMATCH[4]:-0}))
[ "$a" -le 2099 ] || { echo "version-code: $a is too big a major version (Android allows codes up to 2100000000)" >&2; exit 1; }
code=$(( a * 1000000 + b * 1000 + c ))
[ "$code" -gt 908 ] || { echo "version-code: $v gives $code, not above 908 (v0.9.8): updates would be refused" >&2; exit 1; }
echo "$code"
