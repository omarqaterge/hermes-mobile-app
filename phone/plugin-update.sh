#!/data/data/com.termux/files/usr/bin/bash
# Brings the Hermux plugin in Debian up to the copy shipped inside the app's APK, safely. Shipped in the APK
# (assets/phone/plugin-update.sh, android/build.sh) and run by the app (PluginSync.java) in Termux through RUN_COMMAND:
#   plugin-update.sh check STAMP HASH            what is installed compared with the APK's plugin; changes nothing
#                                                (except: repairs an interrupted run, stamps an identical copy)
#   plugin-update.sh apply STAMP HASH SHA TOKEN [--force] [--user [--confirmed]]
#       fetches the bundle from the app's loopback port (GET /plugin-bundle/TOKEN, a one-time token), checks it against SHA (from the APK), unpacks it beside the
#       plugin, checks HASH and that its Python compiles, swaps it in, restarts Hermes's dashboard, waits for the new
#       plugin's GET /plugin-info to answer, and goes back to the old plugin when it doesn't. Refuses while Hermes reports
#       work. --force also replaces a plugin that was changed by hand. Never replaces a newer plugin. --user: the user
#       asked (a tap); only that, with --confirmed (the user was told a running answer may be cut off), may replace an
#       old plugin whose guard can't say whether Hermes works (BUSY unknown otherwise).
# On a developer's machine and in install.sh (no Debian involved):
#   plugin-update.sh source-stamp REPO           the version of a source tree: its last commit's time, or now if the
#                                                plugin folder has uncommitted changes (or it is no git checkout)
#   plugin-update.sh stamp DIR STAMP SOURCE      write DIR/BUILD_STAMP
#   plugin-update.sh pack DIR OUT.tgz STAMP [PHONE]  the bundle for the APK; prints "STAMP HASH SHA256". With PHONE (the
#                                                repo's phone/ folder) the Termux scripts named in SCRIPTS go in too
#   plugin-update.sh assemble DIR PHONE OUT      the same folder as pack's (DIR plus PHONE's scripts), not packed: install.sh
#   plugin-update.sh hash DIR                    a folder's content hash (BUILD_STAMP and __pycache__ left out)
#   plugin-update.sh embed SERVICES OUT          writes this script to OUT with the supervisor script inside it (the APK's copy)
# BUILD_STAMP holds "STAMP HASH SOURCE". STAMP orders versions (bigger = newer; the phone's clock is never involved).
# A developer keeps the app's hands off a plugin under test with:  touch /root/.hermes/hermes-mobile-plugin/hold
# Every result line starts with "HMPLUGIN ":
#   STATE <not-ready|current|adopted|newer|older|modified|held> <installed stamp> · BUSY <why>
#   OK <stamp> [unverified] · FAIL <step> <why> (the old plugin is in place)
#   SCRIPTS ok · SCRIPTS fail <no-answer|missing|copy|changed>  the Termux scripts (below); never the last line
# Exit: 0 (the result is in the lines) · 2 usage
# The APK's copy also brings ~/bin/hermes-services up to date on check and apply (sync_services), and copies the Termux
# scripts the plugin carries in phone-scripts/ to ~/bin after a swap and whenever the plugin is current (sync_scripts).

