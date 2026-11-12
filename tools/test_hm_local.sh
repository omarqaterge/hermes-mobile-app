#!/usr/bin/env bash
# Checks phone/hm-local (local authentication from Termux's shell) with no phone:
# - its Python is the client half of hermes-plugin/hermes-mobile/local_auth.py, unchanged (compared node by node), and
#   the shared vectors (tools/local-auth-vectors.json) give the same kid, SHA-256 and MACs through hm-local's own code;
# - against a fake local server (honest, wrong key, another key id, wrong address, wrong role, old version, garbage,
#   silent, refusing, a bad token answer): the exit code for each reason, and that after a failed hello the server got
#   nothing but the hello;
# - the key never appears in what reaches the server, in hm-local's output, in its process arguments (ps) or in the
#   arguments of the Debian fallback; the key id, nonces and proofs never appear in its output;
# - without Termux's python3 it runs inside Debian (a fake hermes-debian), and with no Python at all it exits 12 and
#   connects to nothing.
#   bash tools/test_hm_local.sh
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
H="$here/phone/hm-local"
PLUGIN="$here/hermes-plugin/hermes-mobile"
B=$BASH
t=$(mktemp -d "${TMPDIR:-/tmp}/hm-local-test.XXXXXX")
t=$(cd -P "$t" && pwd -P)
srv=""
trap '[ -n "$srv" ] && { kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null; }; rm -rf "$t"' EXIT
fails=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }

[ -f "$H" ] || { echo "  FAIL phone/hm-local exists"; echo "1 FAILED"; exit 1; }
check "hm-local is executable" "$([ -x "$H" ] && echo yes)" yes
check "its first line is Termux's bash" "$(head -1 "$H")" "#!/data/data/com.termux/files/usr/bin/bash"
check "uninstall.sh removes ~/bin/hm-local" "$(grep -cE '^for f in .* hm-local .*; do rmp ' "$here/phone/uninstall.sh")" 1

echo "the same client as local_auth.py, and the shared vectors"
python3 - "$H" "$PLUGIN/local_auth.py" "$here/tools/local-auth-vectors.json" <<'PY' || fails=$((fails + 1))
import ast, importlib.machinery, importlib.util, json, sys
hm_path, la_path, vec_path = sys.argv[1:4]
bad = 0
def check(name, cond):
    global bad
    print(("  ok   " if cond else "  FAIL ") + name)
    bad += not cond
def top(path):
    out = {}
    for n in ast.parse(open(path, encoding="utf-8").read()).body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
            out[n.name] = ast.dump(n)
        elif isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
            out[n.targets[0].id] = ast.dump(n)
    return out
hm, la = top(hm_path), top(la_path)
# The client half: every name hm-local needs from local_auth.py. A name added to the client there must come here too.
CLIENT = ("VERSION EMPTY_HASH DIRS ROLES NO_NONCE MIN_KEY MAX_WHAT REASONS HOST CONNECT_S HELLO_DEADLINE_S "
          "ANSWER_DEADLINE_S MAX_HELLO MAX_HEAD MAX_HEADERS MAX_ANSWER MAX_PATH MIN_VERSION _HEX _ADDR _WHAT _KEY _METHOD "
          "_PATH _DIGITS _STATUS _HEADER Unverified _hex is_nonce is_kid is_addr addr hint hello_target nonce _key_text sha256hex kid mac "
          "same _TooMuch _Malformed _Wire _Response _Connection Answer Session session TOKEN_PATH _TOKEN_TEXT "
          "_json_object dashboard_token").split()
