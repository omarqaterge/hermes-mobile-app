#!/usr/bin/env python3
"""Unit tests for the canvas storage/tool (hermes-plugin/hermes-mobile/canvas.py). Uses a temp HOME.
    python3 tools/test_canvas.py
"""
import atexit
import importlib.util
import json
import os
import shutil
import sys
import tempfile

HOME = tempfile.mkdtemp(prefix="hm-canvas-test-")
atexit.register(shutil.rmtree, HOME, True)
os.environ["HOME"] = HOME
os.environ["HERMES_HOME"] = os.path.join(HOME, ".hermes")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("canvas", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "canvas.py"))
canvas = importlib.util.module_from_spec(spec)
sys.modules["canvas"] = canvas
spec.loader.exec_module(canvas)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except canvas.CanvasError as e:
        return str(e)
    return None


S = "20260930_abc123"
print("documents")
d = canvas.create(S, "My Plan", "# Plan\n\n- one\n- two\n", by="agent")
check("create returns id/rev/type", d["rev"] == 1 and d["type"] == "markdown" and d["id"].startswith("my-plan-"))
check("html guessed from content", canvas.create(S, "Page", "<!doctype html><h1>x</h1>")["type"] == "html")
check("type from file name", canvas.guess_type("app.py") == ("code", "python") and canvas.guess_type("n.md")[0] == "markdown")
check("list has both", len(canvas.list_docs(S)) == 2)
check("bad type refused", raises(canvas.create, S, "x", "y", type="pdf") is not None)

print("writing and versions")
w = canvas.write(S, d["id"], "# Plan\n\n- one\n- two\n- three\n", by="user")
check("write bumps rev", w["rev"] == 2)
check("conflict refused", "conflict" in (raises(canvas.write, S, d["id"], "x", base_rev=1) or ""))
check("write with right base_rev", canvas.write(S, d["id"], "# Plan v3", by="user", base_rev=2)["rev"] == 3)
check("identical write is a no-op", canvas.write(S, d["id"], "# Plan v3")["rev"] == 3)
v = canvas.get(S, d["id"])
check("versions list has authors", [x["by"] for x in v["versions"]] == ["agent", "user", "user"])
check("old version content", canvas.get_version(S, d["id"], 1)["content"].startswith("# Plan\n\n- one"))
r = canvas.restore(S, d["id"], 1)
check("restore creates a new revision", r["rev"] == 4 and canvas.get(S, d["id"])["content"].startswith("# Plan\n\n- one"))
for i in range(60):
    canvas.write(S, d["id"], f"content {i}")
check("versions are capped", len(canvas.get(S, d["id"])["versions"]) == canvas.MAX_VERSIONS)
check("size limit", "too large" in (raises(canvas.write, S, d["id"], "x" * (canvas.MAX_CHARS + 1)) or ""))

print("patching")
p = canvas.create(S, "Patchme", "alpha beta alpha gamma")["id"]
check("ambiguous find refused", "2 times" in (raises(canvas.patch, S, p, [{"find": "alpha", "replace": "A"}]) or ""))
check("all:true replaces every match", canvas.patch(S, p, [{"find": "alpha", "replace": "A", "all": True}])["chars"] == len("A beta A gamma"))
check("missing text refused", "not found" in (raises(canvas.patch, S, p, [{"find": "zzz", "replace": "y"}]) or ""))
check("failed patch changed nothing", canvas.get(S, p)["content"] == "A beta A gamma")
canvas.patch(S, p, [{"find": "beta", "replace": "B"}, {"find": "gamma", "replace": "G"}])
check("several edits in order", canvas.get(S, p)["content"] == "A B A G")

