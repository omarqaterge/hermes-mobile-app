#!/data/data/com.termux/files/usr/bin/bash
# Brings the Hermux plugin in Debian up to the copy shipped inside the app's APK, safely. Shipped in the APK
# (assets/phone/plugin-update.sh, android/build.sh) and run by the app (PluginSync.java) in Termux through RUN_COMMAND:
#   plugin-update.sh check STAMP HASH            what is installed compared with the APK's plugin; changes nothing
#                                                (except: repairs an interrupted run, stamps an identical copy)
#   plugin-update.sh apply STAMP HASH SHA TOKEN [--force]
#       fetches the bundle from the app's loopback port (GET /plugin-bundle/TOKEN, a one-time token), checks it against SHA (from the APK), unpacks it beside the
#       plugin, checks HASH and that its Python compiles, swaps it in, restarts Hermes's dashboard, waits for the new
#       plugin's GET /plugin-info to answer, and goes back to the old plugin when it doesn't. Refuses while Hermes reports
#       work. --force also replaces a plugin that was changed by hand. Never replaces a newer plugin.
# On a developer's machine and in install.sh (no Debian involved):
#   plugin-update.sh source-stamp REPO           the version of a source tree: its last commit's time, or now if the
#                                                plugin folder has uncommitted changes (or it is no git checkout)
#   plugin-update.sh stamp DIR STAMP SOURCE      write DIR/BUILD_STAMP
#   plugin-update.sh pack DIR OUT.tgz STAMP      the bundle for the APK; prints "STAMP HASH SHA256"
#   plugin-update.sh hash DIR                    a folder's content hash (BUILD_STAMP and __pycache__ left out)
#   plugin-update.sh embed SERVICES OUT          writes this script to OUT with the supervisor script inside it (the APK's copy)
# BUILD_STAMP holds "STAMP HASH SOURCE". STAMP orders versions (bigger = newer; the phone's clock is never involved).
# A developer keeps the app's hands off a plugin under test with:  touch /root/.hermes/hermes-mobile-plugin/hold
# Every result line starts with "HMPLUGIN ":
#   STATE <not-ready|current|adopted|newer|older|modified|held> <installed stamp> · BUSY <why>
#   OK <stamp> [unverified] · FAIL <step> <why> (the old plugin is in place)
# Exit: 0 (the result is in the lines) · 2 usage
# The APK's copy also brings ~/bin/hermes-services up to date on check and apply (sync_services).

read -r -d '' COMMON <<'EOF'
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
tree_hash() {
  ( cd "$1" || exit 1
    find . -type f ! -name BUILD_STAMP ! -name .DS_Store ! -path '*/__pycache__/*' | LC_ALL=C sort \
      | while IFS= read -r f; do sha "$f"; done | sha | cut -d' ' -f1 )
}
EOF
eval "$COMMON"

