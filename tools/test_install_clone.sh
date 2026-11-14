#!/bin/bash
# phone/install.sh's step 0/5: when it isn't run from a clone, it puts the latest release (not main) into
# ~/hermes-mobile and runs that release's own installer, so the plugin and scripts match the app the phone downloads.
# An older copy, one whose history no longer matches (the history was rewritten), or one edited by hand is replaced,
# and its state kept on the branch hm-before-update (uncommitted edits in git's stash). Runs the real block of
# install.sh against local repositories, with a stand-in curl for the release lookup.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; fail=1; }
git() { command git -c user.name=t -c user.email=t@example.invalid -c advice.detachedHead=false "$@"; }
export GIT_CONFIG_NOSYSTEM=1

# The block under test: from `latest_release() {` to the line before "1/5".
awk '/^latest_release\(\) \{/{p=1} /^echo "1\/5/{exit} p{print}' phone/install.sh > "$T/block.sh"
grep -q 'exec bash "\$c/phone/install.sh"' "$T/block.sh" && ok "found step 0 in install.sh" || bad "step 0 not found"

# A release as the origin holds it: a stand-in installer that says which release it is, and the plugin folder.
commit() { # $1 marker, then optional tag
  (cd "$T/o.git" && mkdir -p phone hermes-plugin/hermes-mobile && printf 'echo "RAN %s"\n' "$1" > phone/install.sh \
    && echo "$1" > hermes-plugin/hermes-mobile/f && git add -A && git commit -qm "$1" && { [ -z "${2:-}" ] || git tag -a -m "$2" "$2"; })
}
mkdir -p "$T/home" "$T/bin" "$T/o.git"
(cd "$T/o.git" && git init -q -b main)
# The stand-in curl answers like GitHub's releases/latest redirect (the address in $T/latest), or fails.
cat > "$T/bin/curl" <<'EOF'
#!/bin/bash
[ -s "$LATEST" ] || exit 22
cat "$LATEST"
EOF
chmod +x "$T/bin/curl"
run() { # env assignments may be given first
  env HOME="$T/home" LATEST="$T/latest" PATH="$T/bin:$PATH" "$@" bash -c 'REPO='"$T"'/o; die() { echo "ERROR: $*"; exit 1; }; here=""; '"$(cat "$T/block.sh")" 2>&1
}
c="$T/home/hermes-mobile"
f() { cat "$c/hermes-plugin/hermes-mobile/f" 2>/dev/null; }

# 1. The release lookup: the tag from the redirect, nothing from anything else.
commit one v1; commit ahead  # main is now ahead of the release
echo "https://github.com/x/y/releases/tag/v1" > "$T/latest"
out=$(run); echo "$out" | grep -q "RAN one" && [ "$(f)" = one ] && ok "new copy: the latest release, not main" || bad "new copy: $out"
echo "$out" | grep -q "Hermux v1" && ok "says which release" || bad "no release line: $out"
git -C "$c" rev-parse -q --verify hm-before-update >/dev/null && bad "no backup branch for a new copy" || ok "no backup branch for a new copy"

echo "$out" | grep -qi "detached\|warning" && bad "new copy prints git noise: $out" || ok "new copy prints no git noise"

# 2. Run again: nothing changes, nothing kept aside.
out=$(run); echo "$out" | grep -q "RAN one" && [ "$(f)" = one ] && ok "second run keeps the release" || bad "second run: $out"
git -C "$c" rev-parse -q --verify hm-before-update >/dev/null && bad "second run made a backup branch" || ok "second run makes no backup branch"

# 3. A new release: the copy moves to it, the old state kept.
old=$(git -C "$c" rev-parse HEAD)
commit two v2; echo "https://github.com/x/y/releases/tag/v2" > "$T/latest"
out=$(run); echo "$out" | grep -q "RAN two" && [ "$(f)" = two ] && ok "new release: copy updated" || bad "new release: $out"
[ "$(git -C "$c" rev-parse hm-before-update 2>/dev/null)" = "$old" ] && ok "old state kept on hm-before-update" || bad "old state not kept"

# 4. Edited by hand: the edit goes to git's stash, the release is put in place.
echo mine > "$c/hermes-plugin/hermes-mobile/f"; echo extra > "$c/new-file"
commit three v3; echo "https://github.com/x/y/releases/tag/v3" > "$T/latest"
out=$(run); [ "$(f)" = three ] && [ ! -e "$c/new-file" ] && ok "hand-edited copy: release in place" || bad "hand-edited: $out"
git -C "$c" stash list | grep -q "before Hermux v3" && ok "hand edits kept in git's stash" || bad "hand edits lost"

# 5. The origin's history is rewritten (new commits, no common history): replaced, old state kept.
old=$(git -C "$c" rev-parse HEAD)
(cd "$T/o.git" && git checkout -q --orphan new && git rm -rqf . && git branch -D main -q && git branch -M main)
commit four v4; echo "https://github.com/x/y/releases/tag/v4" > "$T/latest"
out=$(run); rc=$?
[ "$(f)" = four ] && ok "rewritten history: release in place" || bad "rewritten history: $out"
[ "$(git -C "$c" rev-parse hm-before-update 2>/dev/null)" = "$old" ] && ok "rewritten history: old state kept" || bad "rewritten history: old state not kept"
[ "$rc" = 0 ] && ok "block ends successfully" || bad "block failed (rc $rc)"

# 6. HM_REF picks a branch: main, ahead of the release.
commit five
out=$(run HM_REF=main); [ "$(f)" = five ] && ok "HM_REF=main installs main" || bad "HM_REF=main: $out"

# 7. No release found (no network, or an address that isn't a release): stop with a message, change nothing.
echo "https://github.com/x/y/releases" > "$T/latest"
out=$(run); rc=$?
[ "$rc" != 0 ] && echo "$out" | grep -q "latest release" && [ "$(f)" = five ] && ok "no release: stops, copy untouched" || bad "no release (rc $rc): $out"
: > "$T/latest"
out=$(run); [ $? != 0 ] && echo "$out" | grep -q "latest release" && ok "lookup fails: stops with a message" || bad "lookup fails: $out"

# 8. ~/hermes-mobile exists but isn't a git copy: stop, touch nothing.
mv "$c" "$T/kept"; mkdir -p "$c"; echo x > "$c/notes"; echo "https://github.com/x/y/releases/tag/v4" > "$T/latest"
out=$(run); [ $? != 0 ] && echo "$out" | grep -q "not a copy of Hermux" && [ "$(cat "$c/notes")" = x ] && ok "not a git copy: stops, files untouched" || bad "not a git copy: $out"
rm -rf "$c"; mv "$T/kept" "$c"

# 9. A release that doesn't exist on the origin: stop, copy untouched.
echo "https://github.com/x/y/releases/tag/v9" > "$T/latest"
out=$(run); [ $? != 0 ] && echo "$out" | grep -q "Could not download Hermux v9" && [ "$(f)" = five ] && ok "missing tag: stops, copy untouched" || bad "missing tag: $out"
[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "FAILED"; exit 1; }