print("files")
REAL_HOME = os.path.realpath(HOME)
f = os.path.join(REAL_HOME, "notes.md")  # realpath: on macOS /var is a symlink to /private/var
open(f, "w").write("# From file\nhello")
o = canvas.open_file(S, f)
check("open_file links the path", o["path"] == f and o["type"] == "markdown" and "hello" in o["content"])
open(f, "w").write("# From file\nchanged outside")
o2 = canvas.open_file(S, f)
check("opening the same file again refreshes it", o2["id"] == o["id"] and "changed outside" in o2["content"] and o2["rev"] == 2)
canvas.write(S, o["id"], "edited in canvas", by="user")
check("save_file writes back when unchanged on disk", canvas.save_file(S, o["id"])["chars"] == 16 and open(f).read() == "edited in canvas")
# Saving a second time without external changes succeeds (file_sha256 was updated on save).
canvas.write(S, o["id"], "edited twice", by="user")
check("second save_file succeeds after first save refreshed hash", canvas.save_file(S, o["id"])["chars"] == 12 and open(f).read() == "edited twice")
# Disk-change conflict: external edit blocks save unless force=True.
open(f, "w").write("external edit on disk")
canvas.write(S, o["id"], "canvas overwrite", by="user")
check("save_file refuses when file changed on disk", "conflict" in (raises(canvas.save_file, S, o["id"]) or "") and open(f).read() == "external edit on disk")
check("save_file with force=True overwrites changed file", canvas.save_file(S, o["id"], force=True)["chars"] == 16 and open(f).read() == "canvas overwrite")
# File removed on disk also triggers conflict unless force=True.
os.unlink(f)
check("save_file refuses when original file was removed", "conflict" in (raises(canvas.save_file, S, o["id"]) or ""))
check("save_file with force=True recreates removed file", canvas.save_file(S, o["id"], force=True)["chars"] == 16 and open(f).read() == "canvas overwrite")

bin_file = os.path.join(REAL_HOME, "bin.dat")
open(bin_file, "wb").write(b"\x00\x01\x02binary")
check("binary refused inside home", "binary" in (raises(canvas.open_file, S, bin_file) or ""))
check("relative path refused", raises(canvas.open_file, S, "notes.md") is not None)
check("missing file inside home refused", "no such file" in (raises(canvas.open_file, S, os.path.join(REAL_HOME, "nothing.txt")) or ""))
check("save without a linked file refused", "isn't linked" in (raises(canvas.save_file, S, d["id"]) or ""))

print("file path safety")
outside = tempfile.NamedTemporaryFile(delete=False, suffix=".txt")
outside.write(b"outside")
outside.close()
atexit.register(lambda p=outside.name: os.path.exists(p) and os.unlink(p))
check("open_file refuses path outside allowed folders", "refused" in (raises(canvas.open_file, S, outside.name) or ""))
check("open_file refuses /bin/ls outside allowed folders", "refused" in (raises(canvas.open_file, S, "/bin/ls") or ""))
# Symlink escaping home is refused on open_file.
esc_link = os.path.join(REAL_HOME, "escape.txt")
os.symlink(outside.name, esc_link)
check("open_file refuses symlink escaping home", "refused" in (raises(canvas.open_file, S, esc_link) or ""))

# Secrets & internal files refused on open_file.
hermes_dir = os.path.join(REAL_HOME, ".hermes")
os.makedirs(os.path.join(hermes_dir, "profiles", "work"), exist_ok=True)
os.makedirs(os.path.join(hermes_dir, "mobile"), exist_ok=True)
os.makedirs(os.path.join(REAL_HOME, ".hermes-mobile"), exist_ok=True)
os.makedirs(os.path.join(REAL_HOME, ".ssh"), exist_ok=True)
os.makedirs(os.path.join(REAL_HOME, "bin"), exist_ok=True)
env_path = os.path.join(hermes_dir, ".env")
open(env_path, "w").write("OPENAI_API_KEY=secret\n")
auth_path = os.path.join(hermes_dir, "auth.json")
open(auth_path, "w").write("{}")
key_path = os.path.join(REAL_HOME, ".hermes-mobile", "key")
open(key_path, "w").write("deadbeef")
ssh_path = os.path.join(REAL_HOME, ".ssh", "id_ed25519")
open(ssh_path, "w").write("PRIVATE")
auto_path = os.path.join(hermes_dir, "mobile", "auto.json")
open(auto_path, "w").write("{}")
proj_env = os.path.join(REAL_HOME, ".env.local")
open(proj_env, "w").write("SECRET=1\n")
for label, secret_p in [(".hermes/.env", env_path), ("auth.json", auth_path), (".hermes-mobile/key", key_path), (".ssh key", ssh_path), ("mobile/auto.json", auto_path), (".env.local", proj_env)]:
    check(f"open_file refuses {label}", "refused" in (raises(canvas.open_file, S, secret_p) or ""))

