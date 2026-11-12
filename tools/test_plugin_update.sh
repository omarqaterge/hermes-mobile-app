#!/usr/bin/env bash
# Checks phone/plugin-update.sh (the app's plugin update, PluginSync.java) against a fake Termux, a fake Debian (a
# folder) and a fake Hermes dashboard (a small Python server that "loads" the plugin when hermes-debian --restart runs):
# an old plugin is replaced and every profile linked, a current, newer, hand-changed or held one is left alone, nothing
# is touched while Hermes works, a bad bundle or token installs nothing, a plugin that doesn't load is rolled back, and
# an interrupted run is settled by the next one. No phone needed.  bash tools/test_plugin_update.sh
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
S="$here/phone/plugin-update.sh"
t=$(mktemp -d "${TMPDIR:-/tmp}/hm-plugin-test.XXXXXX")
t=$(cd -P "$t" && pwd -P)
fails=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
bash -n "$S" && echo "  ok   bash -n" || { echo "  FAIL bash -n"; fails=$((fails + 1)); }

export HOME="$t/home" HM_PLUGIN_ROOT="$t/deb/root/.hermes"
mkdir -p "$HOME/bin" "$HOME/.hermes-mobile" "$HM_PLUGIN_ROOT/plugins"
P="$HM_PLUGIN_ROOT/plugins/hermes-mobile" W="$HM_PLUGIN_ROOT/hermes-mobile-plugin"
# Fake hermes-debian: commands run here; --restart "loads" the installed plugin (its stamp) unless it contains BROKEN.
cat > "$HOME/bin/hermes-debian" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --which) echo proot ;;
  --restart) echo x >> "$t/restarts"
    # Like the real one: kill by the dashboard's command line (the app runs the script as \`bash -c TEXT\`).
    pkill -9 -f 'hermes dashboard --host 127.0.0.1 --port 9119' 2>/dev/null
    if [ -f "$P/BROKEN" ] || [ ! -f "$P/plugin.yaml" ]; then rm -f "$t/loaded"
    else s=\$(cut -d' ' -f1 "$P/BUILD_STAMP" 2>/dev/null); echo "\${s:-0}" > "$t/loaded"; fi ;;
  # A copy out of Debian (the Termux scripts): counted; HM_FAKE_CAT=fail makes it fail, =noise gives other bytes.
  cat) echo x >> "$t/cats"
    case "\${HM_FAKE_CAT:-}" in fail) exit 1 ;; noise) echo noise; exit 0 ;; esac
    exec "\$@" ;;
  *) exec "\$@" ;;
esac
EOF
chmod +x "$HOME/bin/hermes-debian"

cat > "$t/server.py" <<'EOF'
import http.server, os, sys
T = sys.argv[1]
def read(name, default=None):
    try:
        return open(os.path.join(T, name), "rb").read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == "/":
            return self.send(200, b'<script>window.__HERMES_SESSION_TOKEN__ = "tok1";</script>', "text/html")
        if self.path.startswith("/plugin-bundle/"):
            ok = self.path == "/plugin-bundle/" + (read("token", b"") or b"").decode().strip()
            return self.send(200, read("bundle.tgz", b""), "application/gzip") if ok else self.send(403)
        loaded = read("loaded")
        if not self.path.startswith("/api/plugins/hermes-mobile/") or loaded is None:
            return self.send(404, b'{"detail":"Not Found"}')
        if self.headers.get("X-Hermes-Session-Token") != "tok1":
            return self.send(401, b'{"detail":"Unauthorized"}')
        r = self.path.rsplit("/", 1)[1]
        if r == "activity":
            return self.send(200, read("activity", b'{"items":[]}'))
        if r == "plugin-info" and loaded.strip() != b"0":
            return self.send(200, b'{"stamp":' + loaded.strip() + b',"hash":"x","source":"apk"}')
        return self.send(404, b'{"detail":"Not Found"}')
