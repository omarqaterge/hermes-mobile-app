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
    if [ -f "$P/BROKEN" ] || [ ! -f "$P/plugin.yaml" ]; then rm -f "$t/loaded"
    else s=\$(cut -d' ' -f1 "$P/BUILD_STAMP" 2>/dev/null); echo "\${s:-0}" > "$t/loaded"; fi ;;
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
export HM_PLUGIN_WAIT=4 HM_PLUGIN_BACK_WAIT=3 HM_PLUGIN_SETTLE=3 HM_PLUGIN_POLL=0.3
echo aaa111 > "$t/token"

# The APK's plugin (stamp 2000000000) and an old one (a file changed, no BUILD_STAMP), like the Oct 30 copy on a phone.
NEW="$t/src/hermes-mobile"; mkdir -p "$t/src"; cp -R "$here/hermes-plugin/hermes-mobile" "$NEW"
find "$NEW" -name __pycache__ -prune -exec rm -rf {} +; rm -f "$NEW/BUILD_STAMP"
read -r STAMP HASH SHA <<< "$(bash "$S" pack "$NEW" "$t/bundle.tgz" 2000000000)"
check "pack prints the stamp" "$STAMP" 2000000000
check "hash ignores BUILD_STAMP" "$(bash "$S" hash "$NEW")" "$HASH"
OLD="$t/old"; cp -R "$NEW" "$OLD"; echo "# old" >> "$OLD/plugin.yaml"; rm -f "$OLD/google_workspace.py"
install_old() { rm -rf "$P" "$W"; cp -R "$OLD" "$P"; echo 0 > "$t/loaded"; }
run() { bash "$S" "$@" 2>/dev/null | grep '^HMPLUGIN' | tail -1; }
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
check "swapped, new one never served: rolled back" "$(run check "$STAMP" "$HASH")" "HMPLUGIN STATE older 0"
check "old in place again" "$(same "$OLDHASH")" yes

echo "one run at a time"
mkdir "$HOME/.hermes-mobile/plugin-update.lock"
check "busy" "$(run check "$STAMP" "$HASH")" "HMPLUGIN BUSY another-run"
rmdir "$HOME/.hermes-mobile/plugin-update.lock"
check "bad arguments" "$(bash "$S" apply 12 nothex 2>/dev/null; echo $?)" 2

echo "source-stamp"
check "not a checkout: now" "$(( $(bash "$S" source-stamp "$t") >= $(date +%s) - 5 ))" 1

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
