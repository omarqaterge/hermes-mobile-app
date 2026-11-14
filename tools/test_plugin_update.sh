#!/usr/bin/env bash
# Checks phone/plugin-update.sh (the app's plugin update, PluginSync.java) against a fake Termux, a fake Debian (a
# folder) and a fake Hermes dashboard (a small Python server that "loads" the plugin when hermes-debian --restart runs):
# an old plugin is replaced and every profile linked, a current, newer, hand-changed or held one is left alone, nothing
# is touched while Hermes works, a bad bundle or token installs nothing, a plugin that doesn't load is rolled back, and
# an interrupted run is settled by the next one. The dashboard's token comes from `hm-local token` (local authentication:
# the fake's new guard proves the key), and the raw key goes only to an old plugin's guard during apply, before any
# restart and while the dashboard's process runs, never on a command line, never in any other case. No phone needed.
#   bash tools/test_plugin_update.sh
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
  --which) echo "\${HM_FAKE_WHICH:-proot}" ;;
  --restart) echo x >> "$t/restarts"
    # HM_FAKE_HOLD: from this restart on, something that isn't Hermes answers on the dashboard's port.
    [ -n "\${HM_FAKE_HOLD:-}" ] && touch "$t/holder"
    # Like the real one: kill by the dashboard's command line (the app runs the script as \`bash -c TEXT\`).
    pkill -9 -f 'hermes dashboard --host 127.0.0.1 --port 9119' 2>/dev/null
    # The stand-in dashboard process of this run (on the fake's own port: other runs' processes are left alone).
    pkill -9 -f "hermes dashboard --host 127.0.0.1 --port \$(cat "$t/port") --no-open" 2>/dev/null
    # Hermes's dashboard process (a stand-in with its command line), unless something else holds the port now.
    [ -n "\${HM_FAKE_HOLD:-}" ] || "$t/dashproc"
    if [ -f "$P/BROKEN" ] || [ ! -f "$P/plugin.yaml" ]; then rm -f "$t/loaded"
    else s=\$(cut -d' ' -f1 "$P/BUILD_STAMP" 2>/dev/null); echo "\${s:-0}" > "$t/loaded"; fi ;;
  # A copy out of Debian (the Termux scripts): counted; HM_FAKE_CAT=fail makes it fail, =noise gives other bytes.
  cat) echo x >> "$t/cats"
    case "\${HM_FAKE_CAT:-}" in fail) exit 1 ;; noise) echo noise; exit 0 ;; esac
    exec "\$@" ;;
  # HM_FAKE_BUSY_AFTER_SWAP: a turn starts right after the swap (before the restart).
  *) if [ -n "\${HM_FAKE_BUSY_AFTER_SWAP:-}" ] && [ "\${5:-}" = swap ]; then
       "\$@"; rc=\$?; echo '{"items":[{"session":"s9","ts":1}]}' > "$t/activity"; exit \$rc
     fi
     exec "\$@" ;;
esac
EOF
chmod +x "$HOME/bin/hermes-debian"
# A process with the dashboard's command line for the fake's port (what plugin-update.sh looks for before the old guard
# gets the raw key); started once the fake listens.
printf '#!/usr/bin/env bash\n(exec -a "hermes dashboard --host 127.0.0.1 --port $(cat "%s/port") --no-open" sleep 900 </dev/null >/dev/null 2>&1 &)\n' "$t" > "$t/dashproc"
chmod +x "$t/dashproc"
# Every curl call's arguments are recorded (the key must never be among them).
mkdir -p "$t/shim"; real_curl=$(command -v curl)
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "%s/curl-argv"\nexec "%s" "$@"\n' "$t" "$real_curl" > "$t/shim/curl"
chmod +x "$t/shim/curl"; export PATH="$t/shim:$PATH"
# su (chroot only): records what it is asked to run, runs nothing (no root here).
printf '#!/usr/bin/env bash\n[ "$1" = -c ] && printf "%%s\\n" "$2" >> "%s/su-args"\nexit 1\n' "$t" > "$t/shim/su"; chmod +x "$t/shim/su"