s = http.server.HTTPServer(("127.0.0.1", 0), H)
open(os.path.join(T, "port"), "w").write(str(s.server_port))
s.serve_forever()
EOF
python3 "$t/server.py" "$t" & srv=$!
trap 'kill $srv 2>/dev/null; wait $srv 2>/dev/null; rm -rf "$t"' EXIT
for _ in $(seq 50); do [ -s "$t/port" ] && break; sleep 0.1; done
port=$(cat "$t/port")
export HM_DASHBOARD="http://127.0.0.1:$port" HM_BUNDLE_URL="http://127.0.0.1:$port/plugin-bundle"
export HM_PLUGIN_WAIT=4 HM_PLUGIN_LOAD_WAIT=3 HM_PLUGIN_BACK_WAIT=3 HM_PLUGIN_SETTLE=3 HM_PLUGIN_POLL=0.3 HM_PLUGIN_UP_WAIT=1
echo aaa111 > "$t/token"

# The APK's plugin (stamp 2000000000) and an old one (a file changed, no BUILD_STAMP), like the Oct 30 copy on a phone.
NEW="$t/src/hermes-mobile"; mkdir -p "$t/src"; cp -R "$here/hermes-plugin/hermes-mobile" "$NEW"
find "$NEW" -name __pycache__ -prune -exec rm -rf {} +; rm -f "$NEW/BUILD_STAMP"
read -r STAMP HASH SHA <<< "$(bash "$S" pack "$NEW" "$t/bundle.tgz" 2000000000)"
check "pack prints the stamp" "$STAMP" 2000000000
check "hash ignores BUILD_STAMP" "$(bash "$S" hash "$NEW")" "$HASH"
OLD="$t/old"; cp -R "$NEW" "$OLD"; echo "# old" >> "$OLD/plugin.yaml"; rm -f "$OLD/google_workspace.py"
install_old() { rm -rf "$P" "$W"; cp -R "$OLD" "$P"; echo 0 > "$t/loaded"; }
# As the app runs it: the script's text as \`bash -c\` (so it is on the command line), name hm-plugin.
run() { bash -c "$(cat "$S")" hm-plugin "$@" 2>/dev/null | grep '^HMPLUGIN' | tail -1; }
same() { [ "$(bash "$S" hash "$P")" = "$1" ] && echo yes || echo no; }
OLDHASH=$(bash "$S" hash "$OLD")

echo "not set up yet"
check "no plugin folder" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE not-ready 0"

echo "an old plugin without a stamp is brought up to date"
install_old
mkdir -p "$HM_PLUGIN_ROOT/profiles/work/plugins/hermes-mobile" "$HM_PLUGIN_ROOT/profiles/linked/plugins"
ln -s "$P" "$HM_PLUGIN_ROOT/profiles/linked/plugins/hermes-mobile"
check "check says older" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE older 0"
check "check changed nothing" "$(same "$OLDHASH")" yes
check "apply" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
check "the files are the APK's" "$(same "$HASH")" yes
check "stamped" "$(cut -d' ' -f1 "$P/BUILD_STAMP")" "$STAMP"
check "the restarted Hermes serves it" "$(cat "$t/loaded")" "$STAMP"
check "a profile's stale copy became a link" "$(readlink "$HM_PLUGIN_ROOT/profiles/work/plugins/hermes-mobile")" "$P"
check "a linked profile stays linked" "$(readlink "$HM_PLUGIN_ROOT/profiles/linked/plugins/hermes-mobile")" "$P"
check "no leftovers" "$(ls "$W" 2>/dev/null | tr '\n' ' ')" ""
check "the bundle file is gone" "$(ls "$HOME/.hermes-mobile/plugin-bundle.tgz" 2>/dev/null)" ""
check "then current" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "apply again changes nothing" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN STATE current $STAMP"

echo "the same files without a stamp are adopted, with no restart"
rm -rf "$P"; cp -R "$NEW" "$P"; : > "$t/restarts"
check "adopted" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE adopted $STAMP"
check "no restart" "$(wc -l < "$t/restarts" | tr -d ' ')" 0