missing = [n for n in CLIENT if n not in hm or n not in la]
check(f"hm-local has the whole client half ({len(CLIENT)} names){': missing ' + ' '.join(missing) if missing else ''}", not missing)
differ = [n for n in hm if n in la and hm[n] != la[n]]
check(f"each of them is the same as in local_auth.py{': differs ' + ' '.join(differ) if differ else ''}", not differ)
loader = importlib.machinery.SourceFileLoader("hm_local", hm_path)
spec = importlib.util.spec_from_loader("hm_local", loader)
h = importlib.util.module_from_spec(spec)
loader.exec_module(h)
V = json.loads(open(vec_path, encoding="utf-8").read())
F = ("key", "dir", "role", "addr", "nc", "ns", "what", "hash")
check("EMPTY_HASH", h.EMPTY_HASH == V["empty_hash"] == h.sha256hex(b""))
check("kid of the key", h.kid(V["key"]) == V["kid"])
check("kid of the other key", h.kid(V["other_key"]) == V["other_kid"])
check("every sha256 vector", all(h.sha256hex(s["text"].encode("utf-8")) == s["hex"] for s in V["sha256"]))
check(f"every MAC vector ({len(V['macs'])})", all(h.mac(*(m[f] for f in F)) == m["mac"] for m in V["macs"]))
check(f"every mismatch differs ({len(V['mismatch'])})", all(not h.same(h.mac(*(m[f] for f in F)), m["mac"]) for m in V["mismatch"]))
def refused(r):
    f = {k: V["macs"][0][k] for k in F}
    f[r["field"]] = r["set"]
    try:
        h.mac(*(f[k] for k in F))
        return False
    except ValueError as e:
        return str(e) == r["field"]
check(f"every rejected field is refused ({len(V['rejected'])})", all(refused(r) for r in V["rejected"]))
check("no nonce of the wrong shape passes", not any(h.is_nonce(s) for s in V["not_nonce"]) and h.is_nonce(h.nonce()))
tv = [m for m in V["macs"] if m["name"] == "answer proof, dashboard token"]
check("the token answer's proof vector, through hm-local's mac (the MAC itself, not only its shape)",
      len(tv) == 1 and h.mac(*(tv[0][f] for f in F)) == tv[0]["mac"] and tv[0]["what"] == "token"
      and tv[0]["hash"] == h.sha256hex(b"dashboard-session-token-0123456789"))
check("same() on the not_same pairs", all(not h.same(p["a"], p["b"]) and h.same(p["a"], p["a"]) for p in V["not_same"]))
hh = V["hello_hint"]
check("the hello target names the key's kid as its hint (hello_hint vector)", h.hello_target(hh["nc"], h.kid(hh["key"])) == hh["target"])
import re as _re
_well = lambda k: isinstance(k, str) and _re.fullmatch(r"[0-9a-f]{8}", k) is not None  # judged here, not by hm-local
bare = hh["target"].split("&kid=")[0]
check("a malformed or absent hint is refused by hint() and left out of the target (hint_cases)",
      all(h.hint(c["kid"]) is None and h.hello_target(hh["nc"], c["kid"]) == bare for c in V["hint_cases"] if not _well(c["kid"])))
check("a well-formed hint is kept by hint() and named in the target (hint_cases)",
      all(h.hint(c["kid"]) == c["kid"] and h.hello_target(hh["nc"], c["kid"]) == bare + "&kid=" + c["kid"]
          for c in V["hint_cases"] if _well(c["kid"])))
sys.exit(1 if bad else 0)
PY

# A fake local server: the server half written here from local_auth.py's primitives (not hm-local's), one connection
# at a time. It logs what it received (rx: everything; after: whatever followed the hello on that connection), the
# nonces and proofs it used (secrets) and the bodies it accepted (bodies).
cat > "$t/server.py" <<'PY'
import json, os, re, socket, sys, time
plugin, mode, role, keyfile, out = sys.argv[1:6]
sys.path.insert(0, plugin)
import local_auth as la
KEY = open(keyfile).read()
OTHER = "0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26"
TOKEN = "tok-ABC_123.x"
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0))
srv.listen(4)
port = srv.getsockname()[1]
ADDR = la.addr(port)
def log(name, b):
    with open(os.path.join(out, name), "ab") as f:
        f.write(b)
def head(c, buf):
    while b"\r\n\r\n" not in buf:
        try:
            d = c.recv(4096)
        except OSError:
            d = b""
        if not d:
            return None, buf
        buf += d
    i = buf.index(b"\r\n\r\n") + 4
    return buf[:i], buf[i:]