# Config files, profile configs, shell init and ~/bin are refused on save_file (even with force=True).
cfg_path = os.path.join(hermes_dir, "config.yaml")
open(cfg_path, "w").write("approvals:\n  mode: manual\n")
prof_cfg = os.path.join(hermes_dir, "profiles", "work", "config.yaml")
open(prof_cfg, "w").write("approvals:\n  mode: manual\n")
bashrc = os.path.join(REAL_HOME, ".bashrc")
open(bashrc, "w").write("export X=1\n")
bin_script = os.path.join(REAL_HOME, "bin", "hm-local")
open(bin_script, "w").write("#!/bin/sh\n")

for label, prot_p in [("config.yaml", cfg_path), ("profile config.yaml", prof_cfg), (".bashrc", bashrc), ("~/bin script", bin_script)]:
    orig = open(prot_p).read()
    od = canvas.open_file(S, prot_p)
    canvas.write(S, od["id"], "approvals:\n  mode: off\n", by="user")
    err = raises(canvas.save_file, S, od["id"], force=True)
    check(f"save_file refuses {label} even with force=True", "refused" in (err or "") and open(prot_p).read() == orig, str(err))

# Symlink swap after open_file is refused on save_file.
swap_f = os.path.join(REAL_HOME, "swap.md")
open(swap_f, "w").write("innocent")
swap_doc = canvas.open_file(S, swap_f)
canvas.write(S, swap_doc["id"], "approvals:\n  mode: off\n", by="user")
os.unlink(swap_f)
os.symlink(cfg_path, swap_f)
err = raises(canvas.save_file, S, swap_doc["id"], force=True)
check("save_file refuses symlink swap after open_file", "refused" in (err or "") and "manual" in open(cfg_path).read(), str(err))

# Tampered canvas doc JSON pointing outside allowed folders is refused on save_file.
forged = canvas.create(S, "Forged", "evil", path=outside.name)
err = raises(canvas.save_file, S, forged["id"], force=True)
check("save_file refuses tampered doc pointing outside allowed folders", "refused" in (err or "") and open(outside.name).read() == "outside", str(err))

print("agent tool")
def call(**a):
    return json.loads(canvas.tool_handler(a, session_id="tool-chat"))
c = call(action="create", title="Notes", content="hi", type="markdown")
check("tool create", c["ok"] and c["shown"])
check("id optional with one document", call(action="write", content="hi there")["ok"])
r = call(action="read")
check("tool read returns content + last editor", r["content"] == "hi there" and r["last_edited_by"] == "agent")
canvas.write("tool-chat", c["id"], "user typed this", by="user")
check("agent sees the user's edit", call(action="read")["last_edited_by"] == "user")
call(action="create", title="Second", content="2")
check("id required with several documents", not call(action="read")["ok"])
check("unknown action reported", "unknown action" in call(action="dance")["error"])
check("errors don't raise", call(action="patch", id="nope", edits=[{"find": "a", "replace": "b"}])["ok"] is False)
check("list", len(call(action="list")["documents"]) == 2)
check("close", call(action="close", id=c["id"])["ok"] and len(call(action="list")["documents"]) == 1)
check("no chat attached", json.loads(canvas.tool_handler({"action": "list"}))["ok"] is False)