echo "never a downgrade, never over a hand-changed or held plugin"
rm -rf "$P"; cp -R "$NEW" "$P"; echo "# from a newer main" >> "$P/plugin.yaml"; bash "$S" stamp "$P" 2100000000 install; NEWER=$(bash "$S" hash "$P")
check "newer" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN STATE newer 2100000000"
check "newer with --force" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --force)" "HMPLUGIN STATE newer 2100000000"
check "newer untouched" "$(same "$NEWER")" yes
install_old; bash "$S" stamp "$P" 1900000000 install; echo "# edited" >> "$P/plugin.yaml"; EDITED=$(bash "$S" hash "$P")
check "modified" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN STATE modified 1900000000"
check "modified untouched" "$(same "$EDITED")" yes
mkdir -p "$W"; touch "$W/hold"
check "held" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --force)" "HMPLUGIN STATE held 1900000000"
rm -f "$W/hold"
check "modified, --force" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --force)" "HMPLUGIN OK $STAMP"

echo "nothing while Hermes works"
install_old; echo '{"items":[{"session":"s1","ts":1}]}' > "$t/activity"
check "busy" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN BUSY working"
check "busy untouched" "$(same "$OLDHASH")" yes
rm -f "$t/activity"

echo "only the APK's bundle"
check "wrong token" "$(run apply "$STAMP" "$HASH" "$SHA" bbb222)" "HMPLUGIN FAIL fetch no-bundle"
check "wrong checksum" "$(run apply "$STAMP" "$HASH" "$(printf '%064d' 0)" aaa111)" "HMPLUGIN FAIL fetch checksum"
check "untouched" "$(same "$OLDHASH")" yes
cp "$t/bundle.tgz" "$t/good.tgz"
BAD="$t/bad/hermes-mobile"; mkdir -p "$t/bad"; cp -R "$NEW" "$BAD"; echo "def broken(:" >> "$BAD/canvas.py"
read -r _ BH BS <<< "$(bash "$S" pack "$BAD" "$t/bundle.tgz" 2000000000)"
check "Python that doesn't compile" "$(run apply "$STAMP" "$BH" "$BS" aaa111)" "HMPLUGIN FAIL stage compile"
check "untouched after a bad bundle" "$(same "$OLDHASH")" yes
check "hash of another bundle" "$(run apply "$STAMP" "$HASH" "$BS" aaa111)" "HMPLUGIN FAIL stage hash"
cp "$t/good.tgz" "$t/bundle.tgz"

echo "a plugin that doesn't load is rolled back"
BRK="$t/brk/hermes-mobile"; mkdir -p "$t/brk"; cp -R "$NEW" "$BRK"; touch "$BRK/BROKEN"
read -r _ KH KS <<< "$(bash "$S" pack "$BRK" "$t/bundle.tgz" 2000000000)"
check "rolled back" "$(run apply "$STAMP" "$KH" "$KS" aaa111)" "HMPLUGIN FAIL load rolled-back"
check "the old plugin is back" "$(same "$OLDHASH")" yes
check "and loaded" "$(cat "$t/loaded" 2>/dev/null)" 0
check "no marker left" "$(ls "$W" 2>/dev/null | tr '\n' ' ')" ""
cp "$t/good.tgz" "$t/bundle.tgz"

echo "Hermes was down (no plugin loaded): installed, unverified"
install_old; rm -f "$t/loaded"
check "unverified" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP unverified"
check "files" "$(same "$HASH")" yes