def reply(c, status, body=b"", extra=""):
    c.sendall(f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n{extra}\r\n".encode() + body)
def handle(c):
    h1, rest = head(c, b"")
    log("rx", h1 or rest)
    if h1 is None:
        return
    if mode == "silent":
        time.sleep(8)
        return
    if mode == "garbage":
        c.sendall(b"SSH-2.0-OpenSSH_9.6\r\n")
        time.sleep(0.5)
        return
    m = re.fullmatch(rb"GET /hermux/hello\?v=1&nc=([0-9a-f]{32})&kid=([0-9a-f]{8}) HTTP/1\.1", h1.split(b"\r\n")[0])
    if not m or m.group(2).decode() != la.kid(KEY):  # the hello names the key file's kid as its hint
        return reply(c, "404 Not Found")
    nc, ns = m.group(1).decode(), la.nonce()
    k, kid, srole, saddr, ver = KEY, la.kid(KEY), role, ADDR, 1
    if mode == "wrong_key":
        k = OTHER
    if mode == "other_kid":
        k, kid = OTHER, la.kid(OTHER)
    if mode == "wrong_addr":
        saddr = la.addr(port + 1 if port < 65535 else port - 1)
    if mode == "wrong_role":
        srole = "ticker"
    if mode == "old_version":
        ver = 0
    proof = la.mac(k, "server", srole, saddr, nc, ns, "hello", la.EMPTY_HASH)
    log("secrets", f"{nc}\n{ns}\n{proof}\n{kid}\n".encode())
    body = json.dumps({"hermux": ver, "role": srole, "kid": kid, "ns": ns, "addr": saddr, "proof": proof}).encode()
    reply(c, "200 OK", body, "Connection: keep-alive\r\n")
    c.settimeout(3)
    h2, rest = head(c, rest)
    if h2 is None:
        log("after", rest)
        log("rx", rest)
        return
    n = 0
    for line in h2.split(b"\r\n")[1:]:
        if line.lower().startswith(b"content-length:"):
            n = int(line.split(b":", 1)[1])
    while len(rest) < n:
        d = c.recv(65536)
        if not d:
            break
        rest += d
    data = rest[:n]
    log("after", h2 + data)
    log("rx", h2 + data)
    method, path, _ = h2.split(b"\r\n")[0].decode().split(" ")
    auth = ""
    for line in h2.split(b"\r\n")[1:]:
        if line.lower().startswith(b"x-hermux-auth:"):
            auth = line.split(b":", 1)[1].decode().strip()
    log("secrets", (auth.split(" ")[-1] + "\n").encode())
    # Checked with the plugin's own server half, as its servers check it: the dashboard's token step names both nonces
    # (1 <kid> <ns> <nc> <mac>), a request on the events port only the server's (1 <kid> <ns> <mac>).
    a = la.parse_auth(auth, with_nc=(role == "dashboard"))
    log("auth", (("ok" if a else "malformed") + "\n").encode())
    if (mode == "refuse" or a is None or a[0] != la.kid(KEY) or a[1] != ns or (role == "dashboard" and a[2] != nc)
            or not la.request_ok(KEY, role, ADDR, nc, ns, method, path, data, a[3])):
        return reply(c, "403 Forbidden", b'{"error":"refused"}')
    if role == "dashboard":
        if path != "/hermux/token":
            return reply(c, "404 Not Found")
        p = la.mac(OTHER if mode == "bad_token_proof" else KEY, "answer", "dashboard", ADDR, nc, ns, "token", la.sha256hex(TOKEN.encode()))
        log("secrets", (p + "\n").encode())
        b = b"not json" if mode == "token_garbage" else json.dumps({"hermux": 1, "token": TOKEN, "proof": p}).encode()
        return reply(c, "200 OK", b, "Connection: close\r\n")
    if mode == "status500":
        return reply(c, "500 Internal Server Error", b"{}")
    log("bodies", data + b"\n")
    reply(c, "200 OK", b'{"ok":true}', "Connection: close\r\n")
open(os.path.join(out, "port.tmp"), "w").write(str(port))
os.rename(os.path.join(out, "port.tmp"), os.path.join(out, "port"))
while True:
    c, _ = srv.accept()
    c.settimeout(10)
    try:
        handle(c)
    except Exception as e:
        log("errors", (repr(e) + "\n").encode())
    finally:
        c.close()
PY

export HOME="$t/home"
mkdir -p "$HOME/.hermes-mobile" "$HOME/bin"
KEY=$(python3 -c 'import secrets; print(secrets.token_hex(24))')
printf %s "$KEY" > "$HOME/.hermes-mobile/key"
KID=$(python3 -c "import hashlib,sys; print(hashlib.sha256(('hermux-kid-v1\n'+sys.argv[1]).encode()).hexdigest()[:8])" "$KEY")
L="$t/log"

serve() {  # MODE ROLE: a fresh server and fresh logs; sets $port
  [ -n "$srv" ] && { kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null; }
  rm -rf "$L"; mkdir -p "$L"
  python3 "$t/server.py" "$PLUGIN" "$1" "$2" "$HOME/.hermes-mobile/key" "$L" & srv=$!
  for _ in $(seq 100); do [ -s "$L/port" ] && break; sleep 0.05; done
  port=$(cat "$L/port")
}
hm() {  # ARGS...: runs hm-local as a shell would (stdin from $IN, default empty); sets $rc, $out, $err
  out=$("$B" "$H" "$@" < "${IN:-/dev/null}" 2>"$t/err"); rc=$?
  err=$(cat "$t/err")
}
after() { [ -s "$L/after" ] && echo "something" || echo nothing; }
has() { grep -qF -- "$1" "$2" 2>/dev/null && echo yes || echo no; }
leaks() {  # nothing private in hm-local's output: the key, its id, or a nonce or proof the server used
  local s
  printf '%s\n%s\n' "$out" "$err" > "$t/both"
  for s in "$KEY" "$KID" $(cat "$L/secrets" 2>/dev/null); do grep -qF -- "$s" "$t/both" && { echo leak; return; }; done
  echo none
}

echo "the shared client cases (hello_cases, answer_cases) through hm-local"
# Each raw answer from local-auth-vectors.json, played by a fake server: hm-local's own session() and request() must
# give the expected reason or result, and the command must give the matching exit code.
mkdir -p "$t/vhome/.hermes-mobile"
python3 - "$H" "$here/tools/local-auth-vectors.json" "$B" "$t/vhome" <<'PY' || fails=$((fails + 1))
import importlib.machinery, importlib.util, json, os, re, socket, subprocess, sys, threading, time
hm_path, vec_path, bash, vhome = sys.argv[1:5]
loader = importlib.machinery.SourceFileLoader("hm_local", hm_path)
h = importlib.util.module_from_spec(importlib.util.spec_from_loader("hm_local", loader))
loader.exec_module(h)
V = json.loads(open(vec_path, encoding="utf-8").read())
KEY = V["key"]
open(os.path.join(vhome, ".hermes-mobile", "key"), "w").write(KEY)
bad = 0
def check(name, cond, got=""):
    global bad
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f": got [{got}]"))
    bad += not cond