# The Termux scripts that travel inside the plugin (phone-scripts/), so that every app update brings them along: pack and
# assemble put them in, sync_scripts copies them to ~/bin. Only these names are ever copied.
SCRIPTS="hm-local hm-shizuku"

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
# An older install's cron ticker in scripts/: its supervisor loop runs that file until the phone restarts, so once the
# plugin carries its own copy the file becomes a stand-in that runs the plugin's (and only that: with no plugin copy it
# exits with an error, it never runs old code). The file it replaced is kept (TICKER_KEEP) for a rollback to a plugin
# without a ticker of its own. Idempotent: a stand-in already there is left as it is.
OLD_TICKER=$ROOT/scripts/cron_ticker.py; TICKER_KEEP=$OLD_TICKER.before
ticker_shim() {
  [ -f "$P/cron_ticker.py" ] && [ -f "$OLD_TICKER" ] && [ ! -L "$OLD_TICKER" ] || return 0
  grep -q 'hermux-ticker-shim' "$OLD_TICKER" 2>/dev/null && return 0
  cp -p "$OLD_TICKER" "$TICKER_KEEP.tmp" && mv -f "$TICKER_KEEP.tmp" "$TICKER_KEEP" || return 0
  printf '%s\n' '# hermux-ticker-shim: the cron ticker ships in the Hermux plugin now; plugin-update.sh put this stand-in here.' \
    'import os, sys' "T = '$P/cron_ticker.py'" 'if not os.path.isfile(T):' \
    '    sys.exit("cron ticker: the plugin copy is missing, so nothing runs")' \
    'os.execv(sys.executable, [sys.executable, T] + sys.argv[1:])' > "$OLD_TICKER.tmp" \
    && mv -f "$OLD_TICKER.tmp" "$OLD_TICKER" || rm -f "$OLD_TICKER.tmp"
}
ticker_back() {  # after a rollback to a plugin without its own ticker: the file the stand-in replaced comes back
  [ -f "$P/cron_ticker.py" ] && return 0
  [ -f "$TICKER_KEEP" ] && grep -q 'hermux-ticker-shim' "$OLD_TICKER" 2>/dev/null && mv -f "$TICKER_KEEP" "$OLD_TICKER"
  return 0
}
mode=$1; shift
case "$mode" in
  inspect)  # APK_STAMP APK_HASH FORCE
    # A power cut between the two renames of a swap: the plugin is in old/, put it back.
    if [ ! -e "$P" ] && [ -d "$W/old" ]; then mv "$W/old" "$P"; rm -f "$W/pending"; fi
    if [ ! -d "$P" ]; then say STATE not-ready 0; exit 0; fi
    # Whether the installed plugin's dashboard guard answers local authentication's hello, from its files on disk.
    if grep -q '/hermux/hello' "$P/dashboard/plugin_api.py" 2>/dev/null; then say GUARD hello; else say GUARD old; fi
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
  commit) rm -rf "$W/old"; rm -f "$W/pending"; ticker_shim; say COMMITTED ;;
  tickershim) ticker_shim; say TICKER ;;  # a current plugin (check): the stand-in, if an earlier update didn't write it
  scripts)  # NAME...: the SHA-256 of each Termux script the installed plugin carries
    for n in "$@"; do
      f="$P/phone-scripts/$n"
      [ -f "$f" ] && [ ! -L "$f" ] && say SCRIPT "$n" "$(sha "$f" | cut -d' ' -f1)"
    done
    say LISTED ;;
  rollback)
    if [ -d "$W/old" ]; then rm -rf "$W/failed"; [ -e "$P" ] && mv "$P" "$W/failed"; mv "$W/old" "$P"; rm -rf "$W/failed"; fi
    ticker_back; rm -f "$W/pending"; say ROLLEDBACK ;;
esac
EOF