echo "an interrupted run is settled by the next one"
install_old; mkdir -p "$W"; mv "$P" "$W/old"
check "cut between the renames: the old plugin is put back" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE older 0"
check "old in place" "$(same "$OLDHASH")" yes
install_old; mkdir -p "$W"; mv "$P" "$W/old"; cp -R "$NEW" "$P"; bash "$S" stamp "$P" "$STAMP" apk; printf %s "$STAMP" > "$W/pending"
echo "$STAMP" > "$t/loaded"
check "swapped, new one serves: kept" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "old copy removed" "$(ls "$W" | tr '\n' ' ')" ""
install_old; mkdir -p "$W"; mv "$P" "$W/old"; cp -R "$NEW" "$P"; bash "$S" stamp "$P" "$STAMP" apk; printf %s "$STAMP" > "$W/pending"
check "pending while Hermes doesn't answer: left for later" "$(D=$(cat "$t/port"); HM_DASHBOARD=http://127.0.0.1:1 run check "$STAMP" "$HASH")" "HMPLUGIN BUSY settling"
check "pending kept" "$(cat "$W/pending" 2>/dev/null)" "$STAMP"
check "swapped, new one never served: rolled back" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE older 0"
check "old in place again" "$(same "$OLDHASH")" yes

echo "one run at a time"
mkdir "$HOME/.hermes-mobile/plugin-update.lock"; echo 1 > "$HOME/.hermes-mobile/plugin-update.lock/pid"
check "busy" "$(run check "$STAMP" "$HASH")" "HMPLUGIN BUSY another-run"
check "another run's lock is left alone" "$(cat "$HOME/.hermes-mobile/plugin-update.lock/pid")" 1
rm -rf "$HOME/.hermes-mobile/plugin-update.lock"
check "a run removes its own lock" "$(run check "$STAMP" "$HASH" >/dev/null; ls "$HOME/.hermes-mobile/plugin-update.lock" 2>/dev/null)" ""
check "bad arguments" "$(bash "$S" apply 12 nothex 2>/dev/null; echo $?)" 2