print("offline lint")
h = call(action="create", title="chart", type="html", content='<script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>fetch("/x")</script>')
check("CDN script + fetch produce a warning", h["ok"] and h.get("warnings") and "cdn" in h["warnings"][0].lower() or "https" in h["warnings"][0], str(h))
w = call(action="write", id=h["id"], content="<html><body><svg width='10' height='10'></svg><a href='#x'>ok</a><script>document.title='ok'</script></body></html>")
check("clean HTML gives no warning", w["ok"] and "warnings" not in w, str(w))
w = call(action="patch", id=h["id"], edits=[{"find": "<a href='#x'>ok</a>", "replace": "<img src='//evil.example/a.png'>"}])
check("a patch that adds an external URL warns", bool(w.get("warnings")), str(w))
m = call(action="create", title="note", type="markdown", content="see https://example.com and fetch(x)")
check("markdown is never linted", m["ok"] and "warnings" not in m)
call(action="close", id=h["id"]); call(action="close", id=m["id"])

print("safety")
check("path tricks in the chat id are neutralised", canvas._dir("../../etc").resolve().parent == canvas.ROOT.resolve())
check("empty ids refused", raises(canvas._safe, "") is not None)

print("concurrency")
import subprocess
canvas.create("race", "doc", "x")
rid = canvas.list_docs("race")[0]["id"]
code = (
    "import importlib.util,sys;"
    f"s=importlib.util.spec_from_file_location('canvas',{os.path.join(HERE, '..', 'hermes-plugin', 'hermes-mobile', 'canvas.py')!r});"
    "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
    f"[m.write('race',{rid!r},f'writer {{sys.argv[1]}} step {{i}}',by='agent') for i in range(15)]"
)
procs = [subprocess.Popen([sys.executable, "-c", code, str(n)], env=os.environ) for n in range(4)]
[p.wait() for p in procs]
final = canvas.get("race", rid)
check("4 processes x 15 writes: no lost or corrupt revision", final["rev"] == 61 and final["content"].startswith("writer "), f"rev {final['rev']}")

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    print("plugin_api HTTP routes")
    pspec = importlib.util.spec_from_file_location("plugin_api_canvas_test", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "dashboard", "plugin_api.py"))
    papi = importlib.util.module_from_spec(pspec)
    pspec.loader.exec_module(papi)
    sys.modules["hm_canvas"] = canvas
    app = FastAPI()
    app.include_router(papi.router, prefix="/api/plugins/hermes-mobile")
    client = TestClient(app)
    r_env = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S, "path": env_path})
    check("HTTP /canvas/open-file returns 403 for .env", r_env.status_code == 403, r_env.status_code)
    r_cfg_open = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S, "path": cfg_path})
    check("HTTP /canvas/open-file opens config.yaml read-only", r_cfg_open.status_code == 200, r_cfg_open.status_code)
    r_cfg_save = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S, "id": r_cfg_open.json()["id"]})
    check("HTTP /canvas/save-file returns 403 for config.yaml", r_cfg_save.status_code == 403, r_cfg_save.status_code)
    http_f = os.path.join(REAL_HOME, "http-note.md")
    open(http_f, "w").write("v1")
    r_open = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S, "path": http_f})
    hid = r_open.json()["id"]
    canvas.write(S, hid, "v2 from canvas", by="user")
    open(http_f, "w").write("v1 changed on disk")
    r_conf = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S, "id": hid})
    check("HTTP /canvas/save-file returns 409 on disk change", r_conf.status_code == 409 and open(http_f).read() == "v1 changed on disk", r_conf.status_code)
    r_force = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S, "id": hid, "force": True})
    check("HTTP /canvas/save-file returns 200 with force=True", r_force.status_code == 200 and open(http_f).read() == "v2 from canvas", r_force.status_code)
except ImportError:
    pass

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
