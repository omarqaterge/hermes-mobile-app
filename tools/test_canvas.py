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

# Permission bits are preserved across save_file (Finding 8).
perm_f = os.path.join(REAL_HOME, "private-note.md")
open(perm_f, "w").write("secret note")
os.chmod(perm_f, 0o600)
po = canvas.open_file(S, perm_f)
canvas.write(S, po["id"], "updated secret note", by="user")
canvas.save_file(S, po["id"])
check("save_file preserves existing permission bits (0600)", (os.stat(perm_f).st_mode & 0o777) == 0o600, oct(os.stat(perm_f).st_mode & 0o777))

bin_f = os.path.join(REAL_HOME, "bin.dat")
open(bin_f, "wb").write(b"\x00\x01\x02binary")
bin_err = raises(canvas.open_file, S, bin_f) or ""
check("binary refused", "binary" in bin_err, bin_err)
ls_err = raises(canvas.open_file, S, "/bin/ls") or ""
check("/bin/ls refused as binary or too big", "binary" in ls_err or "too big" in ls_err, ls_err)
check("relative path refused", raises(canvas.open_file, S, "notes.md") is not None)
check("missing file refused", "no such file" in (raises(canvas.open_file, S, "/nope/nothing.txt") or ""))
check("NUL byte in open_file path raises refused CanvasError", "refused" in (raises(canvas.open_file, S, os.path.join(REAL_HOME, "a\x00b")) or ""))
check("save without a linked file refused", "isn't linked" in (raises(canvas.save_file, S, d["id"]) or ""))

print("file path safety")
# Files outside save roots (e.g. /tmp) may be opened read-only, but saving back is refused (Finding 5).
outside = tempfile.NamedTemporaryFile(delete=False, suffix=".txt")
outside.write(b"outside")
outside.close()
atexit.register(lambda p=outside.name: os.path.exists(p) and os.unlink(p))
od_out = canvas.open_file(S, outside.name)
check("open_file allows read-only open outside save roots (/tmp)", od_out["content"] == "outside")
canvas.write(S, od_out["id"], "changed", by="user")
check("save_file refuses path outside allowed save roots", "refused" in (raises(canvas.save_file, S, od_out["id"], force=True) or "") and open(outside.name).read() == "outside")

# FIFO (non-regular file) is refused without blocking (O_NONBLOCK + fstat).
fifo_p = os.path.join(REAL_HOME, "pipe.fifo")
os.mkfifo(fifo_p)
check("open_file refuses FIFO without blocking", "no such file" in (raises(canvas.open_file, S, fifo_p) or ""))

# Intermediate directory symlink between allowed root and file is refused on save_file (Finding 1).
ext_dir = tempfile.mkdtemp(prefix="hm-canvas-ext-")
atexit.register(lambda d=ext_dir: shutil.rmtree(d, ignore_errors=True))
ext_target = os.path.join(ext_dir, "victim.txt")
open(ext_target, "w").write("keep me")
mid_parent = os.path.join(REAL_HOME, "sub")
os.makedirs(mid_parent, exist_ok=True)
mid_link = os.path.join(mid_parent, "hop")
os.symlink(ext_dir, mid_link)
forged_mid = canvas.create(S, "ForgedMid", "pwned", path=os.path.join(mid_link, "victim.txt"))
err = raises(canvas.save_file, S, forged_mid["id"], force=True)
check("save_file refuses intermediate directory symlink", "refused" in (err or "") and open(ext_target).read() == "keep me", str(err))

# dir_fd fallback (only when openat/dir_fd raises _DirFdUnsupported, NOT EINVAL) still saves regular files and refuses intermediate symlinks.
import errno as _errno
check("EINVAL is not in _DIR_FD_UNSUPPORTED", _errno.EINVAL not in canvas._DIR_FD_UNSUPPORTED)
_orig_save_dir_fd = canvas._save_with_dir_fd
def _raise_dir_fd_unsupported(*a, **kw):
    raise canvas._DirFdUnsupported()