# The fake dashboard's guard: the loaded plugin's stamp 0 is an old plugin (the page keeps the token only for the raw key,
# no hello); any other stamp is a new one (the hello and token routes, from local_auth.py's server halves; the page still
# honours the raw key, as before enforcement). Every raw key it receives is noted with the loaded stamp in rawkey.log.
cat > "$t/server.py" <<'EOF'
import http.server, importlib.util, json, os, sys
T, LA = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("la", LA); la = importlib.util.module_from_spec(spec); spec.loader.exec_module(la)
pending = la.PendingHellos()
KEYF = os.path.join(os.environ["HOME"], ".hermes-mobile", "key")
def read(name, default=None):
    try:
        return open(os.path.join(T, name), "rb").read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        # A new guard proves a REST answer when asked (X-Hermux-Nonce), unless the test says not to (noproof).
        nc = self.headers.get("X-Hermux-Nonce")
        loaded = (read("loaded") or b"").strip()
        if nc and self.path.startswith("/api/") and loaded not in (b"", b"0") and read("noproof") is None:
            key = open(KEYF).read().strip()
            p = la.answer_proof(key, "dashboard", la.addr(self.server.server_port), nc, la.NO_NONCE, f"rest {code}")
            self.send_header("X-Hermux-Proof", f"1 {la.kid(key)} {p}")
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n: self.rfile.read(n)
        key = open(KEYF).read().strip()
        if read("holder") is not None:  # not Hermes: it notes every key it is sent and offers a page to anyone
            with open(os.path.join(T, "holder.log"), "a") as f:
                f.write(f"{self.path} key={self.headers.get('X-Hermes-Mobile-Key')}\n")
            return self.send(200, b'<script>window.__HERMES_SESSION_TOKEN__ = "anyone";</script>', "text/html")
        loaded = (read("loaded") or b"").strip()
        new = loaded not in (b"", b"0")
        raw = self.headers.get("X-Hermes-Mobile-Key")
        if raw is not None:
            with open(os.path.join(T, "rawkey.log"), "a") as f:
                f.write(f"loaded={loaded.decode() or 'none'} ok={raw == key}\n")
        where = la.addr(self.server.server_port)
        if new and self.path.startswith("/hermux/hello?"):
            nc, hint = la.hello_args(self.path.split("?", 1)[1])
            ns, j = la.hello_answer(key, "dashboard", where, nc)
            pending.add(ns, nc, la.kid(key), where)
            return self.send(200, json.dumps(j).encode())
        if new and self.path == "/hermux/token":
            a = la.parse_auth(self.headers.get("X-Hermux-Auth"), with_nc=True)
            got = pending.take(a[1]) if a else None
            if not got or not la.request_ok(key, "dashboard", where, a[2], a[1], "GET", self.path, b"", a[3]):
                return self.send(403, b'{"hermux":1,"error":"refused"}')
            proof = la.answer_proof(key, "dashboard", where, a[2], a[1], "token", b"tok1")
            return self.send(200, json.dumps({"hermux": 1, "token": "tok1", "proof": proof}).encode())
        if self.path == "/" or self.path.startswith("/hermux/"):
            page = "tok1" if raw == key else "withheld"
            return self.send(200, ('<script>window.__HERMES_SESSION_TOKEN__ = "%s";</script>' % page).encode(), "text/html")
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
echo "4f1c0e9a7b3d5c2e8a6f4b1d9c7e5a3b2d0f8e6c4a2b1d3f" > "$HOME/.hermes-mobile/key"
cp "$here/phone/hm-local" "$HOME/bin/hm-local"  # an install that already has it (the scripts part below takes it away)
python3 "$t/server.py" "$t" "$here/hermes-plugin/hermes-mobile/local_auth.py" & srv=$!
trap 'kill $srv 2>/dev/null; wait $srv 2>/dev/null; pkill -f "hermes dashboard --host 127.0.0.1 --port $port --no-open" 2>/dev/null; rm -rf "$t"' EXIT
for _ in $(seq 50); do [ -s "$t/port" ] && break; sleep 0.1; done
port=$(cat "$t/port")
"$t/dashproc"
export HM_DASHBOARD="http://127.0.0.1:$port" HM_BUNDLE_URL="http://127.0.0.1:$port/plugin-bundle"
export HM_PLUGIN_WAIT=4 HM_PLUGIN_LOAD_WAIT=3 HM_PLUGIN_BACK_WAIT=3 HM_PLUGIN_SETTLE=3 HM_PLUGIN_POLL=0.3 HM_PLUGIN_UP_WAIT=1 HM_DASH_MIN_AGE=0 HM_TICKER_HOME="$t/tk"
echo aaa111 > "$t/token"