echo "the supervisor script"
SVC="$HOME/bin/hermes-services"; SVCSHA="$HOME/.hermes-mobile/services.sha"; MARK="$HOME/.hermes-mobile/services-new"
printf '#!/usr/bin/env bash\n# new supervisor, hermes dashboard --host 127.0.0.1 --port 9119\nexit 0\n' > "$t/new-services"
printf '#!/usr/bin/env bash\n# old supervisor\nexit 0\n' > "$t/old-services"
E="$t/embedded.sh"; bash "$S" embed "$t/new-services" "$E"
bash -n "$E" && echo "  ok   the embedded script parses" || { echo "  FAIL the embedded script parses"; fails=$((fails + 1)); }
check "the embedded text doesn't hold the dashboard's command line" "$(grep -c 'hermes dashboard --host 127.0.0.1' "$E")" 0
check "it fits one argument of bash -c (128 KB)" "$(( $(bash "$S" embed "$here/phone/hermes-services" "$t/real.sh"; wc -c < "$t/real.sh") < 100000 ))" 1
erun() { bash -c "$(cat "$E")" hm-plugin "$@" 2>/dev/null | grep '^HMPLUGIN' | tail -1; }
reset_svc() { cp "$t/old-services" "$SVC"; chmod +x "$SVC"; rm -f "$SVCSHA" "$MARK" "$HOME/.hermes-mobile/hermes-services.bak"; }
install_old; cp -R "$NEW/." "$P/"; bash "$S" stamp "$P" "$STAMP" apk; reset_svc
check "the state line is unchanged" "$(erun check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "check installs the new script" "$(cmp -s "$SVC" "$t/new-services" && echo same)" same
check "it stays runnable" "$([ -x "$SVC" ] && echo yes)" yes
check "the old one is kept beside" "$(cmp -s "$HOME/.hermes-mobile/hermes-services.bak" "$t/old-services" && echo same)" same
check "no temporary file stays" "$(ls "$SVC.new" 2>/dev/null)" ""
check "it notes the loop is still old" "$([ -f "$MARK" ] && echo yes)" yes
rm -f "$MARK"; erun check "$STAMP" "$HASH" >/dev/null
check "already up to date: nothing happens" "$([ -f "$MARK" ] && echo yes || echo no)" no
echo "# my own change" >> "$SVC"; cp "$SVC" "$t/hand"; erun check "$STAMP" "$HASH" >/dev/null
check "a copy changed by hand is left alone" "$(cmp -s "$SVC" "$t/hand" && echo same)" same
rm -f "$SVCSHA"; erun check "$STAMP" "$HASH" >/dev/null
check "after install.sh (no record) it may be replaced" "$(cmp -s "$SVC" "$t/new-services" && echo same)" same
reset_svc; bash "$S" check "$STAMP" "$HASH" >/dev/null
check "the plain script (no copy inside) leaves it alone" "$(cmp -s "$SVC" "$t/old-services" && echo same)" same
rm -f "$SVC"; erun check "$STAMP" "$HASH" >/dev/null
check "no script yet: not created" "$(ls "$SVC" 2>/dev/null)" ""
reset_svc; touch "$W/hold" 2>/dev/null || { mkdir -p "$W"; touch "$W/hold"; }; erun check "$STAMP" "$HASH" >/dev/null
check "a held plugin: left alone" "$(cmp -s "$SVC" "$t/old-services" && echo same)" same
rm -f "$W/hold"
reset_svc; echo newer > "$P/from-a-newer-clone"; bash "$S" stamp "$P" "$((STAMP + 5))" install
check "a newer plugin" "$(erun check "$STAMP" "$HASH")" "HMPLUGIN STATE newer $((STAMP + 5))"
check "a newer plugin: left alone" "$(cmp -s "$SVC" "$t/old-services" && echo same)" same
rm -f "$P/from-a-newer-clone"; bash "$S" stamp "$P" "$STAMP" apk
printf '#!/usr/bin/env bash\nif then (\n' > "$t/bad-services"; bash "$S" embed "$t/bad-services" "$t/bad.sh"; reset_svc
bash -c "$(cat "$t/bad.sh")" hm-plugin check "$STAMP" "$HASH" >/dev/null
check "a copy that doesn't parse is never installed" "$(cmp -s "$SVC" "$t/old-services" && echo same; ls "$SVC.new" 2>/dev/null)" same
# apply: the script updates too, and the dashboard's loop starts again with Hermes's restart. The loop's check needs /proc.
install_old; reset_svc; echo 0 > "$t/loaded"
check "apply succeeds with the new script" "$(erun apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
check "apply installs it" "$(cmp -s "$SVC" "$t/new-services" && echo same)" same
check "the note is used up by the restart" "$([ -f "$MARK" ] && echo yes || echo no)" no
if [ -d /proc/self ]; then
  install_old; reset_svc; echo 0 > "$t/loaded"; mkdir -p "$HOME/logs"
  cp "$t/old-services" "$t/hermes-services"; printf 'sleep 300\n' >> "$t/hermes-services"; sed -i '/^exit 0/d' "$t/hermes-services"
  bash "$t/hermes-services" & lp=$!; echo "$lp" > "$HOME/logs/dashboard.pid"; sleep 0.3
  erun apply "$STAMP" "$HASH" "$SHA" aaa111 >/dev/null
  check "the old loop is stopped" "$(kill -0 "$lp" 2>/dev/null && echo alive || echo gone)" gone
  kill "$lp" 2>/dev/null; rm -f "$HOME/logs/dashboard.pid"
  sleep 300 & lp=$!; echo "$lp" > "$HOME/logs/dashboard.pid"; : > "$MARK"; install_old; bash "$S" stamp "$P" 1 apk; echo 0 > "$t/loaded"
  erun apply "$STAMP" "$HASH" "$SHA" aaa111 >/dev/null
  check "a reused pid that is no loop is not killed" "$(kill -0 "$lp" 2>/dev/null && echo alive || echo gone)" alive
  kill "$lp" 2>/dev/null; rm -f "$HOME/logs/dashboard.pid"
else echo "  skip the old loop is stopped (needs /proc; CI runs it)"; fi

echo "the Termux scripts travel inside the plugin"
read -r _ SH SS <<< "$(bash "$S" pack "$NEW" "$t/scripts.tgz" 2000000100 "$here/phone")"
listed=$(tar -tzf "$t/scripts.tgz" | sed 's|^\./||; s|/$||' | sort)
for n in hm-local hm-shizuku; do
  check "the bundle has phone-scripts/$n" "$(printf '%s\n' "$listed" | grep -cx "hermes-mobile/phone-scripts/$n")" 1