canvas._save_with_dir_fd = _raise_dir_fd_unsupported
try:
    fb_f = os.path.join(REAL_HOME, "fallback.txt")
    open(fb_f, "w").write("before")
    os.chmod(fb_f, 0o640)
    fb_doc = canvas.open_file(S, fb_f)
    canvas.write(S, fb_doc["id"], "after", by="user")
    canvas.save_file(S, fb_doc["id"])
    check("dir_fd fallback saves and preserves mode", open(fb_f).read() == "after" and (os.stat(fb_f).st_mode & 0o777) == 0o640)
    err = raises(canvas.save_file, S, forged_mid["id"], force=True)
    check("dir_fd fallback still refuses intermediate symlink", "refused" in (err or "") and open(ext_target).read() == "keep me", str(err))
finally:
    canvas._save_with_dir_fd = _orig_save_dir_fd

# OSError (EACCES, EROFS, ENAMETOOLONG, ENOSPC, EINVAL) turns into plain CanvasError (never raw OSError/HTTP 500) and EINVAL does not fall back.
for err_no, want_word in [(_errno.EACCES, "permission denied"), (_errno.EROFS, "read-only"), (_errno.ENAMETOOLONG, "too long"), (_errno.ENOSPC, "no space"), (_errno.EINVAL, "cannot save")]:
    def _raise_os(*a, _no=err_no, **kw):
        raise OSError(_no, "synthetic-io-error")
    canvas._save_with_dir_fd = _raise_os
    try:
        err = raises(canvas.save_file, S, fb_doc["id"], force=True)
        check(f"save_file maps errno {err_no} to CanvasError", want_word in (err or "").lower(), str(err))
    finally:
        canvas._save_with_dir_fd = _orig_save_dir_fd

# Dead helpers were removed.
for dead in ("_is_within", "_allowed_roots", "_check_save_path", "_phone_path"):
    check(f"dead helper {dead} removed", not hasattr(canvas, dead))

# Shared parity vectors in tools/canvas-path-vectors.json (Finding 3).
from pathlib import Path
vec_file = os.path.join(HERE, "canvas-path-vectors.json")
vectors = json.load(open(vec_file))["cases"]
check("shared canvas-path-vectors.json has >= 40 cases", len(vectors) >= 40, len(vectors))

def _server_open_check(p: str) -> str | None:
    try:
        raw_abs = canvas._validate_raw_path(p)
        canvas._check_open_path(Path(os.path.abspath(raw_abs)))
        canvas._check_open_path(Path(os.path.realpath(raw_abs)))
        return None
    except canvas.CanvasError as e:
        return str(e)

def _server_save_check(p: str, needs_sdcard: bool = False) -> str | None:
    try:
        raw_abs = canvas._validate_raw_path(p)
        if needs_sdcard and not os.path.exists("/sdcard"):
            clean = Path(raw_abs)
            if ".." in clean.parts:
                raise canvas.CanvasError("refused: invalid path")
            canvas._check_save_denylist(clean)
            return None
        real_root, rel_parts = canvas._match_save_root(raw_abs)
        target = real_root.joinpath(*rel_parts)
        canvas._check_save_denylist(target)
        canvas._check_save_denylist(Path(os.path.realpath(str(target))))
        return None
    except canvas.CanvasError as e:
        return str(e)

vec_bad = []
for vc in vectors:
    vp = vc["path"].replace("{HOME}", REAL_HOME)
    o_err = _server_open_check(vp)
    s_err = _server_save_check(vp, bool(vc.get("needsSdcard")))
    if vc["open"] == "refuse" and o_err is None:
        vec_bad.append(f"open should refuse {vc['path']}")
    if vc["open"] == "allow" and o_err is not None:
        vec_bad.append(f"open should allow {vc['path']}: {o_err}")
    if vc["save"] == "refuse" and s_err is None:
        vec_bad.append(f"save should refuse {vc['path']}")
    if vc["save"] == "allow" and s_err is not None:
        vec_bad.append(f"save should allow {vc['path']}: {s_err}")