# The Debian half: runs inside Debian as root, where the plugin's files are readable under proot and chroot alike.
read -r -d '' IN_DEBIAN <<'EOF'
ROOT=${HM_PLUGIN_ROOT:-/root/.hermes}; P=$ROOT/plugins/hermes-mobile; W=$ROOT/hermes-mobile-plugin
say() { echo "HMPLUGIN $*"; }
stamp_of() { s=$(cut -d' ' -f1 "$P/BUILD_STAMP" 2>/dev/null); case "$s" in ''|*[!0-9]*) echo 0 ;; *) echo "$s" ;; esac; }
mode=$1; shift
case "$mode" in
  inspect)  # APK_STAMP APK_HASH FORCE
    # A power cut between the two renames of a swap: the plugin is in old/, put it back.
    if [ ! -e "$P" ] && [ -d "$W/old" ]; then mv "$W/old" "$P"; rm -f "$W/pending"; fi
    if [ ! -d "$P" ]; then say STATE not-ready 0; exit 0; fi
    if [ -f "$W/pending" ]; then
      # A swap that never got its answer. The caller settles it, unless someone (install.sh) replaced the plugin since.
      if [ "$(cat "$W/pending")" = "$(stamp_of)" ]; then say PENDING "$(stamp_of)"; exit 0; fi
      rm -rf "$W/old"; rm -f "$W/pending"
    fi
    if [ -e "$W/hold" ]; then say STATE held "$(stamp_of)"; exit 0; fi
    have=$(stamp_of); now=$(tree_hash "$P")
    if [ "$now" = "$2" ]; then
      if [ "$have" = 0 ]; then
        # The same files with no stamp: nothing to swap or restart.
        printf '%s %s adopted\n' "$1" "$2" > "$P/BUILD_STAMP"; say STATE adopted "$1"
      else say STATE current "$have"; fi
      exit 0
    fi
    if [ "$have" != 0 ] && [ "$(cut -d' ' -f2 "$P/BUILD_STAMP")" != "$now" ] && [ "$3" != force ]; then
      say STATE modified "$have"; exit 0
    fi
    if [ "$have" -gt "$1" ]; then say STATE newer "$have"; exit 0; fi
    if [ "$have" = "$1" ] && [ "$3" != force ]; then say STATE current "$have"; exit 0; fi
    say STATE older "$have" ;;
  stage)  # BUNDLE APK_HASH: unpack and check, beside the live plugin but outside Hermes's plugins folder
    rm -rf "$W/new" "$W/tmp"; mkdir -p "$W/tmp" || { say FAIL stage cannot-write; exit 0; }
    tar -xzf "$1" -C "$W/tmp" --no-same-owner 2>/dev/null || { rm -rf "$W/tmp"; say FAIL stage unpack; exit 0; }
    [ "$(tree_hash "$W/tmp/hermes-mobile")" = "$2" ] && [ -f "$W/tmp/hermes-mobile/plugin.yaml" ] \
      || { rm -rf "$W/tmp"; say FAIL stage hash; exit 0; }
    py=$(ls -t "$ROOT"/installs/*/environments/*/venv/bin/python3 2>/dev/null | head -1)
    [ -n "$py" ] || py=$(command -v python3)
    if [ -n "$py" ] && ! "$py" -m compileall -q "$W/tmp/hermes-mobile" >/dev/null 2>&1; then
      rm -rf "$W/tmp"; say FAIL stage compile; exit 0
    fi
    mv "$W/tmp/hermes-mobile" "$W/new" && rmdir "$W/tmp" && say STAGED ;;
  swap)  # STAMP: the marker first, so that any interruption from here on is settled by the next run
    [ -d "$W/new" ] || { say FAIL swap nothing-staged; exit 0; }
    rm -rf "$W/old"; printf %s "$1" > "$W/pending.tmp" && mv "$W/pending.tmp" "$W/pending" || { say FAIL swap cannot-write; exit 0; }
    mv "$P" "$W/old" || { rm -f "$W/pending"; say FAIL swap move-old; exit 0; }
    mv "$W/new" "$P" || { mv "$W/old" "$P"; rm -f "$W/pending"; say FAIL swap move-new; exit 0; }
    # Every profile loads the main copy through a link (also how install.sh leaves them); a stale copy there would stay old.
    for p in "$ROOT"/profiles/*/; do
      [ -d "$p" ] || continue
      l="${p}plugins/hermes-mobile"
      [ -L "$l" ] && [ "$(readlink "$l")" = "$P" ] && continue
      mkdir -p "${p}plugins" && rm -rf "$l" && ln -s "$P" "$l"
    done
    say SWAPPED ;;
  commit) rm -rf "$W/old"; rm -f "$W/pending"; say COMMITTED ;;
  rollback)
    if [ -d "$W/old" ]; then rm -rf "$W/failed"; [ -e "$P" ] && mv "$P" "$W/failed"; mv "$W/old" "$P"; rm -rf "$W/failed"; fi
    rm -f "$W/pending"; say ROLLEDBACK ;;
esac
EOF

# ── Termux side ──
DASH=${HM_DASHBOARD:-http://127.0.0.1:9119}
BUNDLE_URL=${HM_BUNDLE_URL:-http://127.0.0.1:9121/plugin-bundle}  # + /TOKEN
WAIT=${HM_PLUGIN_WAIT:-300}     # seconds for the restarted dashboard to answer at all (a cold start on a phone is slow)
LOAD_WAIT=${HM_PLUGIN_LOAD_WAIT:-60}  # then for it to serve the new plugin
BACK_WAIT=${HM_PLUGIN_BACK_WAIT:-180}
# The app passes this whole script as `bash -c TEXT`, so its text is on this process's command line: it must never
# contain the dashboard's command line, or `hermes-debian --restart` (pkill -f on it) kills this run too.
DASH_RE='[h]ermes dashboard --host 127[.]0[.]0[.]1 --port 9119'
# Every Debian login gets a time limit: a hung proot-distro or chroot-distro must not hold the run forever.
tmo() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }
TERMUX_HOME=$HOME
# The supervisor script, base64, filled in by `embed`: as plain text it would put the dashboard's command line on this
# process's command line (see DASH_RE). Empty outside the APK's copy: then ~/bin/hermes-services is left alone.
SERVICES_B64=""
SERVICES_SHA="$TERMUX_HOME/.hermes-mobile/services.sha"  # what was last installed from an APK; install.sh removes it
SERVICES_NEW="$TERMUX_HOME/.hermes-mobile/services-new"  # installed, but the dashboard's loop still runs the old one
say() { echo "HMPLUGIN $*"; }
deb() {  # run the Debian half; hermes-debian knows proot-distro and chroot-distro, an older install is proot-distro
  if [ -x "$HOME/bin/hermes-debian" ]; then tmo 240 "$HOME/bin/hermes-debian" bash -c "$COMMON
$IN_DEBIAN" hm-plugin "$@" </dev/null
  else tmo 240 proot-distro login debian -- bash -c "$COMMON
$IN_DEBIAN" hm-plugin "$@" </dev/null; fi
}
# One word of the Debian half's last HMPLUGIN line, so that noise from a login shell can't be taken for an answer.
last() { grep '^HMPLUGIN ' | tail -1; }
token() { curl -s -m 5 -H "X-Hermes-Mobile-Key: $(cat "$HOME/.hermes-mobile/key" 2>/dev/null)" "$DASH/" 2>/dev/null | sed -n 's/.*__HERMES_SESSION_TOKEN__ *= *"\([^"]*\)".*/\1/p' | head -1; }
route() {  # PATH: the body when the plugin's route answers 200, else non-zero. The token changes with every dashboard start.
  local t out; t=$(token); [ -n "$t" ] || return 1
  out=$(curl -s -m 5 -H "X-Hermes-Session-Token: $t" -w '\n%{http_code}' "$DASH/api/plugins/hermes-mobile/$1" 2>/dev/null) || return 1
  [ "${out##*$'\n'}" = 200 ] || return 1
  printf '%s\n' "${out%$'\n'*}"
}
plugin_up() { route activity >/dev/null; }
dash_up() { [ -n "$(token)" ]; }
# Live work by Hermes's own count, in every Hermes process (a second check behind the app's: it may have missed a beat).
working() { local a; a=$(route activity) || return 1; ! printf %s "$a" | grep -Eq '"items": *\[ *\]'; }
serves() { route plugin-info | grep -Eq "\"stamp\": *$1([^0-9]|$)"; }
wait_serves() {  # STAMP SECONDS
  local end=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$end" ]; do serves "$1" && return 0; sleep "${HM_PLUGIN_POLL:-3}"; done
  return 1
}
wait_up() {  # SECONDS [dash]: until the plugin (or only the dashboard) answers
  local end=$((SECONDS + $1)) f=${2:-plugin}_up
  while [ "$SECONDS" -lt "$end" ]; do $f && return 0; sleep "${HM_PLUGIN_POLL:-3}"; done
  return 1
}
# A new supervisor script reaches running loops only when they start again. Hermes is about to restart anyway, so its
# loop goes now, and the check below starts a new one. The other loops follow at the phone's next restart.
restart_loop() {
  [ -f "$SERVICES_NEW" ] || return 0
  rm -f "$SERVICES_NEW"
  local pid; pid=$(cat "$HOME/logs/dashboard.pid" 2>/dev/null)
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q hermes-services && kill "$pid" 2>/dev/null
  return 0
}
restart() {
  restart_loop
  "$HOME/bin/hermes-debian" --restart 2>/dev/null \
    || { pids=$(pgrep -f "$DASH_RE") && kill -9 $pids 2>/dev/null; }
  # The supervisor loop starts it again; start the loop itself if it is gone. All output away: Termux waits on open pipes.
  local pid; pid=$(cat "$HOME/logs/dashboard.pid" 2>/dev/null)
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    [ -x "$HOME/bin/hermes-services" ] && ( "$HOME/bin/hermes-services" >/dev/null 2>&1 </dev/null & )
  fi
  return 0
}
restart_ticker() {  # the cron ticker keeps the plugin it first loaded; its loop starts it again. Only between jobs.
  working && return 0
  if [ "$("$HOME/bin/hermes-debian" --which 2>/dev/null)" = chroot ]; then
    su -c "pkill -f '/root/.hermes/scripts/[c]ron_ticker.py'" </dev/null 2>/dev/null
  else pkill -f '/root/.hermes/scripts/[c]ron_ticker.py' 2>/dev/null; fi
  return 0
}
settle() {  # STAMP: a swap whose run was cut off: keep it when the new plugin serves, else go back
  if wait_serves "$1" "${HM_PLUGIN_SETTLE:-45}"; then deb commit | last >/dev/null; return 0; fi
  # Only when Hermes answers, plainly without the new plugin, and has no work: else leave it for a later run.
  if ! dash_up || working; then say BUSY settling; exit 0; fi
  deb rollback | last >/dev/null; restart
}