# The APK's plugin (stamp 2000000000) and an old one (a file changed, no BUILD_STAMP), like the Oct 30 copy on a phone.
NEW="$t/src/hermes-mobile"; mkdir -p "$t/src"; cp -R "$here/hermes-plugin/hermes-mobile" "$NEW"
find "$NEW" -name __pycache__ -prune -exec rm -rf {} +; rm -f "$NEW/BUILD_STAMP"
read -r STAMP HASH SHA <<< "$(bash "$S" pack "$NEW" "$t/bundle.tgz" 2000000000)"
check "pack prints the stamp" "$STAMP" 2000000000
check "hash ignores BUILD_STAMP" "$(bash "$S" hash "$NEW")" "$HASH"
OLD="$t/old"; cp -R "$NEW" "$OLD"; echo "# old" >> "$OLD/plugin.yaml"; rm -f "$OLD/google_workspace.py"
perl -pi -e 's|/hermux/hello|/hermux/none|g' "$OLD/dashboard/plugin_api.py"  # an old plugin's guard: no hello
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
check "the raw key went only to the old plugin's guard (before the swap)" "$(grep -c . "$t/rawkey.log") $(grep -vc '^loaded=0 ' "$t/rawkey.log")" "$(grep -c . "$t/rawkey.log") 0"
check "…it was needed for the busy check" "$([ "$(grep -c . "$t/rawkey.log")" -ge 1 ] && echo yes)" yes
check "…and noted once in the diagnostic log" "$(grep -c '^[0-9]* local legacy_key port=dashboard side=termux$' "$HOME/logs/loop-events.log")" 1
rm -f "$t/rawkey.log"
check "then current" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "apply again changes nothing" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN STATE current $STAMP"
check "a current plugin, check and apply: the raw key is never sent" "$(cat "$t/rawkey.log" 2>/dev/null)" ""

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
check "newer, modified, held: the raw key is never sent" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
rm -f "$W/hold"
check "modified, --force" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --force)" "HMPLUGIN OK $STAMP"

echo "an older stamp whose guard has the hello on disk: no raw key"
install_old; cp "$NEW/dashboard/plugin_api.py" "$P/dashboard/plugin_api.py"; rm -f "$t/rawkey.log"
check "it is still replaced (unverified: its own guard isn't the fake's old one)" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 | cut -d' ' -f1-2)" "HMPLUGIN OK"
check "…and the raw key was never sent" "$(cat "$t/rawkey.log" 2>/dev/null)" ""