check(f"canvas.py matches all {len(vectors)} shared vectors in canvas-path-vectors.json", not vec_bad, "; ".join(vec_bad[:5]))
check("_is_in_secret_reach matches .hermes/.hermes-mobile segments at any depth",
      canvas._is_in_secret_reach(Path("/data/data/com.termux/files/home/.hermes/config.yaml"))
      and canvas._is_in_secret_reach(Path("/sdcard/.hermes-mobile/key"))
      and not canvas._is_in_secret_reach(Path(REAL_HOME) / "ordinary.txt"))

# Secrets & internal files refused on open_file (including symlinked profiles, Finding 2 & 3).
hermes_dir = os.path.join(REAL_HOME, ".hermes")
os.makedirs(os.path.join(hermes_dir, "profiles", "work", "mobile"), exist_ok=True)
os.makedirs(os.path.join(hermes_dir, "mobile"), exist_ok=True)
linked_prof_real = tempfile.mkdtemp(prefix="hm-linked-prof-")
atexit.register(lambda d=linked_prof_real: shutil.rmtree(d, ignore_errors=True))
os.makedirs(os.path.join(linked_prof_real, "mobile"), exist_ok=True)
os.symlink(linked_prof_real, os.path.join(hermes_dir, "profiles", "linked"))

for sub in (".hermes-mobile", ".ssh", ".android", ".gnupg", ".aws", "bin", ".local/bin", ".termux", ".config/git", ".config/fish"):
    os.makedirs(os.path.join(REAL_HOME, sub), exist_ok=True)

env_path = os.path.join(hermes_dir, ".env")
open(env_path, "w").write("OPENAI_API_KEY=secret\n")
auth_path = os.path.join(hermes_dir, "auth.json")
open(auth_path, "w").write("{}")
prof_auth = os.path.join(hermes_dir, "profiles", "work", "auth.json")
open(prof_auth, "w").write("{}")
prof_mobile = os.path.join(hermes_dir, "profiles", "work", "mobile", "auto.json")
open(prof_mobile, "w").write("{}")
linked_auth = os.path.join(linked_prof_real, "auth.json")
open(linked_auth, "w").write("{}")
linked_mobile = os.path.join(linked_prof_real, "mobile", "state.json")
open(linked_mobile, "w").write("{}")
key_path = os.path.join(REAL_HOME, ".hermes-mobile", "key")
open(key_path, "w").write("deadbeef")
ssh_path = os.path.join(REAL_HOME, ".ssh", "id_ed25519")
open(ssh_path, "w").write("PRIVATE")
android_key = os.path.join(REAL_HOME, ".android", "adbkey")
open(android_key, "w").write("PRIVATE")
gnupg_key = os.path.join(REAL_HOME, ".gnupg", "secring.gpg")
open(gnupg_key, "w").write("PRIVATE")
netrc_path = os.path.join(REAL_HOME, ".netrc")
open(netrc_path, "w").write("machine x password y\n")
aws_creds = os.path.join(REAL_HOME, ".aws", "credentials")
open(aws_creds, "w").write("[default]\n")
termux_props = os.path.join(REAL_HOME, ".termux", "termux.properties")
open(termux_props, "w").write("use-black-ui=true\n")
auto_path = os.path.join(hermes_dir, "mobile", "auto.json")
open(auto_path, "w").write("{}")
proj_env = os.path.join(REAL_HOME, ".env.local")
open(proj_env, "w").write("SECRET=1\n")
upper_env = os.path.join(REAL_HOME, ".ENV.PROD")
open(upper_env, "w").write("SECRET=2\n")