usage() { echo "usage: plugin-update.sh check|apply|source-stamp|stamp|pack|hash|embed ..." >&2; exit 2; }
valid() { case "$1" in ''|*[!0-9]*) usage ;; esac; case "$2" in ''|*[!0-9a-f]*) usage ;; esac; }
LOCK="$TERMUX_HOME/.hermes-mobile/plugin-update.lock"
take_lock() {
  mkdir -p "$TERMUX_HOME/.hermes-mobile"
  # A run is bounded well below 15 minutes: an older lock was left by a killed one.
  find "$LOCK" -maxdepth 0 -mmin +20 -exec rm -rf {} \; 2>/dev/null
  mkdir "$LOCK" 2>/dev/null || { say BUSY another-run; exit 0; }
  echo $$ > "$LOCK/pid"
  trap drop_lock EXIT
}
drop_lock() {  # only our own: a run that outlived its lock must not remove the next run's
  [ -n "${b:-}" ] && rm -f "$b"
  [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"
  return 0
}
# Brings ~/bin/hermes-services up to the APK's copy. Only where the plugin may be replaced too (not newer, changed by hand,
# held or not ready), never creates it (the installer does), and leaves a copy changed by hand since the last one from an
# APK. A rename: a run of the old script that is reading it carries on undisturbed. Says nothing: the app reads the last line.
sync_services() {  # the plugin's state line
  case "$1" in "HMPLUGIN STATE current "*|"HMPLUGIN STATE adopted "*|"HMPLUGIN STATE older "*) ;; *) return 0 ;; esac
  [ -n "$SERVICES_B64" ] || return 0
  local f="$HOME/bin/hermes-services" new have known want
  [ -f "$f" ] || return 0
  new="$f.new"
  have=$(sha "$f" | cut -d' ' -f1); known=$(cat "$SERVICES_SHA" 2>/dev/null)
  [ -z "$known" ] || [ "$known" = "$have" ] || return 0
  if ! printf %s "$SERVICES_B64" | base64 -d > "$new" 2>/dev/null || [ ! -s "$new" ] || ! bash -n "$new" 2>/dev/null; then
    rm -f "$new"; return 0
  fi
  want=$(sha "$new" | cut -d' ' -f1)
  if [ "$want" = "$have" ]; then rm -f "$new"; echo "$want" > "$SERVICES_SHA"; return 0; fi
  cp -p "$f" "$TERMUX_HOME/.hermes-mobile/hermes-services.bak" 2>/dev/null
  chmod +x "$new" && mv "$new" "$f" && echo "$want" > "$SERVICES_SHA" && : > "$SERVICES_NEW"
  rm -f "$new"
  return 0
}
inspect() {  # APK_STAMP APK_HASH FORCE: settles an interrupted swap first; sets $line
  line=$(deb inspect "$@" | last)
  case "$line" in
    "HMPLUGIN PENDING "*) settle "${line##* }"; line=$(deb inspect "$@" | last) ;;
  esac
}