echo "after the app ended the compatibility window (~/.hermes-mobile/enforced): never the raw key"
install_old; rm -f "$t/rawkey.log" "$HOME/logs/loop-events.log"; mkdir -p "$HOME/logs"; : > "$HOME/logs/loop-events.log"
touch "$HOME/.hermes-mobile/enforced"
cp "$t/bundle.tgz" "$t/good0.tgz"
BRK0="$t/brk0/hermes-mobile"; mkdir -p "$t/brk0"; cp -R "$NEW" "$BRK0"; touch "$BRK0/BROKEN"
echo '{"items":[{"session":"s1","ts":1}]}' > "$t/activity"  # a turn runs; the old guard can't be asked about it
check "an automatic run with an old guard that can't be asked: BUSY unknown (never a restart mid-turn)" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN BUSY unknown"
check "…untouched" "$(same "$OLDHASH")" yes
rm -f "$t/activity"
check "…also --force alone (not a tap) waits" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --force)" "HMPLUGIN BUSY unknown"
: > "$t/restarts"
check "the user's tap without the warning answered (--user alone): still BUSY unknown, nothing touched" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --user) $(same "$OLDHASH")" "HMPLUGIN BUSY unknown yes"
check "the user's confirmed tap (--user --confirmed): replaced, and verified after the restart (the new plugin speaks the hello)" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 --user --confirmed)" "HMPLUGIN OK $STAMP"
check "…the files are the APK's, loaded" "$(same "$HASH") $(cat "$t/loaded")" "yes $STAMP"
check "…the raw key was never sent, not even to the old guard" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
check "…and no legacy_key line" "$(grep -c 'legacy_key' "$HOME/logs/loop-events.log")" 0
install_old
read -r _ KH KS <<< "$(bash "$S" pack "$BRK0" "$t/bundle.tgz" 2000000000)"
check "the user's confirmed tap, a new plugin that doesn't load: rolled back" "$(run apply "$STAMP" "$KH" "$KS" aaa111 --user --confirmed)" "HMPLUGIN FAIL load rolled-back"
check "…the old plugin is back and loaded" "$(same "$OLDHASH") $(cat "$t/loaded" 2>/dev/null)" "yes 0"
check "…and still no raw key" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
cp "$t/good0.tgz" "$t/bundle.tgz"
check "an unknown option is refused" "$(bash -c "$(cat "$S")" hm-plugin apply "$STAMP" "$HASH" "$SHA" aaa111 --other >/dev/null 2>&1; echo $?)" 2
rm -f "$HOME/.hermes-mobile/enforced"
install_old

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

echo "a turn that starts after the swap, before the restart"
install_old; rm -f "$t/activity" "$t/restarts"
check "busy after the swap: the old plugin goes back, no restart" "$(HM_FAKE_BUSY_AFTER_SWAP=1 run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN BUSY working"
check "…the old plugin is in place" "$(same "$OLDHASH")" yes
check "…and Hermes was not restarted" "$(cat "$t/restarts" 2>/dev/null | wc -l | tr -d ' ')" 0
rm -f "$t/activity"

echo "something else answers on the dashboard's port after the restart"
install_old; rm -f "$t/holder" "$t/holder.log"
o=$(HM_FAKE_HOLD=1 run apply "$STAMP" "$HASH" "$SHA" aaa111)
check "the new plugin can't be seen serving: rolled back, and no claim that Hermes is back (no dashboard process)" "$o" "HMPLUGIN FAIL load rolled-back-not-up"
check "…the old plugin is in place" "$(same "$OLDHASH")" yes
check "…and the port's holder was asked things but never sent the key" "$([ -s "$t/holder.log" ] && ! grep -v ' key=None$' "$t/holder.log" | grep -q . && echo none)" none
rm -f "$t/holder" "$t/holder.log"
echo 0 > "$t/loaded"; "$t/dashproc"

echo "a run that settles an interrupted swap first: the exception is over"
install_old; mkdir -p "$W"; mv "$P" "$W/old"; cp -R "$NEW" "$P"; bash "$S" stamp "$P" "$STAMP" apk; printf %s "$STAMP" > "$W/pending"
echo 0 > "$t/loaded"; rm -f "$t/rawkey.log"
o=$(run apply "$STAMP" "$HASH" "$SHA" aaa111)
check "it settles (rolls back, restarts) and leaves the update to a fresh run" "$o" "HMPLUGIN BUSY settled"
check "…the old plugin is in place" "$(same "$OLDHASH")" yes
check "…and never sends the raw key after that restart" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
check "the next run does the update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"

