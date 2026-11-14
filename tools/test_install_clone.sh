#!/bin/bash
# phone/install.sh's step 0/5: a copy of Hermux in ~/hermes-mobile whose history no longer matches `main` (the
# repository's history was rewritten after some phones cloned it) must be replaced by the current code instead of
# stopping the install with "Not possible to fast-forward". Runs the real block of install.sh against local repos.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; fail=1; }
git() { command git -c user.name=t -c user.email=t@example.invalid "$@"; }

# The block under test: from the `if [ -d "$HOME/hermes-mobile/.git" ]` line to its `fi`.
awk '/if \[ -d "\$HOME\/hermes-mobile\/\.git" \]; then$/{p=1} p{print} p&&/^  else git clone .*; fi$/{exit}' phone/install.sh > "$T/block.sh"
[ "$(wc -l < "$T/block.sh")" -ge 8 ] && ok "found the clone block in install.sh" || bad "clone block not found"

mkorigin() { # $1 dir, $2 marker
  rm -rf "$1"; mkdir -p "$1"; (cd "$1" && git init -q -b main && echo "$2" > f && git add f && git commit -qm "$2")
}
run() { HOME="$T/home" REPO="$T/origin" bash -c "$(cat "$T/block.sh")" 2>&1; }
mkdir -p "$T/home"
mkorigin "$T/origin" one
git clone -q "$T/origin" "$T/home/hermes-mobile"
git -C "$T/home/hermes-mobile" config pull.ff only

# 1. A normal update still fast-forwards, without replacing anything.
(cd "$T/origin" && echo two > f && git commit -qam two)
out=$(run); [ "$(cat "$T/home/hermes-mobile/f")" = two ] && ok "fast-forward update" || bad "fast-forward update: $out"
echo "$out" | grep -q "different history" && bad "a plain update must not say 'different history'" || ok "plain update says nothing about history"
git -C "$T/home/hermes-mobile" rev-parse -q --verify hm-before-update >/dev/null && bad "no backup branch for a plain update" || ok "no backup branch for a plain update"

# 2. The origin's history is rewritten (same content, new commits): the copy is replaced and the old state kept.
old=$(git -C "$T/home/hermes-mobile" rev-parse HEAD)
(cd "$T/origin" && git checkout -q --orphan new && echo three > f && git add f && git commit -qm three && git branch -M main)
out=$(run); rc=$?
[ "$(cat "$T/home/hermes-mobile/f")" = three ] && ok "rewritten history: current code in place" || bad "rewritten history: $out"
[ "$(git -C "$T/home/hermes-mobile" rev-parse hm-before-update 2>/dev/null)" = "$old" ] && ok "old state kept on hm-before-update" || bad "old state not kept"
[ "$rc" = 0 ] && ok "block ends successfully" || bad "block failed (rc $rc)"

# 3. Run again: nothing to do, still fine.
out=$(run); [ "$(cat "$T/home/hermes-mobile/f")" = three ] && ok "second run is a no-op" || bad "second run: $out"
[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "FAILED"; exit 1; }
