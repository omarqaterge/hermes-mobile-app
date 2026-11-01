#!/bin/bash
# One session at a time per phone or emulator. Sessions working in parallel share the same devices over adb; two of them
# installing or tapping on one device at once break each other's tests. A session takes the device's lock before it
# installs, taps or tests there and releases it after. The lock is a directory (mkdir is atomic) holding who has it and
# until when; it expires by itself, so a session that died never blocks the device for long.
#
# Usage:
#   tools/device-lock.sh hold SERIAL WHO [MINUTES]   take or extend the lock (default 30 min, at most 240); exit 75 if
#                                                    someone else holds it, and say who and until when
#   tools/device-lock.sh release SERIAL WHO          give it back (only the holder can)
#   tools/device-lock.sh run SERIAL WHO CMD...       hold, run CMD, release, even when CMD fails; CMD's exit code
#   tools/device-lock.sh status                      every lock that is held now
# SERIAL is what `adb devices` prints (emulator-5554, 192.168.1.5:5555…); WHO names the session, for example its branch.
# Locks live in $HM_DEVICE_LOCKS (default ~/.cache/hermes-mobile/device-locks), outside every worktree.
set -uo pipefail
DIR=${HM_DEVICE_LOCKS:-$HOME/.cache/hermes-mobile/device-locks}
BUSY=75

usage() { sed -n '7,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
now() { date +%s; }
# a serial becomes one safe directory name: 192.168.1.5:5555 → 192.168.1.5_5555
name() { printf %s "$1" | tr -c 'A-Za-z0-9._-' '_'; }
field() { sed -n "s/^$2=//p" "$1/owner" 2>/dev/null; }
expired() { local u; u=$(field "$1" until); [ -z "$u" ] || [ "$u" -le "$(now)" ]; }
show() { local d=$1; echo "$(basename "$d"): $(field "$d" who) until $(date -r "$(field "$d" until)" '+%H:%M' 2>/dev/null || date -d "@$(field "$d" until)" '+%H:%M')"; }

hold() {
  local serial=${1:?SERIAL}; local who=${2:?WHO}; local min=${3:-30}
  case $min in ''|*[!0-9]*) echo "MINUTES must be a number"; return 2;; esac
  [ "$min" -ge 1 ] && [ "$min" -le 240 ] || { echo "MINUTES must be 1 to 240"; return 2; }
  local d; d="$DIR/$(name "$serial")"
  mkdir -p "$DIR"
  local try
  for try in 1 2; do
    if mkdir "$d" 2>/dev/null; then
      printf 'who=%s\nuntil=%s\n' "$who" "$(( $(now) + min * 60 ))" > "$d/owner.tmp" && mv "$d/owner.tmp" "$d/owner"
      echo "device-lock: $serial is yours until $(date -r "$(field "$d" until)" '+%H:%M' 2>/dev/null || date -d "@$(field "$d" until)" '+%H:%M')"
      return 0
    fi
    if [ "$(field "$d" who)" = "$who" ]; then
      # the holder extends its own lock
      printf 'who=%s\nuntil=%s\n' "$who" "$(( $(now) + min * 60 ))" > "$d/owner.tmp" && mv "$d/owner.tmp" "$d/owner"
      echo "device-lock: $serial extended"; return 0
    fi
    if expired "$d"; then
      # a session that died or forgot to release: take it over (if two do at once, mkdir lets only one win)
      rm -rf "$d"; continue
    fi
    break
  done
  echo "device-lock: $serial is busy: $(show "$d")"
  return $BUSY
}

release() {
  local serial=${1:?SERIAL}; local who=${2:?WHO}
  local d; d="$DIR/$(name "$serial")"
  [ -d "$d" ] || { echo "device-lock: $serial was not locked"; return 0; }
  if [ "$(field "$d" who)" != "$who" ] && ! expired "$d"; then
    echo "device-lock: $serial is held by $(field "$d" who), not $who"; return 1
  fi
  rm -rf "$d"; echo "device-lock: $serial released"
}

status() {
  local d n=0
  for d in "$DIR"/*/; do
    [ -d "$d" ] || continue
    d=${d%/}
    if expired "$d"; then continue; fi
    show "$d"; n=$((n+1))
  done
  [ $n -gt 0 ] || echo "device-lock: no device is locked"
}

cmd=${1:-}; [ $# -gt 0 ] && shift
case $cmd in
  hold) [ $# -ge 2 ] || usage; hold "$@";;
  release) [ $# -eq 2 ] || usage; release "$@";;
  run)
    [ $# -ge 3 ] || usage
    serial=$1; who=$2; shift 2
    hold "$serial" "$who" || exit $?
    "$@"; rc=$?
    release "$serial" "$who" >/dev/null
    exit $rc;;
  status) status;;
  *) usage;;
esac