echo "a run killed after its restart because the new plugin didn't load: the next one doesn't install it again"
BRK2="$t/brk2/hermes-mobile"; mkdir -p "$t/brk2"; cp -R "$NEW" "$BRK2"; touch "$BRK2/BROKEN"
read -r _ B2H B2S <<< "$(bash "$S" pack "$BRK2" "$t/bundle.tgz" 2000000000)"
install_old; mkdir -p "$W"; mv "$P" "$W/old"; cp -R "$BRK2" "$P"; rm -f "$P/BUILD_STAMP"; bash "$S" stamp "$P" "$STAMP" apk
printf %s "$STAMP" > "$W/pending"; rm -f "$t/loaded"  # it was restarted, and the broken plugin never loaded
o=$(run apply "$STAMP" "$B2H" "$B2S" aaa111)
check "it rolls the broken plugin back and stops there" "$o" "HMPLUGIN BUSY settled"
check "…the old plugin is in place, not the broken one again" "$(same "$OLDHASH")" yes
cp "$t/good.tgz" "$t/bundle.tgz" 2>/dev/null || true

echo "an old plugin, but no dashboard process: no raw key"
install_old; pkill -f "hermes dashboard --host 127.0.0.1 --port $port --no-open"; sleep 0.2; rm -f "$t/rawkey.log"
o=$(run apply "$STAMP" "$HASH" "$SHA" aaa111)
check "the update still runs" "$(printf %s "$o" | cut -d' ' -f1-2)" "HMPLUGIN OK"
check "…and the raw key went nowhere (whatever answered was not the old guard's Hermes)" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
pkill -f "hermes dashboard --host 127.0.0.1 --port $port --no-open"; "$t/dashproc"; install_old  # the next part starts from an old plugin

echo "an old guard on disk, no dashboard process, and a verified dashboard answering: its token never goes out plainly"
install_old; pkill -f "hermes dashboard --host 127.0.0.1 --port $port --no-open"; sleep 0.2; echo "$STAMP" > "$t/loaded"
: > "$t/curl-argv"; rm -f "$t/rawkey.log"
run apply "$STAMP" "$HASH" "$SHA" aaa111 >/dev/null
check "…no plain request carried a session token (the old-guard branch needs the dashboard's process too)" "$(grep -c 'X-Hermes-Session-Token' "$t/curl-argv")" 0
check "…and no raw key" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
pkill -f "hermes dashboard --host 127.0.0.1 --port $port --no-open"; "$t/dashproc"; install_old

echo "an old plugin whose dashboard process has only just started: no raw key"
install_old; rm -f "$t/rawkey.log"
o=$(HM_DASH_MIN_AGE=3600 run apply "$STAMP" "$HASH" "$SHA" aaa111)
check "the update still runs" "$(printf %s "$o" | cut -d' ' -f1-2)" "HMPLUGIN OK"
check "…and the raw key went nowhere (a process younger than DASH_MIN_AGE may not hold the port yet)" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
install_old; rm -f "$t/rawkey.log"; sleep 2
o=$(HM_DASH_MIN_AGE=1 run apply "$STAMP" "$HASH" "$SHA" aaa111)
check "a process older than DASH_MIN_AGE: the exception as before (its age read from ps)" "$([ -s "$t/rawkey.log" ] && echo used) $(printf %s "$o" | cut -d' ' -f1-2)" "used HMPLUGIN OK"
age() { bash "$S" age-parts "$@"; }
check "etime: SS, MM:SS, HH:MM:SS, D-HH:MM:SS" "$(age etime 07) $(age etime 05:03) $(age etime 01:02:03) $(age etime 2-01:02:03)" "7 303 3723 176523"
check "etime: anything else is no age (empty, junk, too many parts, a day without the time)" "[$(age etime '')][$(age etime x)][$(age etime 1:2:3:4)][$(age etime 3-)][$(age etime :5)]" "[][][][][]"
STAT='123 (python3) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 2500 19'
check "/proc stat: the age from field 22 and the uptime" "$(age stat "$STAT" 100.42 100)" 75
check "/proc stat: a process that ended in between (no stat line) is no age, not the uptime" "[$(age stat '' 100.42 100)]" "[]"
check "/proc stat: no uptime, no tick rate, or a start after the uptime is no age" "[$(age stat "$STAT" '' 100)][$(age stat "$STAT" 100 '')][$(age stat "$STAT" 100 0)][$(age stat "$STAT" 10 100)]" "[][][][]"
install_old

