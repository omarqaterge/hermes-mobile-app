#!/bin/bash
# Tests tools/version-code.sh, the versionCode the release workflow gives each version.
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
ok() { local got; got=$(tools/version-code.sh "$1" 2>/dev/null); if [ "$got" = "$2" ]; then echo "PASS  $1 -> $2"; else echo "FAIL  $1: want $2, got '${got}'"; fails=$((fails+1)); fi; }
bad() { if tools/version-code.sh "$1" >/dev/null 2>&1; then echo "FAIL  $1 should be refused"; fails=$((fails+1)); else echo "PASS  $1 refused"; fi; }
ok 0.9.9 9009
ok v0.9.9 9009
ok 0.10.0 10000
ok 0.9.999 9999
ok 1.0 1000000
ok 1.2.3 1002003
ok 0.09.010 9010
ok 2099.999.999 2099999999
# every code above the old numbering's last one (v0.9.8 = 908) and above the part before it
[ "$(tools/version-code.sh 0.9.100)" -lt "$(tools/version-code.sh 0.10.0)" ] && echo "PASS  0.9.100 stays below 0.10.0" || { echo "FAIL  0.9.100 not below 0.10.0"; fails=$((fails+1)); }
bad 0.0.5; bad 0.0.908; ok 0.0.909 909
bad 0.9.1000; bad 0.1000.0; bad 2100.0.0
ok 0.9 9000
bad ''; bad abc; bad 1.2.3.4; bad 1.2.x; bad -1.2.3; bad '1.2.3 '
echo; [ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