def read_request(c):
    buf = b""
    while b"\r\n\r\n" not in buf:
        d = c.recv(4096)
        if not d:
            return None
        buf += d
    head, _, rest = buf.partition(b"\r\n\r\n")
    m = re.search(rb"\r\ncontent-length: *(\d+)", head, re.I)
    n = int(m.group(1)) if m else 0
    while len(rest) < n:
        d = c.recv(4096)
        if not d:
            break
        rest += d
    return head, rest[:n]
def hello_body(port, nc, sets=None):
    ns, where = h.nonce(), f"127.0.0.1:{port}"
    vals = {"hermux": "1", "role": '"events"', "kid": f'"{h.kid(KEY)}"', "ns": f'"{ns}"', "addr": f'"{where}"',
            "proof": '"' + h.mac(KEY, "server", "events", where, nc, ns, "hello", h.EMPTY_HASH) + '"'}
    vals.update(sets or {})
    return "{" + ",".join(f'"{k}":{v}' for k, v in vals.items()) + "}"
def expand(template, body=""):
    t = re.sub(r"\{PAD:(\d+)\}", lambda m: "x" * int(m.group(1)), template)
    return t.replace("{LEN}", str(len(body.encode()))).replace("{BODY}", body).encode("latin-1")
GOOD = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {LEN}\r\n\r\n{BODY}"
def serve(play):
    """One connection, played by play(conn, port); returns the port. The thread ends with the connection."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(2)
    port = s.getsockname()[1]
    def run():
        try:
            for _ in range(1):
                c, _ = s.accept()
                c.settimeout(12)
                try:
                    play(c, port)
                except OSError:
                    pass
                finally:
                    time.sleep(0.2)
                    c.close()
        finally:
            s.close()
    threading.Thread(target=run, daemon=True).start()
    return port
def hello_play(case):
    def play(c, port):
        r = read_request(c)
        nc = re.match(rb"GET /hermux/hello\?v=1&nc=([0-9a-f]{32})&kid=[0-9a-f]{8} ", r[0]).group(1).decode()
        c.sendall(expand(case["answer"], hello_body(port, nc, case.get("set"))))
        if read_request(c) is not None:
            c.sendall(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    return play
def answer_play(case):
    def play(c, port):
        r = read_request(c)
        nc = re.match(rb"GET /hermux/hello\?v=1&nc=([0-9a-f]{32})&kid=[0-9a-f]{8} ", r[0]).group(1).decode()
        c.sendall(expand(GOOD, hello_body(port, nc)))
        if read_request(c) is not None:
            c.sendall(expand(case["answer"]))
    return play
def in_process(play):
    port = serve(play)
    try:
        a = h.session("events", port, KEY).request("POST", "/event", b"{}")
        return f"ok {a.status} {len(a.body)}"
    except h.Unverified as e:
        return e.why
    except OSError as e:
        return f"error {e}"
    except Exception as e:
        return f"escaped {type(e).__name__}"
def command(play):
    port = serve(play)
    env = dict(os.environ, HOME=vhome)
    r = subprocess.run([bash, hm_path, "post", "/event", str(port)], input=b"{}", capture_output=True, env=env, timeout=30)
    return r.returncode
for case in V["hello_cases"]:
    want = case["expect"]
    got = in_process(hello_play(case))
    check(f"hello case: {case['name']}: {want}", got == ("ok 204 0" if want == "verified" else want), got)
    rc = command(hello_play(case))
    check(f"hello case: {case['name']}: exit {0 if want == 'verified' else h.REASONS.index(want) + 3}",
          rc == (0 if want == "verified" else {"no_answer": 3, "no_hello": 4, "old_version": 5, "bad_addr": 6,
                                                 "unknown_kid": 7, "bad_proof": 8, "refused": 9}[want]), rc)
for case in V["answer_cases"]:
    want = case["expect"]
    got = in_process(answer_play(case))
    check(f"answer case: {case['name']}: {want}", got == want, got)
    rc = command(answer_play(case))
    code = 9 if want == "refused" else 0 if re.fullmatch(r"ok 2\d\d \d+", want) else 11
    check(f"answer case: {case['name']}: exit {code}", rc == code, rc)
    if want == "ok 200 1048576":  # a reader that goes away early: our own exit code, not Python's
        port = serve(answer_play(case))
        pr = subprocess.Popen([bash, hm_path, "post", "/event", str(port)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, env=dict(os.environ, HOME=vhome))
        pr.stdin.write(b"{}"); pr.stdin.close()
        pr.stdout.read(1); pr.stdout.close()
        check("the output's reader went away: exit 74", pr.wait(timeout=30) == 74, pr.returncode)
# The dashboard's token step: the shared token_cases, the server checking the request with the plugin's server half.
tools = os.path.dirname(vec_path)
sys.path.insert(0, tools)
import local_auth_cases as lac
spec = importlib.util.spec_from_file_location("plugin_local_auth", os.path.join(tools, "..", "hermes-plugin", "hermes-mobile", "local_auth.py"))
la = importlib.util.module_from_spec(spec)
spec.loader.exec_module(la)
for case in V["token_cases"]:
    want = case["expect"]
    ts = lac.TokenServer(la, KEY, V["other_key"], case)
    got = lac.outcome(lambda: h.dashboard_token(ts.port, KEY))
    ts.done.wait(5)
    check(f"token case: {case['name']}: {want}", got == want and (ts.header_ok is True or not case["answer"]), f"{got} header_ok={ts.header_ok}")
    ts = lac.TokenServer(la, KEY, V["other_key"], case)
    r = subprocess.run([bash, hm_path, "token", str(ts.port)], capture_output=True, env=dict(os.environ, HOME=vhome), timeout=30)
    code = 0 if want.startswith("token ") else 11 if want.startswith("error ") else h.REASONS.index(want) + 3
    out = r.stdout.decode()
    check(f"token case: {case['name']}: hm-local token exits {code}" + (", prints the token" if code == 0 else ", prints nothing"),
          r.returncode == code and out == (want[6:] + "\n" if code == 0 else ""), f"{r.returncode} {out!r}")
sys.exit(1 if bad else 0)
PY

echo "an honest server"
serve honest events
hm hello events "$port"
check "hello events: verified" "$rc" 0
check "hello sends nothing after the hello" "$(after)" nothing
check "hello prints nothing" "$out$err" ""
printf '{"kind":"test","marker":"BODY-7f3a"}' > "$t/body"
IN="$t/body" hm post /event "$port"
check "post: sent" "$rc" 0
check "post: the server took the body" "$(has BODY-7f3a "$L/bodies")" yes
check "post: prints the answer" "$out" '{"ok":true}'
check "post: the key never reached the server" "$(has "$KEY" "$L/rx")" no
check "post: nothing private in the output" "$(leaks)" none
serve honest dashboard
hm hello dashboard "$port"
check "hello dashboard: verified" "$rc" 0
hm token "$port"
check "token: prints the verified token" "$out" "tok-ABC_123.x"
check "token: the request named both nonces (the guard's five-field header)" "$(cat "$L/auth")" ok
check "token: exit 0" "$rc" 0
check "token: the key never reached the server" "$(has "$KEY" "$L/rx")" no
check "token: nothing private in the output" "$(leaks)" none

echo "every reason has its own exit code, and nothing follows a failed hello"
fail_case() {  # NAME MODE ROLE WANT_RC CMD...
  local name=$1 mode=$2 role=$3 want=$4; shift 4
  serve "$mode" "$role"
  local a args=()
  for a in "$@"; do [ "$a" = PORT ] && args+=("$port") || args+=("$a"); done  # PORT: the fake server's
  IN="$t/body" hm "${args[@]}"
  check "$name: exit $want" "$rc" "$want"
  check "$name: nothing sent after the hello" "$(after)" nothing
  check "$name: the body never left" "$(has BODY-7f3a "$L/rx")" no
  check "$name: the key never left" "$(has "$KEY" "$L/rx")" no
  check "$name: nothing private in the output" "$(leaks)" none
}
fail_case "garbage (no_hello)" garbage events 4 post /event PORT
fail_case "old version (old_version)" old_version events 5 post /event PORT
fail_case "wrong address, a relayed proof (bad_addr)" wrong_addr events 6 post /event PORT
fail_case "another key id (unknown_kid)" other_kid events 7 post /event PORT
fail_case "wrong key (bad_proof)" wrong_key events 8 post /event PORT
fail_case "wrong role (bad_proof)" wrong_role events 8 post /event PORT
fail_case "token from a dashboard with the wrong key" wrong_key dashboard 8 token PORT
fail_case "hello dashboard against a wrong address" wrong_addr dashboard 6 hello dashboard PORT
check "(the fake server got the hello: the cases above are real)" "$(has hermux/hello "$L/rx")" yes

echo "refused, bad answers"
serve refuse events
IN="$t/body" hm post /event "$port"
check "a server that refuses our MAC (refused): exit 9" "$rc" 9
check "refused: printed as the reason" "$err" "hm-local: refused"
serve refuse dashboard
hm token "$port"
check "token refused: exit 9" "$rc" 9
serve bad_token_proof dashboard
hm token "$port"
check "a token answer with a wrong proof: exit 8, no token printed" "$rc:$out" "8:"
serve token_garbage dashboard
hm token "$port"
check "a token answer that isn't JSON: exit 11" "$rc:$out" "11:"
serve status500 events
IN="$t/body" hm post /event "$port"
check "post answered 500: exit 11, nothing printed" "$rc:$out" "11:"

echo "closed stderr or stdout: still the documented exit code"
serve wrong_key events
"$B" "$H" hello events "$port" </dev/null >/dev/null 2>&-; rc=$?
check "a bad proof with stderr closed: exit 8" "$rc" 8
"$B" "$H" nope </dev/null >/dev/null 2>&-; rc=$?
check "usage with stderr closed: exit 64" "$rc" 64
serve honest dashboard
"$B" "$H" token "$port" </dev/null >&- 2>/dev/null; rc=$?
check "token with stdout closed: exit 74" "$rc" 74

echo "no answer"
free=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
hm hello events "$free"
check "nothing listening (no_answer): exit 3" "$rc" 3
serve silent events
"$B" "$H" hello events "$port" </dev/null >/dev/null 2>&1 & bg=$!
sleep 1
ps -A -o args= > "$t/ps" 2>/dev/null
check "(ps shows the running hm-local)" "$(has "hm-local hello events $port" "$t/ps")" yes
check "the key is in no process's arguments" "$(has "$KEY" "$t/ps")" no
wait "$bg"; rc=$?
check "a silent server (no_answer): exit 3" "$rc" 3
check "silent: nothing sent after the hello" "$(after)" nothing

echo "against the app's own server half (LocalServer.java, on a JDK)"
if command -v javac >/dev/null 2>&1 && command -v java >/dev/null 2>&1; then
  J="$t/java"; mkdir -p "$J/src/com/omarqaterge/hermesmobile" "$J/out"
  cp "$here/android/src/com/omarqaterge/hermesmobile/LocalAuth.java" "$here/android/src/com/omarqaterge/hermesmobile/LocalServer.java" \
    "$J/src/com/omarqaterge/hermesmobile/"
  cat > "$J/src/com/omarqaterge/hermesmobile/EventsPort.java" <<'JAVA'
package com.omarqaterge.hermesmobile;

import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/** Like the app's events port: LocalServer.accept with role events and the key, raw key refused; 200 echoing the body. */
public class EventsPort {
    public static void main(String[] a) throws Exception {
        String key = new String(Files.readAllBytes(Paths.get(a[0])), StandardCharsets.US_ASCII).trim();
        ServerSocket ss = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        Files.write(Paths.get(a[1] + ".tmp"), String.valueOf(ss.getLocalPort()).getBytes(StandardCharsets.US_ASCII));
        Files.move(Paths.get(a[1] + ".tmp"), Paths.get(a[1]));
        java.io.PrintWriter log = new java.io.PrintWriter(new java.io.FileWriter(a[2], true), true);
        while (true) {
            try (Socket s = ss.accept()) {
                LocalServer.Request r = LocalServer.accept(s, "events", key, null, 65536);
                // What followed the hello: "nothing" (the client closed after it) or a request.
                log.println(r == null ? "nothing" : "request " + r.auth);
                if (r == null) continue;
                if (r.auth != LocalServer.Auth.MAC) { LocalServer.answer(s.getOutputStream(), 403, "application/json", new byte[0]); continue; }
                LocalServer.answer(s.getOutputStream(), 200, "application/json", r.body);
            } catch (Exception e) { log.println("refused"); /* the answer, if any, is written */ }
        }
    }
}
JAVA
  if javac -d "$J/out" "$J"/src/com/omarqaterge/hermesmobile/*.java 2>"$t/javac.err"; then
    rm -f "$t/jport"
    rm -f "$t/jlog"
    java -cp "$J/out" com.omarqaterge.hermesmobile.EventsPort "$HOME/.hermes-mobile/key" "$t/jport" "$t/jlog" & jsrv=$!
    for _ in $(seq 200); do [ -s "$t/jport" ] && break; sleep 0.05; done
    jp=$(cat "$t/jport" 2>/dev/null)
    hm hello events "$jp"
    check "hello events against LocalServer: verified" "$rc" 0
    IN="$t/body" hm post /event "$jp"
    check "post /event to LocalServer: accepted, the body comes back" "$rc:$out" "0:$(cat "$t/body")"
    check "(LocalServer logged the hello alone, then the signed request)" "$(tr '\n' ' ' < "$t/jlog")" "nothing request MAC "
    printf %s 0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26 > "$t/other.key"
    kill "$jsrv" 2>/dev/null; wait "$jsrv" 2>/dev/null; rm -f "$t/jport"
    rm -f "$t/jlog"
    java -cp "$J/out" com.omarqaterge.hermesmobile.EventsPort "$t/other.key" "$t/jport" "$t/jlog" & jsrv=$!
    for _ in $(seq 200); do [ -s "$t/jport" ] && break; sleep 0.05; done
    IN="$t/body" hm post /event "$(cat "$t/jport")"
    check "LocalServer with another key: unknown_kid (exit 7)" "$rc" 7
    for _ in $(seq 40); do [ -s "$t/jlog" ] && break; sleep 0.05; done
    check "…and LocalServer got nothing after its hello" "$(cat "$t/jlog" 2>/dev/null)" nothing
    kill "$jsrv" 2>/dev/null; wait "$jsrv" 2>/dev/null
  else
    echo "  FAIL LocalServer.java compiles"; sed 's/^/       /' "$t/javac.err" | head -5; fails=$((fails + 1))
  fi
else
  echo "  skip no JDK here (CI's runner has one)"
fi

echo "a caller that never closes stdin"
serve honest events
# stdin is a pipe the caller holds open and never writes to or closes.
read -r rc took <<< "$(python3 -c 'import subprocess, sys, time
p = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
t = time.monotonic(); rc = p.wait(30); print(rc, int(time.monotonic() - t))' "$B" "$H" post /event "$port")"
check "post with stdin left open: exit 65" "$rc" 65
check "…within the body deadline (5 s, $took s), not the caller's" "$(( took < 9 ))" 1
check "…and it never connected" "$([ -e "$L/rx" ] && echo connected || echo no)" no

echo "bad input sends nothing"
serve honest events
python3 -c 'import sys; sys.stdout.write("x" * (256 * 1024 + 1))' > "$t/big"
IN="$t/big" hm post /event "$port"
check "a body over 256 KiB: exit 65" "$rc" 65
check "it never connected" "$([ -e "$L/rx" ] && echo connected || echo no)" no
hm post event "$port"
check "a path without a leading slash: exit 64" "$rc" 64
hm hello ticker "$port"
check "a role that doesn't speak HTTP with the key: exit 64" "$rc" 64
hm hello events 09121
check "a port with a leading zero: exit 64" "$rc" 64
hm token 70000
check "a port out of range: exit 64" "$rc" 64
hm nope
check "an unknown command: exit 64" "$rc" 64
mv "$HOME/.hermes-mobile/key" "$HOME/.hermes-mobile/key.away"
hm hello events "$port"
check "no key file: exit 10" "$rc" 10
check "no key: never connected" "$([ -e "$L/rx" ] && echo connected || echo no)" no
mv "$HOME/.hermes-mobile/key.away" "$HOME/.hermes-mobile/key"

echo "without Termux's python3"
mkdir -p "$t/nopy" "$t/debbin"
for c in sh ls; do ln -sf "$(command -v $c)" "$t/debbin/$c"; done
REAL_PATH=$PATH
cat > "$HOME/bin/hermes-debian" <<EOF
#!$B
# Fake Debian: logs its arguments, starts with Debian's own HOME (as a login does), runs the command.
printf '%s\n' "\$@" >> "$t/debargs"
export HOME=/nonexistent-root PATH="\${HM_FAKE_DEB_PATH:-$REAL_PATH}"
exec "\$@"
EOF
chmod +x "$HOME/bin/hermes-debian"
serve honest events
rm -f "$t/debargs"
out=$(PATH="$t/nopy" "$B" "$H" hello events "$port" </dev/null 2>"$t/err"); rc=$?
check "runs inside Debian and verifies" "$rc" 0
check "it went through hermes-debian" "$(has "$H" "$t/debargs")" yes
check "the key is not in hermes-debian's arguments" "$(has "$KEY" "$t/debargs")" no
IN="$t/body"
out=$(PATH="$t/nopy" "$B" "$H" post /event "$port" < "$t/body" 2>"$t/err"); rc=$?
check "post through Debian: the body arrives on stdin" "$rc:$(has BODY-7f3a "$L/bodies")" "0:yes"
unset IN
serve honest events
out=$(PATH="$t/nopy" HM_FAKE_DEB_PATH="$t/debbin" "$B" "$H" hello events "$port" </dev/null 2>"$t/err"); rc=$?
check "no Python in Debian either: exit 12" "$rc" 12
check "no Python: never connected" "$([ -e "$L/rx" ] && echo connected || echo no)" no
rm -f "$HOME/bin/hermes-debian"
out=$(PATH="$t/nopy" "$B" "$H" hello events "$port" </dev/null 2>"$t/err"); rc=$?
check "no python3 and no hermes-debian: exit 12" "$rc" 12
check "says why" "$(cat "$t/err")" "hm-local: no_python"

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