echo "under chroot the dashboard's process counts only as root's"
install_old; rm -f "$t/su-args" "$t/rawkey.log"
HM_FAKE_WHICH=chroot run apply "$STAMP" "$HASH" "$SHA" aaa111 >/dev/null
check "the dashboard's process check asks pgrep for root's processes only" "$(grep -c "^pgrep -u 0 -f '.*dashboard" "$t/su-args")" "$(grep -c "pgrep.*dashboard" "$t/su-args")"
check "…and asked at least once" "$([ "$(grep -c "^pgrep -u 0 -f '" "$t/su-args")" -ge 1 ] && echo yes)" yes
check "…no root process here: no raw key" "$(cat "$t/rawkey.log" 2>/dev/null)" ""
install_old

echo "a plugin that doesn't load is rolled back"
BRK="$t/brk/hermes-mobile"; mkdir -p "$t/brk"; cp -R "$NEW" "$BRK"; touch "$BRK/BROKEN"
read -r _ KH KS <<< "$(bash "$S" pack "$BRK" "$t/bundle.tgz" 2000000000)"
check "rolled back" "$(run apply "$STAMP" "$KH" "$KS" aaa111)" "HMPLUGIN FAIL load rolled-back"
check "the old plugin is back" "$(same "$OLDHASH")" yes
check "and loaded" "$(cat "$t/loaded" 2>/dev/null)" 0
check "the raw key only while the old plugin was in place (before the restart; never after the rollback)" "$(grep -vc '^loaded=0 ' "$t/rawkey.log")" 0
check "no marker left" "$(ls "$W" 2>/dev/null | tr '\n' ' ')" ""
cp "$t/good.tgz" "$t/bundle.tgz"

echo "Hermes was down (no plugin loaded): installed, unverified"
install_old; rm -f "$t/loaded"
check "unverified" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP unverified"
check "files" "$(same "$HASH")" yes

echo "the plugin's routes through hm-local get: the token only on a verified connection, an answer only with its proof"
install_old; cp "$t/good.tgz" "$t/bundle.tgz"; echo 0 > "$t/loaded"
check "an update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
: > "$t/curl-argv"
check "a check of the current plugin (its busy check asks the new guard)" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "…the session token never went in a plain request" "$(grep -c 'X-Hermes-Session-Token' "$t/curl-argv")" 0
install_old; echo 0 > "$t/loaded"; touch "$t/noproof"
check "a new plugin whose answers carry no proof can't be seen serving: rolled back" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN FAIL load rolled-back"
check "…the old plugin is back" "$(same "$OLDHASH")" yes
rm -f "$t/noproof"; install_old