# ── Termux side ──
DASH=${HM_DASHBOARD:-http://127.0.0.1:9119}
DASH_PORT=${DASH##*:}
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
# The dashboard's session token, from a verified dashboard only: `hm-local token` checks the guard's proof under the key
# (the key never leaves hm-local). The one exception: while the old plugin's dashboard still runs (`legacy` yes: the
# installed plugin's own BUILD_STAMP is older than the APK's, by the Debian-side inspect, and its guard's files have no
# hello), only in apply and only until Hermes restarts with the new plugin, the old guard can only answer the raw key, as
# before; that use is noted once in the diagnostic log (`local legacy_key port=dashboard side=termux`). Never decided by
# anything the port says, and never again in a run that has restarted Hermes (`restarted`: a settle's rollback, or this
# run's own restart; a rollback waits with a plain probe, no key). And only while the dashboard's own process runs
# (`dashboard_runs`): with Hermes stopped, whatever answers on the port is not the old guard.
legacy=no; blind=no; restarted=""
# token() runs in command substitutions (subshells), so what it keeps for the run lives in the run's lock folder.
# Hermes's dashboard process for the port dialled, by its command line ("[h]": the pattern never matches this run's own
# command line): Termux's user under proot, root under chroot.
DASH_PROC_RE="[h]ermes dashboard --host 127[.]0[.]0[.]1 --port ${DASH_PORT}( |\$)"
# ... and a process at least DASH_MIN_AGE seconds old: one that is still starting may not hold the port yet, while
# something else answers on it. Its age by `ps -o etimes=`, else `ps -o etime=` ([[DD-]HH:]MM:SS, busybox and BSD too),
# else /proc/<pid>/stat against /proc/uptime; an age it can't tell counts as too young (the exception stays off).
DASH_MIN_AGE=${HM_DASH_MIN_AGE:-5}
etime_seconds() {  # ps's etime ([[DD-]HH:]MM:SS, or SS): seconds, or nothing for anything else
  local v=$1 d=0 h=0 m=0 s x
  case "$v" in ''|*[!0-9:-]*) return 0 ;; esac
  case "$v" in *-*) d=${v%%-*}; v=${v#*-} ;; esac
  case "$v" in
    *:*:*:*) return 0 ;;
    *:*:*) h=${v%%:*}; v=${v#*:}; m=${v%%:*}; s=${v#*:} ;;
    *:*) m=${v%%:*}; s=${v#*:} ;;
    *) s=$v ;;
  esac
  for x in "$d" "$h" "$m" "$s"; do case "$x" in ''|*[!0-9]*) return 0 ;; esac; done
  echo $(( ((10#$d * 24 + 10#$h) * 60 + 10#$m) * 60 + 10#$s ))
}
stat_age() {  # STAT-LINE UPTIME HZ: seconds since the process started (stat's field 22), or nothing when any value is
  # missing or not a number (the process may have ended in between): an unknown age keeps the exception off
  local st up=${2%%.*} hz=$3 x
  st=$(printf '%s' "$1" | sed 's/.*) //' | cut -d' ' -f20)
  for x in "$st" "$up" "$hz"; do case "$x" in ''|*[!0-9]*) return 0 ;; esac; done
  [ "$hz" -gt 0 ] && [ $(( st / hz )) -le "$up" ] || return 0
  echo $(( up - st / hz ))
}
age_of() {  # PID [chroot]: seconds since it started, or nothing
  local run=sh a
  [ "${2:-}" = chroot ] && run="su"
  a=$($run -c "ps -o etimes= -p $1" </dev/null 2>/dev/null | tr -d ' \n')
  case "$a" in ''|*[!0-9]*) ;; *) echo "$a"; return 0 ;; esac
  a=$(etime_seconds "$($run -c "ps -o etime= -p $1" </dev/null 2>/dev/null | tr -d ' \n')")
  [ -n "$a" ] && { echo "$a"; return 0; }
  stat_age "$($run -c "cat /proc/$1/stat" </dev/null 2>/dev/null)" "$(cut -d' ' -f1 /proc/uptime 2>/dev/null)" "$(getconf CLK_TCK 2>/dev/null)"
}
dashboard_runs() {
  local pids p a how=""
  if [ "$("$HOME/bin/hermes-debian" --which 2>/dev/null)" = chroot ]; then
    how=chroot; pids=$(su -c "pgrep -u 0 -f '$DASH_PROC_RE'" </dev/null 2>/dev/null)
  else pids=$(pgrep -u "$(id -u)" -f "$DASH_PROC_RE" 2>/dev/null); fi
  for p in $pids; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    a=$(age_of "$p" "$how")
    [ -n "$a" ] && [ "$a" -ge "$DASH_MIN_AGE" ] && return 0
  done
  return 1
}
note_legacy() {  # once per run
  [ -e "$LOCK/legacy-noted" ] && return 0
  : > "$LOCK/legacy-noted" 2>/dev/null
  [ -f "$TERMUX_HOME/.hermes-mobile/diag-off" ] && return 0
  mkdir -p "$TERMUX_HOME/logs" && printf '%s local legacy_key port=dashboard side=termux\n' "$(date +%s)" >> "$TERMUX_HOME/logs/loop-events.log"
}
local_client() {  # the hm-local to run: ~/bin's when it has the verified REST call (get), else the installed plugin's
  # own copy (taken once, into the lock folder)
  if [ -f "$HOME/bin/hm-local" ] && [ ! -L "$HOME/bin/hm-local" ] && grep -q '^def dashboard_get' "$HOME/bin/hm-local" 2>/dev/null; then
    echo "$HOME/bin/hm-local"; return 0
  fi
  local f="$LOCK/hm-local"
  if [ ! -s "$f" ]; then
    rm -f "$f"
    (set -C; deb_cat "$PLUGIN_DIR/phone-scripts/hm-local" > "$f") 2>/dev/null && [ -s "$f" ] || { rm -f "$f"; return 1; }
  fi
  echo "$f"
}
forget_client() { rm -f "$LOCK/hm-local"; return 0; }
exception() {  # every condition of the one exception (see above), looked at again on each use
  [ "$legacy" = yes ] && [ -z "$restarted" ] && [ ! -e "$TERMUX_HOME/.hermes-mobile/enforced" ] && dashboard_runs
}
page_token() {  # under the exception only: the old guard's page token, for the raw key
  note_legacy
  # The header from a file descriptor: the key never goes on a command line (printf is a shell builtin).
  curl -s -m 5 -H @<(printf 'X-Hermes-Mobile-Key: %s\n' "$(cat "$HOME/.hermes-mobile/key" 2>/dev/null)") "$DASH/" 2>/dev/null | sed -n 's/.*__HERMES_SESSION_TOKEN__ *= *"\([^"]*\)".*/\1/p' | head -1
}
token() {
  if exception; then page_token; return 0; fi
  local c; c=$(local_client) || return 0
  bash "$c" token "$DASH_PORT" </dev/null 2>/dev/null | head -1
}
route() {  # PATH: the body when the plugin's route answers 200, else non-zero. The token changes with every dashboard start.
  # A dashboard that speaks the hello: `hm-local get` (the token from a verified dashboard, sent only on a new verified
  # connection, and an answer taken only with its proof). Only under the one exception (an old guard: no hello, no
  # proof), as before: the token from its page, then a plain request whose answer can't be checked.
  local t out c
  if exception; then
    # The old guard's own page token, never one hm-local got from a verified dashboard: that one goes only on a
    # verified connection.
    t=$(page_token); [ -n "$t" ] || return 1
    out=$(curl -s -m 5 -H "X-Hermes-Session-Token: $t" -w '\n%{http_code}' "$DASH/api/plugins/hermes-mobile/$1" 2>/dev/null) || return 1
    [ "${out##*$'\n'}" = 200 ] || return 1
    printf '%s\n' "${out%$'\n'*}"
    return 0
  fi
  c=$(local_client) || return 1
  out=$(bash "$c" get "/api/plugins/hermes-mobile/$1" "$DASH_PORT" </dev/null 2>/dev/null) || return 1
  printf '%s\n' "$out"
}
plugin_up() { route activity >/dev/null; }
# Hermes answers: a verified token (or, under the exception, the old guard's token), or an HTTP answer that is no hello at
# all while the installed plugin has one (its guard isn't loaded: "up, plainly without the new plugin"). Only the hello
# is sent for that.
dash_up() {
  [ -n "$(token)" ] && return 0
  [ "$legacy" = yes ] && return 1
  local c; c=$(local_client) || return 1
  bash "$c" hello dashboard "$DASH_PORT" </dev/null >/dev/null 2>&1
  [ $? = 4 ]
}
# Live work by Hermes's own count, in every Hermes process (a second check behind the app's: it may have missed a beat).
working() { local a; a=$(route activity) || return 1; ! printf %s "$a" | grep -Eq '"items": *\[ *\]'; }
serves() { route plugin-info | grep -Eq "\"stamp\": *$1([^0-9]|$)"; }
wait_serves() {  # STAMP SECONDS
  local end=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$end" ]; do serves "$1" && return 0; sleep "${HM_PLUGIN_POLL:-3}"; done
  return 1
}
http_up() {  # any HTTP answer on the dashboard's port, with no key and no token: only "something answers"
  local code; code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$DASH/" 2>/dev/null)
  [ -n "$code" ] && [ "$code" != 000 ]
}
back_up() { dashboard_runs && http_up; }  # after a rollback: Hermes's process runs and the port answers (nothing more)
wait_up() {  # SECONDS [dash|back]: until the plugin (or only the dashboard; or, after a rollback, its process and port) answers
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
  restarted=1  # from here on the dashboard on the port is not the old plugin's guard: never the raw key again
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
# The cron ticker is the Python process whose first argument is a ticker file: the plugin's own copy or an older
# install's in scripts/. Only that process is stopped, never a wrapper whose command line merely names those files
# (the supervisor's loop: proot or chroot login, bash -lc with both paths in its text), so the loop starts exactly one
# ticker again. The paths are built from pieces, so this run's own command line (the app runs it as `bash -c TEXT`)
# never names them.
TICKER_HOME=${HM_TICKER_HOME:-/root/.hermes}
PLUGIN_TICKER="$TICKER_HOME/plugins/hermes-mobile/cron""_ticker.py" OLD_TICKER_FILE="$TICKER_HOME/scripts/cron""_ticker.py"
# For sh -c or su -c: $want holds the files; every process whose command line names one is looked at, and only a
# python* whose second word is one of them is stopped (ps prints the arguments as the program sees them).
TICKER_KILL='for p in $(pgrep -f "[c]ron_ticker[.]py" 2>/dev/null); do set -- $(ps -o args= -p "$p" 2>/dev/null); case "${1##*/}" in [Pp]ython*) ;; *) continue ;; esac; for w in $want; do [ "${2:-}" = "$w" ] && kill "$p" 2>/dev/null; done; done; true'
restart_ticker() {  # the cron ticker keeps the code it first loaded; its loop starts it again. Only between jobs.
  kill_ticker "$PLUGIN_TICKER $OLD_TICKER_FILE"
}
# A ticker still running an older install's file itself (the stand-in replaces its own arguments with the plugin's
# copy at once, so only old code runs that way). Its loop then starts the stand-in. Only between jobs; tried again on
# every check while the plugin is current.
stop_old_ticker() { kill_ticker "$OLD_TICKER_FILE"; }
kill_ticker() {  # FILES
  working && return 0
  if [ "$("$HOME/bin/hermes-debian" --which 2>/dev/null)" = chroot ]; then
    su -c "want='$1'; $TICKER_KILL" </dev/null >/dev/null 2>&1
  else want=$1 sh -c "$TICKER_KILL" >/dev/null 2>&1; fi
  return 0
}
settle() {  # STAMP: a swap whose run was cut off: keep it when the new plugin serves, else go back
  if wait_serves "$1" "${HM_PLUGIN_SETTLE:-45}"; then deb commit | last >/dev/null; return 0; fi
  # Only when Hermes answers, plainly without the new plugin, and has no work: else leave it for a later run.
  if ! dash_up || working; then say BUSY settling; exit 0; fi
  deb rollback | last >/dev/null; restart
}

usage() { echo "usage: plugin-update.sh check|apply|source-stamp|stamp|pack|assemble|hash|embed|age-parts ..." >&2; exit 2; }
# DIR DEST [PHONE]: DEST (new) = the plugin folder DIR without caches and stamp; with PHONE, the Termux scripts named in
# SCRIPTS are copied from there into DEST/phone-scripts (all of them, or it fails).
copy_plugin() {
  local p n
  p=$(mktemp -d "${TMPDIR:-/tmp}/hm-copy.XXXXXX") || return 1
  COPYFILE_DISABLE=1 tar -cf - --exclude __pycache__ --exclude .DS_Store --exclude BUILD_STAMP -C "$(dirname "$1")" "$(basename "$1")" \
    | tar -xf - -C "$p" && mv "$p/$(basename "$1")" "$2" || { rm -rf "$p"; return 1; }
  rmdir "$p"
  [ -n "${3:-}" ] || return 0
  rm -rf "$2/phone-scripts"; mkdir "$2/phone-scripts" || return 1
  for n in $SCRIPTS; do
    [ -f "$3/$n" ] && cp "$3/$n" "$2/phone-scripts/$n" && chmod 755 "$2/phone-scripts/$n" || return 1
  done
}
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
# Copies the Termux scripts of the installed plugin (phone-scripts/) to ~/bin: only what the Debian half lists with its
# SHA-256, read through hermes-debian (under chroot only root can read Debian's files) into X.tmp, checked against that
# SHA-256 and renamed over ~/bin/X, so a running copy is never changed under it. A copy that is already the same is left
# alone (a second run changes nothing). Unlike sync_services it also creates a script that is missing, because installs
# from before this never had hm-local. Like sync_services, it leaves a copy changed by hand alone: one that no longer
# matches what was last copied from a plugin (~/.hermes-mobile/scripts.sha, which install.sh removes), and never follows
# or writes through a link (~/bin/X or X.tmp). Prints one SCRIPTS line before the run's last line and never fails the run.
PLUGIN_DIR="${HM_PLUGIN_ROOT:-/root/.hermes}/plugins/hermes-mobile"
SCRIPTS_SHA="$TERMUX_HOME/.hermes-mobile/scripts.sha"  # "NAME SHA256" per script last copied from a plugin
deb_cat() {  # DEBIAN_PATH: the file's bytes on stdout
  if [ -x "$HOME/bin/hermes-debian" ]; then tmo 60 "$HOME/bin/hermes-debian" cat -- "$1" </dev/null
  else tmo 60 proot-distro login debian -- cat -- "$1" </dev/null; fi
}
known_sha() { sed -n "s/^$1 \([0-9a-f]\{64\}\)\$/\1/p" "$SCRIPTS_SHA" 2>/dev/null | tail -1; }
note_sha() {  # NAME SHA
  { grep -v "^$1 " "$SCRIPTS_SHA" 2>/dev/null; echo "$1 $2"; } > "$SCRIPTS_SHA.tmp" && mv -f "$SCRIPTS_SHA.tmp" "$SCRIPTS_SHA"
}
sync_scripts() {
  local list n want f tmp have known bad=""
  list=$(deb scripts $SCRIPTS 2>/dev/null)
  printf '%s\n' "$list" | grep -qx 'HMPLUGIN LISTED' || { say SCRIPTS fail no-answer; return 0; }
  mkdir -p "$HOME/bin" 2>/dev/null
  for n in $SCRIPTS; do
    want=$(printf '%s\n' "$list" | sed -n "s/^HMPLUGIN SCRIPT $n \([0-9a-f]\{64\}\)\$/\1/p" | tail -1)
    [ -n "$want" ] || { bad=${bad:-missing}; continue; }
    f="$HOME/bin/$n"; tmp="$f.tmp"
    # A link, or something that is no plain file: not ours to replace.
    if [ -L "$f" ] || { [ -e "$f" ] && [ ! -f "$f" ]; } || [ -L "$tmp" ]; then bad=${bad:-changed}; continue; fi
    if [ -f "$f" ]; then
      have=$(sha "$f" | cut -d' ' -f1)
      if [ "$have" = "$want" ]; then [ -x "$f" ] || chmod 755 "$f"; note_sha "$n" "$want"; continue; fi
      known=$(known_sha "$n")
      if [ -n "$known" ] && [ "$known" != "$have" ]; then bad=${bad:-changed}; continue; fi
    fi
    rm -f "$tmp"
    if (set -C; deb_cat "$PLUGIN_DIR/phone-scripts/$n" > "$tmp") 2>/dev/null && [ "$(sha "$tmp" | cut -d' ' -f1)" = "$want" ] \
      && chmod 755 "$tmp" && mv -f "$tmp" "$f"; then note_sha "$n" "$want"; else rm -f "$tmp"; bad=${bad:-copy}; fi
  done
  if [ -z "$bad" ]; then say SCRIPTS ok; else say SCRIPTS fail "$bad"; fi
  return 0
}
scripts_if_current() {  # the plugin's state line: a current plugin's scripts (a copy that failed before is tried again)
  case "$1" in "HMPLUGIN STATE current "*|"HMPLUGIN STATE adopted "*) sync_scripts; deb tickershim >/dev/null 2>&1; stop_old_ticker ;; esac
  return 0
}
inspect() {  # APK_STAMP APK_HASH FORCE: settles an interrupted swap first; sets $line and $legacy
  local out
  out=$(deb inspect "$@")
  line=$(printf '%s\n' "$out" | last)
  case "$line" in
    "HMPLUGIN PENDING "*) settle "${line##* }"; out=$(deb inspect "$@"); line=$(printf '%s\n' "$out" | last) ;;
  esac
  # The one exception (see token): an older plugin by its own stamp on disk, whose guard has no hello on disk either.
  legacy=no; blind=no
  [ -n "$restarted" ] && return 0  # a settle restarted Hermes: the exception is over for this run
  case "$line" in
    "HMPLUGIN STATE older "*) printf '%s\n' "$out" | grep -qx 'HMPLUGIN GUARD old' || return 0 ;;
    *) return 0 ;;
  esac
  # Once the app has ended the compatibility window (~/.hermes-mobile/enforced), never the raw key: only hm-local is
  # used. Then this old guard can't be asked at all (`blind`): see apply for what that changes.
  if [ -e "$TERMUX_HOME/.hermes-mobile/enforced" ]; then blind=yes; else legacy=yes; fi
  return 0
}