for label, secret_p in [
    (".hermes/.env", env_path), ("auth.json", auth_path), ("profile auth.json", prof_auth),
    ("profile mobile/", prof_mobile), ("symlinked profile auth.json", linked_auth),
    ("symlinked profile mobile/", linked_mobile), (".hermes-mobile/key", key_path),
    (".ssh key", ssh_path), (".android/adbkey", android_key), (".gnupg key", gnupg_key),
    (".netrc", netrc_path), (".aws/credentials", aws_creds), (".termux/termux.properties", termux_props),
    ("mobile/auto.json", auto_path), (".env.local", proj_env), (".ENV.PROD (case-insensitive)", upper_env),
]:
    check(f"open_file refuses {label}", "refused" in (raises(canvas.open_file, S, secret_p) or ""))

# Hardlink inside Hermes home is refused on open_file, while hardlink outside Hermes home is allowed (Finding 8).
hl_hermes = os.path.join(hermes_dir, "hardlink-alias.txt")
os.link(auth_path, hl_hermes)
check("open_file refuses hard-linked file inside Hermes home", "refused" in (raises(canvas.open_file, S, hl_hermes) or ""))
hl_src = os.path.join(REAL_HOME, "ordinary-a.txt")
hl_dst = os.path.join(REAL_HOME, "ordinary-b.txt")
open(hl_src, "w").write("ordinary")
os.link(hl_src, hl_dst)
check("open_file still allows hard-linked ordinary user file outside Hermes home", canvas.open_file(S, hl_dst)["content"] == "ordinary")

# Case-insensitive path component checks (Finding 4).
check("case-insensitive open deny (.AWS/credentials)", "refused" in (raises(canvas._check_open_path, Path(REAL_HOME) / ".AWS" / "credentials") or ""))
check("case-insensitive save deny (.Hermes/Config.YAML)", "refused" in (raises(canvas._check_save_denylist, Path(REAL_HOME) / ".Hermes" / "Config.YAML") or ""))
check("case-insensitive save deny (.Config/Fish/config.fish)", "refused" in (raises(canvas._check_save_denylist, Path(REAL_HOME) / ".Config" / "Fish" / "config.fish") or ""))
check("case-insensitive save deny (.GitConfig)", "refused" in (raises(canvas._check_save_denylist, Path(REAL_HOME) / ".GitConfig") or ""))
check("case-insensitive save deny (.ShInit)", "refused" in (raises(canvas._check_save_denylist, Path(REAL_HOME) / ".ShInit") or ""))
check("plugin own directory is always refused on save", "refused" in (raises(canvas._check_save_denylist, canvas._plugin_dir() / "canvas.py") or ""))

# Config files, profile configs (including symlinked profiles), code-exec dirs and shell rc files are refused on save_file (even with force=True).
cfg_path = os.path.join(hermes_dir, "config.yaml")
open(cfg_path, "w").write("approvals:\n  mode: manual\n")
prof_cfg = os.path.join(hermes_dir, "profiles", "work", "config.yaml")
open(prof_cfg, "w").write("approvals:\n  mode: manual\n")
linked_prof_cfg = os.path.join(linked_prof_real, "config.yaml")
open(linked_prof_cfg, "w").write("approvals:\n  mode: manual\n")
protected_save_files = [
    ("config.yaml", cfg_path),
    ("profile config.yaml", prof_cfg),
    ("symlinked profile config.yaml", linked_prof_cfg),
    (".bashrc", os.path.join(REAL_HOME, ".bashrc")),
    (".shinit", os.path.join(REAL_HOME, ".shinit")),
    (".cshrc", os.path.join(REAL_HOME, ".cshrc")),
    (".tcshrc", os.path.join(REAL_HOME, ".tcshrc")),
    (".kshrc", os.path.join(REAL_HOME, ".kshrc")),
    (".gitconfig", os.path.join(REAL_HOME, ".gitconfig")),
    (".config/git/config", os.path.join(REAL_HOME, ".config", "git", "config")),
    (".config/fish/config.fish", os.path.join(REAL_HOME, ".config", "fish", "config.fish")),
    ("~/bin script", os.path.join(REAL_HOME, "bin", "hm-local")),
    ("~/.local/bin script", os.path.join(REAL_HOME, ".local", "bin", "tool")),
]
for label, prot_p in protected_save_files:
    if not os.path.exists(prot_p):
        open(prot_p, "w").write("safe\n")
    orig = open(prot_p).read()
    od = canvas.open_file(S, prot_p)
    canvas.write(S, od["id"], "approvals:\n  mode: off\n", by="user")
    err = raises(canvas.save_file, S, od["id"], force=True)
    check(f"save_file refuses {label} even with force=True", "refused" in (err or "") and open(prot_p).read() == orig, str(err))