done
mkdir -p "$t/unpacked"; tar -xzf "$t/scripts.tgz" -C "$t/unpacked"
check "the bundle's hm-local is phone/hm-local" "$(cmp -s "$t/unpacked/hermes-mobile/phone-scripts/hm-local" "$here/phone/hm-local" && echo same)" same
check "the bundle's hm-shizuku is phone/hm-shizuku" "$(cmp -s "$t/unpacked/hermes-mobile/phone-scripts/hm-shizuku" "$here/phone/hm-shizuku" && echo same)" same
check "nothing else in phone-scripts/" "$(ls "$t/unpacked/hermes-mobile/phone-scripts" | tr '\n' ' ')" "hm-local hm-shizuku "
# Once the cron ticker lives in the plugin folder, it is in the bundle as a plugin file and needs no copy step.
if [ -f "$here/hermes-plugin/hermes-mobile/cron_ticker.py" ]; then
  check "the bundle has the cron ticker" "$(printf '%s\n' "$listed" | grep -cx hermes-mobile/cron_ticker.py)" 1
fi
check "a missing script fails the pack" "$(mkdir -p "$t/half"; cp "$here/phone/hm-local" "$t/half/"; bash "$S" pack "$NEW" "$t/half.tgz" 1 "$t/half" >/dev/null 2>&1; echo $?)" 1
bash "$S" assemble "$NEW" "$here/phone" "$t/assembled"
check "assemble (install.sh) gives the same files as the APK's bundle" "$(bash "$S" hash "$t/assembled")" "$SH"
check "assemble never writes over a folder" "$(bash "$S" assemble "$NEW" "$here/phone" "$t/assembled" 2>/dev/null; echo $?)" 2
check "android/build.sh packs the Termux scripts" "$(grep -A1 'plugin-update.sh pack ../hermes-plugin/hermes-mobile' "$here/android/build.sh" | grep -c ' \.\./phone > assets/phone/plugin.txt$')" 1
check "install.sh installs the assembled plugin" "$(grep -c 'plugin-update.sh" assemble "$here/hermes-plugin/hermes-mobile" "$here/phone"' "$here/phone/install.sh")" 1
check "install.sh forgets the scripts' record (its copies may be replaced)" "$(grep -c '^rm -f "$HOME/.hermes-mobile/scripts.sha"' "$here/phone/install.sh")" 1
check "install.sh stops when the plugin can't be assembled with its scripts" "$(grep -A1 'plugin-update.sh" assemble' "$here/phone/install.sh" | grep -c '|| { rm -rf "$stage"; die ')" 1
check "install.sh no longer copies a ticker of its own (it is in the plugin folder)" "$(grep -c 'cron_ticker' "$here/phone/install.sh")" 0
check "install.sh copies hm-local to ~/bin" "$(grep -c '^cp "$here/phone/hm-local" "$HOME/bin/hm-local"' "$here/phone/install.sh")" 1
runall() { bash -c "$(cat "$S")" hm-plugin "$@" 2>/dev/null | grep '^HMPLUGIN'; }
scripts_line() { printf '%s\n' "$1" | grep '^HMPLUGIN SCRIPTS' | tr '\n' ' ' | sed 's/ $//'; }
cp "$t/scripts.tgz" "$t/bundle.tgz"
BIN="$HOME/bin"; rm -f "$BIN/hm-local" "$BIN/hm-shizuku" "$t/cats"
install_old; rm -f "$W/hold"; echo 0 > "$t/loaded"
o=$(runall check 2000000100 "$SH")
check "check on an older plugin copies nothing" "$(scripts_line "$o")" ""
o=$(runall apply 2000000100 "$SH" "$SS" aaa111)
check "apply: the last line is still the result" "$(printf '%s\n' "$o" | tail -1)" "HMPLUGIN OK 2000000100"
check "apply: SCRIPTS ok before it" "$(scripts_line "$o")" "HMPLUGIN SCRIPTS ok"
check "~/bin/hm-local is phone/hm-local" "$(cmp -s "$BIN/hm-local" "$here/phone/hm-local" && echo same)" same
check "~/bin/hm-shizuku is phone/hm-shizuku" "$(cmp -s "$BIN/hm-shizuku" "$here/phone/hm-shizuku" && echo same)" same
check "both are executable" "$([ -x "$BIN/hm-local" ] && [ -x "$BIN/hm-shizuku" ] && echo yes)" yes
check "no temporary file stays" "$(ls "$BIN" | grep -c '\.tmp$')" 0
rm -f "$t/cats"
o=$(runall check 2000000100 "$SH")
check "check again: SCRIPTS ok" "$(scripts_line "$o")" "HMPLUGIN SCRIPTS ok"
check "already the same: nothing is copied again" "$(cat "$t/cats" 2>/dev/null | wc -l | tr -d ' ')" 0
check "check's last line is the state" "$(printf '%s\n' "$o" | tail -1)" "HMPLUGIN STATE current 2000000100"
RECORD="$HOME/.hermes-mobile/scripts.sha"
check "the copies are recorded" "$(grep -c '^hm-local [0-9a-f]\{64\}$' "$RECORD") $(grep -c '^hm-shizuku [0-9a-f]\{64\}$' "$RECORD")" "1 1"
sha_of() { python3 -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"; }
# An older plugin's copy: old bytes, recorded as what that plugin delivered.
old_copy() {
  printf '#!/bin/sh\necho old\n' > "$BIN/hm-local"; chmod 755 "$BIN/hm-local"
  { grep -v '^hm-local ' "$RECORD" 2>/dev/null; echo "hm-local $(sha_of "$BIN/hm-local")"; } > "$RECORD.n"; mv "$RECORD.n" "$RECORD"
}
old_copy; cp "$BIN/hm-local" "$t/old-hm-local"
o=$(HM_FAKE_CAT=fail runall check 2000000100 "$SH")
check "a copy that fails: SCRIPTS fail copy" "$(scripts_line "$o")" "HMPLUGIN SCRIPTS fail copy"
check "…and the run still ends with its state" "$(printf '%s\n' "$o" | tail -1)" "HMPLUGIN STATE current 2000000100"
check "…and the old copy is left whole" "$(cmp -s "$BIN/hm-local" "$t/old-hm-local" && echo same)" same
o=$(HM_FAKE_CAT=noise runall check 2000000100 "$SH")
check "a copy with other bytes: SCRIPTS fail copy" "$(scripts_line "$o")" "HMPLUGIN SCRIPTS fail copy"
check "…the old copy is left whole, no temporary file" "$(cmp -s "$BIN/hm-local" "$t/old-hm-local" && echo same; ls "$BIN" | grep -c '\.tmp$')" "same
0"
o=$(runall apply 2000000100 "$SH" "$SS" aaa111)
check "an older plugin's copy is replaced when the plugin is current (apply)" "$(scripts_line "$o"):$(cmp -s "$BIN/hm-local" "$here/phone/hm-local" && echo same)" "HMPLUGIN SCRIPTS ok:same"
echo "# my own change" >> "$BIN/hm-local"; cp "$BIN/hm-local" "$t/hand"
o=$(runall check 2000000100 "$SH")
check "a copy changed by hand is left alone: SCRIPTS fail changed" "$(scripts_line "$o"):$(cmp -s "$BIN/hm-local" "$t/hand" && echo same)" "HMPLUGIN SCRIPTS fail changed:same"
check "…the other script is still in step" "$(cmp -s "$BIN/hm-shizuku" "$here/phone/hm-shizuku" && echo same)" same
rm -f "$RECORD"
o=$(runall check 2000000100 "$SH")
check "after install.sh (no record) it may be replaced" "$(scripts_line "$o"):$(cmp -s "$BIN/hm-local" "$here/phone/hm-local" && echo same)" "HMPLUGIN SCRIPTS ok:same"
printf '#!/bin/sh\necho mine\n' > "$t/mine"; rm -f "$BIN/hm-local"; ln -s "$t/mine" "$BIN/hm-local"
o=$(runall check 2000000100 "$SH")
check "a link at ~/bin/hm-local: left alone, never written through" "$(scripts_line "$o"):$([ -L "$BIN/hm-local" ] && echo link):$(tail -1 "$t/mine")" "HMPLUGIN SCRIPTS fail changed:link:echo mine"
rm -f "$BIN/hm-local"; ln -s "$t/mine" "$BIN/hm-local.tmp"
o=$(runall check 2000000100 "$SH")
check "a link at ~/bin/hm-local.tmp: nothing written through it" "$(scripts_line "$o"):$(tail -1 "$t/mine")" "HMPLUGIN SCRIPTS fail changed:echo mine"
rm -f "$BIN/hm-local.tmp"
install_old; echo 0 > "$t/loaded"; old_copy
o=$(HM_FAKE_CAT=fail runall apply 2000000100 "$SH" "$SS" aaa111)
check "apply whose copy fails: the update still succeeds" "$(printf '%s\n' "$o" | tail -1)" "HMPLUGIN OK 2000000100"
check "…with SCRIPTS fail copy" "$(scripts_line "$o")" "HMPLUGIN SCRIPTS fail copy"
check "…and the new plugin stays" "$(same "$SH")" yes
o=$(runall check 2000000100 "$SH")
check "the next check copies it" "$(scripts_line "$o"):$(cmp -s "$BIN/hm-local" "$here/phone/hm-local" && echo same)" "HMPLUGIN SCRIPTS ok:same"
mkdir -p "$W"; touch "$W/hold"; old_copy
o=$(runall check 2000000100 "$SH")
check "a held plugin: no copy" "$(scripts_line "$o"):$(cmp -s "$BIN/hm-local" "$t/old-hm-local" && echo same)" ":same"
rm -f "$W/hold"
cp "$t/good.tgz" "$t/bundle.tgz"; install_old; echo 0 > "$t/loaded"
o=$(runall apply "$STAMP" "$HASH" "$SHA" aaa111)
check "a bundle without the scripts: SCRIPTS fail missing, the update still succeeds" "$(scripts_line "$o") / $(printf '%s\n' "$o" | tail -1)" "HMPLUGIN SCRIPTS fail missing / HMPLUGIN OK $STAMP"
echo "the cron ticker restarts after an update, whichever copy runs"
fake_ticker() { python3 -c 'import time; time.sleep(300)' "$1" >/dev/null 2>&1 & echo $!; }
alive() { kill -0 "$1" 2>/dev/null && echo alive || echo gone; }
tp=$(fake_ticker /root/.hermes/plugins/hermes-mobile/cron_ticker.py)
ts=$(fake_ticker /root/.hermes/scripts/cron_ticker.py)
to=$(fake_ticker /root/.hermes/elsewhere/cron_ticker.py)
sleep 0.3
cp "$t/good.tgz" "$t/bundle.tgz"; install_old; echo 0 > "$t/loaded"
check "an update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
sleep 0.3
check "the plugin's own ticker is stopped (its loop starts the new code)" "$(alive "$tp")" gone
check "an older install's ticker in scripts/ is stopped" "$(alive "$ts")" gone
check "another process with that file name is left alone" "$(alive "$to")" alive
kill "$tp" "$ts" "$to" 2>/dev/null; wait "$tp" "$ts" "$to" 2>/dev/null
check "the APK's copy of this script fits one argument (128 KiB): $(bash "$S" embed "$here/phone/hermes-services" "$t/size.sh"; wc -c < "$t/size.sh" | tr -d ' ') bytes" "$(( $(wc -c < "$t/size.sh") < 131072 ))" 1

echo "source-stamp"
check "not a checkout: now" "$(( $(bash "$S" source-stamp "$t") >= $(date +%s) - 5 ))" 1

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