cmd=${1:-}; [ $# -gt 0 ] && shift
case "$cmd" in
  hash) [ -d "${1:-}" ] || usage; tree_hash "$1" ;;
  age-parts)  # etime VALUE | stat LINE UPTIME HZ: the age rules alone (for the tests)
    case "${1:-}" in etime) etime_seconds "${2:-}" ;; stat) stat_age "${2:-}" "${3:-}" "${4:-}" ;; *) usage ;; esac ;;
  embed)
    [ -f "${1:-}" ] && [ -n "${2:-}" ] || usage
    b=$(base64 < "$1" | tr -d '\n')
    sed "s|^SERVICES_B64=.*|SERVICES_B64=\"$b\"|" "$0" > "$2" ;;
  stamp)
    [ -d "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || usage
    printf '%s %s %s\n' "$2" "$(tree_hash "$1")" "$3" > "$1/BUILD_STAMP" ;;
  source-stamp)
    [ -d "${1:-}" ] || usage
    if [ -e "$1/.git" ] && [ -z "$(git -C "$1" status --porcelain -- hermes-plugin/hermes-mobile $(for n in $SCRIPTS; do echo "phone/$n"; done) 2>/dev/null)" ] \
      && t=$(git -C "$1" log -1 --format=%ct 2>/dev/null) && [ -n "$t" ]; then echo "$t"; else date +%s; fi ;;
  assemble)
    [ -d "${1:-}" ] && [ -d "${2:-}" ] && [ -n "${3:-}" ] && [ ! -e "$3" ] || usage
    copy_plugin "$1" "$3" "$2" || { rm -rf "$3"; exit 1; } ;;
  pack)
    [ -d "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || usage
    [ -z "${4:-}" ] || [ -d "$4" ] || usage
    t=$(mktemp -d "${TMPDIR:-/tmp}/hm-plugin.XXXXXX") || exit 1
    copy_plugin "$1" "$t/hermes-mobile" "${4:-}" || { rm -rf "$t"; exit 1; }
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
    scripts_if_current "$line"
    echo "${line:-HMPLUGIN FAIL check no-answer}" ;;
  apply)
    [ $# -ge 4 ] || usage; valid "$1" "$2"; valid "$1" "$3"; valid "$1" "$4"
    stamp=$1 hash=$2 want=$3 tok=$4 force=no user=no confirmed=no
    for a in "${@:5}"; do case "$a" in --force) force=force ;; --user) user=yes ;; --confirmed) confirmed=yes ;; *) usage ;; esac; done
    take_lock
    inspect "$stamp" "$hash" "$force"
    # This run settled an interrupted swap by rolling it back (and restarted Hermes): it can't check Hermes's work or the
    # new plugin any more (that took the old guard's answer before the restart), so a fresh run does the update.
    if [ -n "$restarted" ]; then say BUSY settled; exit 0; fi
    sync_services "$line"
    scripts_if_current "$line"
    case "$line" in
      "HMPLUGIN STATE older "*) ;;
      "") say FAIL check no-answer; exit 0 ;;
      *) echo "$line"; exit 0 ;;
    esac
    if working; then say BUSY working; exit 0; fi
    # An old guard after the switch (`blind`) can't say whether Hermes works, and the app can't either (that plugin's
    # beats are refused). While its dashboard answers, only a run the user asked for AND confirmed after being told that
    # a running answer or job may be cut off (--user --confirmed, set only by the app's dialog) goes on; anything else
    # waits ("BUSY unknown"), so a turn is never cut by a restart the user didn't knowingly ask for.
    if [ "$blind" = yes ] && { [ "$user" != yes ] || [ "$confirmed" != yes ]; } && dash_up; then say BUSY unknown; exit 0; fi
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
    # A blind old guard never serves the plugin's routes to us, so it counts as loaded when its dashboard answers at all
    # (dash_up: hm-local's "no hello" from a running dashboard); the new plugin speaks the hello, so after the restart
    # it is verified (or rolled back) like any other.
    if [ "$blind" = yes ]; then wait_up "${HM_PLUGIN_UP_WAIT:-20}" dash && loaded=1 || loaded=0
    else wait_up "${HM_PLUGIN_UP_WAIT:-20}" && loaded=1 || loaded=0; fi
    r=$(deb swap "$stamp" | last)
    [ "$r" = "HMPLUGIN SWAPPED" ] || { echo "${r:-HMPLUGIN FAIL swap no-answer}"; exit 0; }
    # A turn that started during the swap: put the old plugin back (no restart was made) and wait for another moment.
    # The old plugin's dashboard still runs here, so this busy check still asks its guard the old way (legacy).
    if working; then deb rollback >/dev/null; say BUSY working; exit 0; fi
    # From the restart on, the dashboard on the port is the new plugin's (or nothing we can trust): never the raw key
    # again in this run, even after a rollback.
    legacy=no; forget_client
    restart
    if [ "$loaded" = 0 ]; then
      deb commit >/dev/null
      restart_ticker  # the old ticker's loop now starts the stand-in, which runs the new copy
      sync_scripts
      say OK "$stamp" unverified
    elif wait_up "$WAIT" dash && wait_serves "$stamp" "$LOAD_WAIT"; then
      deb commit >/dev/null
      restart_ticker
      sync_scripts
      say OK "$stamp"
    else
      deb rollback >/dev/null
      forget_client
      restart
      # "rolled-back": restarted with the old plugin, its process running and the port answering; nothing more is known.
      wait_up "$BACK_WAIT" back && say FAIL load rolled-back || say FAIL load rolled-back-not-up
    fi ;;
  *) usage ;;
esac