# Forged docs pointing to secret dirs (.android, .gnupg, .netrc, .aws, .termux) are also refused on save_file.
for label, sec_p in [(".android/adbkey", android_key), (".gnupg/secring.gpg", gnupg_key), (".netrc", netrc_path), (".aws/credentials", aws_creds), (".termux/termux.properties", termux_props)]:
    orig = open(sec_p).read()
    fd_sec = canvas.create(S, f"Forged-{label}", "evil", path=sec_p)
    err = raises(canvas.save_file, S, fd_sec["id"], force=True)
    check(f"save_file refuses forged doc for {label}", "refused" in (err or "") and open(sec_p).read() == orig, str(err))

# Forged doc with NUL byte in path raises refused CanvasError, not ValueError.
forged_nul = canvas.create(S, "ForgedNul", "evil", path=os.path.join(REAL_HOME, "bad\x00.txt"))
check("save_file refuses NUL byte path", "refused" in (raises(canvas.save_file, S, forged_nul["id"], force=True) or ""))

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
    S_HTTP = "chat-http"
    import inspect
    check("plugin_api._canvas registers hm_canvas after exec_module under a lock",
          hasattr(papi, "_CANVAS_LOCK") and "exec_module" in inspect.getsource(papi._canvas)
          and inspect.getsource(papi._canvas).index("exec_module") < inspect.getsource(papi._canvas).index('sys.modules["hm_canvas"] = mod'))
    for fn_name in ("canvas_list", "canvas_get", "canvas_version", "canvas_create", "canvas_write", "canvas_restore", "canvas_rename", "canvas_open_file", "canvas_save_file", "canvas_delete"):
        check(f"plugin_api.{fn_name} is sync def (off event loop)", not inspect.iscoroutinefunction(getattr(papi, fn_name)))
    r_nul = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S_HTTP, "path": os.path.join(REAL_HOME, "bad\x00.txt")})
    check("HTTP /canvas/open-file returns 403 for NUL byte path", r_nul.status_code == 403, r_nul.status_code)
    r_env = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S_HTTP, "path": env_path})
    check("HTTP /canvas/open-file returns 403 for .env", r_env.status_code == 403, r_env.status_code)
    r_cfg_open = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S_HTTP, "path": cfg_path})
    check("HTTP /canvas/open-file opens config.yaml read-only", r_cfg_open.status_code == 200, r_cfg_open.status_code)
    r_cfg_save = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S_HTTP, "id": r_cfg_open.json()["id"]})
    check("HTTP /canvas/save-file returns 403 for config.yaml", r_cfg_save.status_code == 403, r_cfg_save.status_code)
    http_f = os.path.join(REAL_HOME, "http-note.md")
    open(http_f, "w").write("v1")
    r_open = client.post("/api/plugins/hermes-mobile/canvas/open-file", json={"session": S_HTTP, "path": http_f})
    hid = r_open.json()["id"]
    canvas.write(S_HTTP, hid, "v2 from canvas", by="user")
    open(http_f, "w").write("v1 changed on disk")
    r_conf = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S_HTTP, "id": hid})
    check("HTTP /canvas/save-file returns 409 on disk change", r_conf.status_code == 409 and open(http_f).read() == "v1 changed on disk", r_conf.status_code)
    r_force = client.post("/api/plugins/hermes-mobile/canvas/save-file", json={"session": S_HTTP, "id": hid, "force": True})
    check("HTTP /canvas/save-file returns 200 with force=True", r_force.status_code == 200 and open(http_f).read() == "v2 from canvas", r_force.status_code)
except ImportError:
    pass

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