echo "an interrupted run is settled by the next one"
install_old; mkdir -p "$W"; mv "$P" "$W/old"
rm -f "$t/rawkey.log"
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
check "check, settling an interrupted run: the raw key is never sent" "$(cat "$t/rawkey.log" 2>/dev/null)" ""

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
check "without ~/bin/hm-local the installed plugin's own copy verified the new guard; nothing of it is left" "$(ls "$HOME/.hermes-mobile/plugin-update.lock" 2>/dev/null)" ""
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
  { cat "$here/phone/hm-local"; echo "# an older copy"; } > "$BIN/hm-local"; chmod 755 "$BIN/hm-local"
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
# A stand-in ticker: python3 running a file (under HM_TICKER_HOME) that only sleeps, as the real one is seen by ps.
fake_ticker() { mkdir -p "$(dirname "$HM_TICKER_HOME/$1")"; printf 'import time\ntime.sleep(300)\n' > "$HM_TICKER_HOME/$1"; python3 "$HM_TICKER_HOME/$1" >/dev/null 2>&1 & echo $!; }
alive() { kill -0 "$1" 2>/dev/null && echo alive || echo gone; }
tp=$(fake_ticker plugins/hermes-mobile/cron_ticker.py)
ts=$(fake_ticker scripts/cron_ticker.py)
to=$(fake_ticker elsewhere/cron_ticker.py)
sleep 0.3
cp "$t/good.tgz" "$t/bundle.tgz"; install_old; echo 0 > "$t/loaded"
check "an update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
sleep 0.3
check "the plugin's own ticker is stopped (its loop starts the new code)" "$(alive "$tp")" gone
check "an older install's ticker in scripts/ is stopped" "$(alive "$ts")" gone
check "another process with that file name is left alone" "$(alive "$to")" alive
kill "$tp" "$ts" "$to" 2>/dev/null; wait "$tp" "$ts" "$to" 2>/dev/null

echo "an older install's ticker file in scripts/ becomes a stand-in for the plugin's copy"
OT="$HM_PLUGIN_ROOT/scripts/cron_ticker.py" KEEP="$HM_PLUGIN_ROOT/scripts/cron_ticker.py.before"
mkdir -p "$HM_PLUGIN_ROOT/scripts"; printf 'print("old ticker")\n' > "$OT"; rm -f "$KEEP"
cp "$t/good.tgz" "$t/bundle.tgz"; install_old; echo 0 > "$t/loaded"
ts=$(fake_ticker scripts/cron_ticker.py); sleep 0.3
check "an update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
check "…the old file is now the stand-in" "$(grep -c 'hermux-ticker-shim' "$OT")" 1
check "…it runs only the plugin's copy" "$(grep -c "T = '$P/cron_ticker.py'" "$OT") $(grep -c 'os.execv' "$OT")" "1 1"
check "…the old file is kept for a rollback" "$(cat "$KEEP")" 'print("old ticker")'
sleep 0.3
check "…the running old ticker is gone (its loop starts the stand-in)" "$(alive "$ts")" gone
mv "$P/cron_ticker.py" "$t/ct.away"
check "the stand-in fails closed without the plugin's copy (no old code, an error)" "$(python3 "$OT" >/dev/null 2>&1; echo $?)" 1
mv "$t/ct.away" "$P/cron_ticker.py"
cp "$OT" "$t/shim.1"
ts=$(fake_ticker scripts/cron_ticker.py); tp=$(fake_ticker plugins/hermes-mobile/cron_ticker.py); sleep 0.3
check "a check later" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE current $STAMP"
check "…changes nothing in the stand-in or the kept file (idempotent)" "$(cmp -s "$OT" "$t/shim.1" && echo same) $(cat "$KEEP")" 'same print("old ticker")'
sleep 0.3
check "…stops an old ticker still running the scripts/ file" "$(alive "$ts")" gone
check "…and leaves the plugin's own ticker alone" "$(alive "$tp")" alive
kill "$tp" 2>/dev/null; wait "$tp" "$ts" 2>/dev/null
rm -f "$OT"; printf 'print("old ticker")\n' > "$OT"; install_old; bash "$S" stamp "$P" 2000000000 apk
check "a check of a current plugin writes the stand-in an earlier update didn't" "$(run check "$STAMP" "$(bash "$S" hash "$P")" >/dev/null; grep -c 'hermux-ticker-shim' "$OT")" 1
install_old; rm -f "$P/cron_ticker.py"  # an older plugin without a ticker of its own
read -r _ KH KS <<< "$(bash "$S" pack "$BRK0" "$t/bundle.tgz" 2000000000)"
check "a rollback to a plugin without its own ticker" "$(run apply "$STAMP" "$KH" "$KS" aaa111)" "HMPLUGIN FAIL load rolled-back"
check "…brings the old ticker file back" "$(cat "$OT")" 'print("old ticker")'
cp "$t/good.tgz" "$t/bundle.tgz"; rm -f "$OT" "$KEEP"; install_old
printf 'x\n' > "$t/real"; ln -s "$t/real" "$OT"
check "a link in scripts/ is never written through" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111 >/dev/null; [ -L "$OT" ] && cat "$t/real")" x
rm -f "$OT"; install_old

