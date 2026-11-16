#!/bin/bash
# phone/bootstrap.sh's repair before the Hermes step: a git command killed part-way leaves its lock file in the Hermes
# checkout, and every later run stopped at "could not write index". Runs the real line (deb's command, outside Debian)
# against a scratch checkout: old locks go, fresh ones (a git that is running) stay, no checkout changes nothing.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }
line=$(grep -m1 '^deb .*stale git lock' phone/bootstrap.sh)
check "[ -n \"\$line\" ]" "bootstrap: has the stale git lock repair"
cmd=$(printf '%s' "$line" | sed -e "s/^deb '//" -e "s/'\$//")
run() { HM_AGENT_DIR="$T/agent" bash -c "$cmd"; }
old() { touch -t "$(date -v-10M +%Y%m%d%H%M 2>/dev/null || date -d '-10 min' +%Y%m%d%H%M)" "$1"; }
mkdir -p "$T/agent/.git/refs/heads"
: > "$T/agent/.git/index.lock"; old "$T/agent/.git/index.lock"
: > "$T/agent/.git/refs/heads/main.lock"; old "$T/agent/.git/refs/heads/main.lock"
: > "$T/agent/.git/HEAD.lock"
: > "$T/agent/.git/index"; old "$T/agent/.git/index"
out=$(run)
check "[ ! -e '$T/agent/.git/index.lock' ]" "an old index.lock is removed"
check "[ ! -e '$T/agent/.git/refs/heads/main.lock' ]" "an old ref lock is removed"
check "[ -e '$T/agent/.git/HEAD.lock' ]" "a fresh lock (a git still running) stays"
check "[ -e '$T/agent/.git/index' ]" "files that are not locks stay"
check "[[ \"\$out\" == *'removed a stale git lock: '*index.lock* ]]" "it says which lock it removed"
rm -rf "$T/agent"; mkdir -p "$T/agent"
check "run && [ -z \"\$(run)\" ]" "no git checkout: nothing to do, no error"
rm -rf "$T/agent"
check "run" "no Hermes folder at all: no error"
echo
[ $fails -eq 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