cmd=${1:-}; [ $# -gt 0 ] && shift
case "$cmd" in
  hash) [ -d "${1:-}" ] || usage; tree_hash "$1" ;;
  embed)
    [ -f "${1:-}" ] && [ -n "${2:-}" ] || usage
    b=$(base64 < "$1" | tr -d '\n')
    sed "s|^SERVICES_B64=.*|SERVICES_B64=\"$b\"|" "$0" > "$2" ;;
  stamp)
    [ -d "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || usage
    printf '%s %s %s\n' "$2" "$(tree_hash "$1")" "$3" > "$1/BUILD_STAMP" ;;
  source-stamp)
    [ -d "${1:-}" ] || usage
    if [ -e "$1/.git" ] && [ -z "$(git -C "$1" status --porcelain -- hermes-plugin/hermes-mobile 2>/dev/null)" ] \
      && t=$(git -C "$1" log -1 --format=%ct 2>/dev/null) && [ -n "$t" ]; then echo "$t"; else date +%s; fi ;;
  pack)
    [ -d "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || usage
    t=$(mktemp -d "${TMPDIR:-/tmp}/hm-plugin.XXXXXX") || exit 1
    COPYFILE_DISABLE=1 tar -cf - --exclude __pycache__ --exclude .DS_Store --exclude BUILD_STAMP -C "$(dirname "$1")" "$(basename "$1")" \
      | tar -xf - -C "$t" || { rm -rf "$t"; exit 1; }
    [ "$(basename "$1")" = hermes-mobile ] || mv "$t/$(basename "$1")" "$t/hermes-mobile"
    hash=$(tree_hash "$t/hermes-mobile")
    printf '%s %s apk\n' "$3" "$hash" > "$t/hermes-mobile/BUILD_STAMP"
    COPYFILE_DISABLE=1 tar -czf "$2" -C "$t" hermes-mobile || { rm -rf "$t"; exit 1; }
    rm -rf "$t"
    echo "$3 $hash $(sha "$2" | cut -d' ' -f1)" ;;
  check)
    [ $# -eq 2 ] || usage; valid "$1" "$2"
    take_lock
    inspect "$1" "$2" no
    sync_services "$line"
    echo "${line:-HMPLUGIN FAIL check no-answer}" ;;
  apply)
    [ $# -ge 4 ] || usage; valid "$1" "$2"; valid "$1" "$3"; valid "$1" "$4"
    stamp=$1 hash=$2 want=$3 tok=$4 force=no; [ "${5:-}" = --force ] && force=force
    take_lock
    inspect "$stamp" "$hash" "$force"
    sync_services "$line"
    case "$line" in
      "HMPLUGIN STATE older "*) ;;
      "") say FAIL check no-answer; exit 0 ;;
      *) echo "$line"; exit 0 ;;
    esac
    if working; then say BUSY working; exit 0; fi
    b="$TERMUX_HOME/.hermes-mobile/plugin-bundle.tgz"
    # Only what the APK holds: the script and this SHA both came out of it, and the bytes must match.
    curl -sf -m 30 -o "$b" "$BUNDLE_URL/$tok" || { say FAIL fetch no-bundle; exit 0; }
    [ "$(sha "$b" | cut -d' ' -f1)" = "$want" ] || { say FAIL fetch checksum; exit 0; }
    r=$(deb stage "$b" "$hash" | last)
    [ "$r" = "HMPLUGIN STAGED" ] || { echo "${r:-HMPLUGIN FAIL stage no-answer}"; exit 0; }
    # Unpacking and compiling took a moment: look again right before Hermes is touched.
    if working; then say BUSY working; exit 0; fi
    # A plugin the dashboard doesn't load now (switched off in Hermes, or Hermes stopped) can't prove anything after
    # the restart. A dashboard between two starts gets a moment first.
    wait_up "${HM_PLUGIN_UP_WAIT:-20}" && loaded=1 || loaded=0
    r=$(deb swap "$stamp" | last)
    [ "$r" = "HMPLUGIN SWAPPED" ] || { echo "${r:-HMPLUGIN FAIL swap no-answer}"; exit 0; }
    # A turn that started during the swap: put the old plugin back (no restart was made) and wait for another moment.
    if working; then deb rollback >/dev/null; say BUSY working; exit 0; fi
    restart
    if [ "$loaded" = 0 ]; then
      deb commit >/dev/null
      say OK "$stamp" unverified
    elif wait_up "$WAIT" dash && wait_serves "$stamp" "$LOAD_WAIT"; then
      deb commit >/dev/null
      restart_ticker
      say OK "$stamp"
    else
      deb rollback >/dev/null
      restart
      wait_up "$BACK_WAIT" && say FAIL load rolled-back || say FAIL load rolled-back-not-up
    fi ;;
  *) usage ;;
esac