echo "the supervisor's real cron-ticker loop: only the ticker itself is stopped, never its wrappers"
# The loop's own text from hermes-services, with this test's ticker folder and python3 for Hermes's Python.
inner=$(sed -n 's/^run_loop cron-ticker \$deb bash -lc "\(.*\)"$/\1/p' "$here/phone/hermes-services")
check "the loop's text names both ticker files (the case the wrappers are in)" "$(printf %s "$inner" | grep -c 'plugins/hermes-mobile/cron_ticker.py.*scripts/cron_ticker.py')" 1
inner=${inner//\/root\/.hermes/$HM_TICKER_HOME}; inner=${inner//\\\$/\$}; inner="PY=python3${inner#\$PY}"
fp=$(fake_ticker plugins/hermes-mobile/cron_ticker.py); kill "$fp" 2>/dev/null  # just the file
# A stand-in for run_loop around the login wrapper: its command line holds the loop's text, as proot's or chroot's does.
bash -c 'while :; do bash -c "$1"; sleep 0.2; done' cron-ticker-loop "$inner" >/dev/null 2>&1 & loop=$!
sleep 0.8
ticker_pids() {  # the python3 processes running the plugin's ticker file (not the loop's wrappers)
  local p a
  for p in $(pgrep -f "$HM_TICKER_HOME/plugins/hermes-mobile/[c]ron_ticker.py"); do
    a=$(ps -o args= -p "$p")
    [ "${a%% *}" = python3 ] && echo "$p"
  done
  return 0
}
tickers() { ticker_pids | grep -c .; }
t1=$(ticker_pids | head -1)
check "(one ticker runs under the loop)" "$(tickers)" 1
cp "$t/good.tgz" "$t/bundle.tgz"; install_old; bash "$S" stamp "$P" "$STAMP" apk
check "a check of a current plugin" "$(run check "$STAMP" "$(bash "$S" hash "$P")")" "HMPLUGIN STATE current $STAMP"
check "…leaves the loop and its ticker alone" "$(alive "$loop") $(alive "$t1") $(tickers)" "alive alive 1"
install_old; echo 0 > "$t/loaded"
check "an update" "$(run apply "$STAMP" "$HASH" "$SHA" aaa111)" "HMPLUGIN OK $STAMP"
sleep 1
check "…stops the ticker, not the loop, and exactly one ticker runs again" "$(alive "$loop") $(alive "$t1") $(tickers)" "alive gone 1"
kill "$loop" 2>/dev/null; pkill -f "$HM_TICKER_HOME/plugins/hermes-mobile/[c]ron_ticker.py" 2>/dev/null; wait "$loop" 2>/dev/null
install_old
check "the APK's copy of this script fits one argument (128 KiB): $(bash "$S" embed "$here/phone/hermes-services" "$t/size.sh"; wc -c < "$t/size.sh" | tr -d ' ') bytes" "$(( $(wc -c < "$t/size.sh") < 131072 ))" 1

echo "the exception's key stays off every command line"
K=$(cat "$HOME/.hermes-mobile/key")
check "the exception ran here (curl got the header from a file descriptor)" "$([ "$(grep -c -- '-H @/dev/fd/' "$t/curl-argv")" -ge 1 ] && echo yes)" yes
check "no curl call ever had the key among its arguments" "$(grep -c "$K" "$t/curl-argv")" 0

echo "source-stamp"
check "not a checkout: now" "$(( $(bash "$S" source-stamp "$t") >= $(date +%s) - 5 ))" 1

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
