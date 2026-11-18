#!/usr/bin/env python3
"""What GET /activity says about requests that wait for the user (`waiting`, the app's "Needs you"), no phone needed:
it follows the hooks, outlives the limits on working entries, says nothing of the request's text and ends when the
request does.
    python3 tools/test_waiting.py
"""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
home = tempfile.mkdtemp(prefix="hm-waiting-")
os.environ["HOME"] = home  # the activity file and everything else the plugin writes stay out of the real home
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:
    import fastapi  # noqa: F401
except ImportError:  # only the module-level names plugin_api uses
    class _Router:
        def __getattr__(self, _):
            return lambda *a, **k: (lambda f: f)
    sys.modules["fastapi"] = types.SimpleNamespace(APIRouter=_Router, HTTPException=Exception, Request=object)
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)

plugin = load("hermes_mobile_waiting", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
papi = load("plugin_api_waiting", ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py")
papi._slow_all = lambda: None
_Path = papi.Path


def _path(*parts):  # /proc as on the phone, also on a computer without one: only this process is alive
    if parts and parts[0] == "/proc":
        return types.SimpleNamespace(exists=lambda: parts[1] == str(os.getpid()))
    return _Path(*parts)


_path.home = _Path.home
papi.Path = _path
plugin._send = lambda *a, **kw: None
# The status thread sleeps on the event it was started with: a new one never wakes it, so it can't write the file mid-test.
plugin._status_dirty = types.SimpleNamespace(set=lambda: None)
plugin.ACTIVITY_FILE = os.path.join(home, ".hermes", "mobile", "activity.json")


def answer():
    return asyncio.run(papi.get_activity())


def waiting():
    return answer()["waiting"]


def rewrite(fn):
    with open(plugin.ACTIVITY_FILE) as f:
        data = json.load(f)
    fn(data)
    with open(plugin.ACTIVITY_FILE, "w") as f:
        json.dump(data, f)


print("no activity file")
check("the answer has both lists", answer() == {"items": [], "waiting": []}, answer())

print("an approval")
secret = "curl -H 'Authorization: Bearer abc123' https://example.invalid"
plugin._on_pre_approval_request(command=secret, description="sends a token", session_key="key", session_id="chat-1")
w = waiting()
check("the chat is listed as waiting for an approval", [(x["session"], x["kind"], x["who"]) for x in w] == [("chat-1", "approval", "")], w)
check("it has a start and an end", w and w[0]["since"] <= time.time() < w[0]["until"], w)
check("only the chat, the kind, who, the bot, the times and the count", w and set(w[0]) == {"session", "kind", "who", "profile", "since", "until", "open", "last"}, w)
check("one request is open", w and w[0]["open"] == 1 and w[0]["last"] == w[0]["since"], w)
text = json.dumps(answer()["waiting"])
check("no word of the request", "abc123" not in text and "curl" not in text and "token" not in text, text)
check("the working list keeps its own fields", all(set(i) == {"session", "text", "short", "profile", "review", "ts"} for i in answer()["items"]), answer()["items"])

print("it outlives the limits on working entries")
rewrite(lambda d: [e.update(at=time.time() - 3000, items=[dict(i, ts=time.time() - 3000) for i in e["items"]]) for e in d.values()])
check("working entries of that age are gone", answer()["items"] == [], answer()["items"])
check("the request is still listed", [x["session"] for x in waiting()] == ["chat-1"], waiting())
plugin._publish_activity()
check("another write keeps it", [x["session"] for x in waiting()] == ["chat-1"], waiting())

print("it ends with the request")
plugin._on_post_approval_response(session_key="key", session_id="chat-1", command=secret, choice="once")
check("answered: gone", waiting() == [], waiting())

print("two at once, and one that waits on another")
for cmd in ("a", "b"):
    plugin._on_pre_approval_request(command=cmd, session_key="key", session_id="chat-2")
check("one row for the chat", len(waiting()) == 1, waiting())
check("counting both", waiting()[0]["open"] == 2 and waiting()[0]["last"] > waiting()[0]["since"], waiting())
plugin._on_pre_approval_request(command="a", session_key="key", session_id="chat-2", coalesced=True)
plugin._on_post_approval_response(session_key="key", session_id="chat-2", command="a", coalesced=True, choice="once")
check("a coalesced request changes nothing", len(waiting()) == 1, waiting())
plugin._on_post_approval_response(session_key="key", session_id="chat-2", command="a", choice="once")
check("one answered: still waiting for the other", len(waiting()) == 1 and waiting()[0]["open"] == 1, waiting())
plugin._on_post_approval_response(session_key="key", session_id="chat-2", command="b", choice="deny")
check("both answered: gone", waiting() == [], waiting())

print("kinds")
plugin._on_pre_approval_request(command=plugin.PHONE_DATA_COMMAND, description="phone_data:v1:x", session_key="key", session_id="chat-3")
check("a phone data request has its own kind", [x["kind"] for x in waiting()] == ["phone_data"], waiting())
plugin._on_post_approval_response(session_key="key", session_id="chat-3", command=plugin.PHONE_DATA_COMMAND, choice="deny")
check("and ends the same way", waiting() == [], waiting())
plugin._on_pre_tool_call(tool_name="clarify", args={"question": "Which private thing?"}, session_id="chat-4")
check("a question is listed", [(x["session"], x["kind"]) for x in waiting()] == [("chat-4", "question")], waiting())
check("without its text", "private" not in json.dumps(waiting()), waiting())
plugin._on_post_tool_call(tool_name="clarify", args={}, session_id="chat-4")
check("answered: gone", waiting() == [], waiting())

print("a sub-agent asks")
plugin._on_subagent_start(child_session_id="kid", parent_session_id="chat-5", child_goal="read the private plan")
plugin._on_subagent_start(child_session_id="grandkid", parent_session_id="kid", child_goal="x")
plugin._on_pre_approval_request(command="rm x", session_key="key", session_id="grandkid")
w = waiting()
check("the top chat is listed, saying who asks", [(x["session"], x["who"]) for x in w] == [("chat-5", "A sub-agent")], w)
check("its goal is not", "private" not in json.dumps(w), w)
plugin._on_post_approval_response(session_key="key", session_id="grandkid", command="rm x", choice="deny")
check("answered: gone", waiting() == [], waiting())

print("how a wait can end without an answer")
plugin._on_pre_tool_call(tool_name="clarify", args={"question": "q"}, session_id="chat-6")
plugin._on_session_end(session_id="chat-6", interrupted=True)
check("the turn ended: gone", waiting() == [], waiting())
plugin._wait_begin("chat-7", "approval", 300)
rewrite(lambda d: [w.update(until=time.time() - 1) for e in d.values() for w in e.get("waiting", [])])
check("past its time limit: not listed", waiting() == [], waiting())
plugin._waiting.clear()
plugin._wait_begin("chat-8", "question", 0)
check("no time limit in Hermes: listed, with a limit of ours", waiting() and waiting()[0]["until"] <= time.time() + plugin.WAIT_LONGEST, waiting())
plugin._waiting.clear()
plugin._publish_activity()
check("its process gone quiet with nothing open: nothing", waiting() == [], waiting())
plugin._wait_begin("chat-9", "approval", 300)
rewrite(lambda d: d.update({"999999999": d.pop(str(os.getpid()))}))
check("its process died: not listed", waiting() == [], waiting())
plugin._waiting.clear()

print("bounded")
for i in range(plugin.MAX_WAITING + 10):
    plugin._waiting[(f"c{i}", "approval", "")] = {"session": f"c{i}", "kind": "approval", "who": "", "profile": "p",
                                                  "since": 1.0, "until": time.time() + 60, "open": 1, "last": 1.0}
plugin._wait_begin("last", "approval", 60)
check("the oldest go", len(plugin._waiting) <= plugin.MAX_WAITING and ("last", "approval", "") in plugin._waiting, len(plugin._waiting))

print("writing the shared file")
import fcntl  # noqa: E402


def entries():
    with open(plugin.ACTIVITY_FILE) as f:
        return json.load(f)


other = {"at": time.time(), "items": [], "waiting": [{"session": "their-chat", "kind": "approval", "who": "", "profile": "p",
                                                     "since": time.time(), "until": time.time() + 300}]}
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({"4242": other}, f)
names = []
real_replace = os.replace
os.replace = lambda a, b: (names.append(a), real_replace(a, b))[1]
plugin._publish_activity()
plugin._publish_activity()
os.replace = real_replace
check("each write has its own temporary file", len(set(names)) == 2, names)
check("no temporary file is left", sorted(os.listdir(os.path.dirname(plugin.ACTIVITY_FILE))) == ["activity.json", "activity.json.lock"],
      os.listdir(os.path.dirname(plugin.ACTIVITY_FILE)))

holder = os.open(plugin.ACTIVITY_FILE + ".lock", os.O_CREAT | os.O_RDWR)
fcntl.flock(holder, fcntl.LOCK_EX)
slept = []


def other_writer_finishes(_):
    # The process holding the lock adds its entry and lets go while we wait: what we write must include it.
    slept.append(1)
    data = entries()
    data["5151"] = other
    with open(plugin.ACTIVITY_FILE, "w") as f:
        json.dump(data, f)
    fcntl.flock(holder, fcntl.LOCK_UN)


real_sleep = plugin.time.sleep
plugin.time.sleep = other_writer_finishes
plugin._wait_begin("my-chat", "approval", 300)
plugin.time.sleep = real_sleep
check("a held lock is waited for", len(slept) == 1, slept)
check("the file is read after the lock is ours: the other writer's entry stays", "5151" in entries(), list(entries()))
fcntl.flock(holder, fcntl.LOCK_EX)
slept.clear()
plugin.time.sleep = lambda s: slept.append(s)
plugin._waiting.clear()
plugin._wait_begin("still-written", "approval", 300)
plugin.time.sleep = real_sleep
fcntl.flock(holder, fcntl.LOCK_UN)
os.close(holder)
check("a lock that stays held costs a few short tries", len(slept) == plugin.ACTIVITY_LOCK_TRIES - 1 and sum(slept) < 0.2, slept)
check("and the write goes on without it", any(w["session"] == "still-written" for w in entries()[str(os.getpid())]["waiting"]), entries())
real_flock = fcntl.flock


def no_locks(*_):
    raise OSError(38, "not implemented")


fcntl.flock = no_locks
plugin._waiting.clear()
plugin._wait_begin("no-locks-here", "approval", 300)
fcntl.flock = real_flock
check("a system without file locks writes as before", any(w["session"] == "no-locks-here" for w in entries()[str(os.getpid())]["waiting"]), entries())
saved = sys.modules.get("fcntl")
sys.modules["fcntl"] = None
plugin._waiting.clear()
plugin._wait_begin("no-fcntl", "approval", 300)
sys.modules["fcntl"] = saved
check("nor does a missing lock module stop it", any(w["session"] == "no-fcntl" for w in entries()[str(os.getpid())]["waiting"]), entries())

for name, broken in (("damaged", "{not json"), ("not an object", "[1, 2]")):
    plugin._publish_activity()
    with open(plugin.ACTIVITY_FILE, "w") as f:
        f.write(broken)
    plugin._publish_activity()
    check(f"a {name} file does not wipe another process's open request", "4242" in entries(), list(entries()))
os.remove(plugin.ACTIVITY_FILE)
plugin._waiting.clear()
plugin._active.clear()
plugin._publish_activity()
check("a removed file starts empty", entries() == {}, entries())

print("what the file can't make the feed say")
now = time.time()
good = {"session": "real", "kind": "approval", "who": "", "profile": "p", "since": now, "until": now + 60}
alive = str(os.getpid())
forged = [  # each of these must be refused
    "not a dict", 7, None, ["x"],
    dict(good, session=""), dict(good, session=5), dict(good, kind="anything the agent likes"), dict(good, kind=["approval"]),
    dict(good, who="Your bank"), dict(good, who=["A sub-agent"]), dict(good, until=now + plugin.WAIT_LONGEST + 600),
    dict(good, until="soon"), dict(good, until=True), dict(good, until=float("inf")), dict(good, until=float("nan")),
    dict(good, since="then"), dict(good, since=float("nan")),
]
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({alive: {"at": now, "items": [], "waiting": forged + [dict(good, extra="request text", open="many", last="never")]},
               "not-a-pid": {"at": now, "items": [], "waiting": [dict(good, session="no-pid")]},
               "111": "not a dict", "112": None, "113": ["x"]}, f)
w = waiting()
check("only the well-formed entry of a real process is served", [x["session"] for x in w] == ["real"], w)
check("with only the known fields", set(w[0]) == {"session", "kind", "who", "profile", "since", "until", "open", "last"} if w else False, w)
check("a count that makes no sense counts as one", w and w[0]["open"] == 1, w)
check("the limits agree", papi.WAIT_LONGEST == plugin.WAIT_LONGEST and papi.WAIT_KINDS == plugin.WAIT_KINDS and papi.WAIT_WHO == plugin.WAIT_WHO)
with open(plugin.ACTIVITY_FILE, "w") as f:  # as another process's entry: a writer replaces its own
    json.dump({"4343": {"at": now, "items": [], "waiting": forged + [good]},
               "not-a-pid": {"at": now, "items": [], "waiting": [dict(good, session="no-pid")]},
               "111": "not a dict", "112": None, "113": ["x"]}, f)
plugin._waiting.clear()
plugin._active.clear()
plugin._publish_activity()
kept = entries()
check("the writer survives all of it and keeps only the good entry", list(kept) == ["4343"] and [x["session"] for x in kept["4343"]["waiting"]] == ["real"], kept)
plugin._waiting.clear()
plugin._wait_begin("long", "question", 10 * plugin.WAIT_LONGEST)
plugin._wait_begin("endless", "question", float("inf"))
check("a very long limit from Hermes is capped", all(v["until"] <= time.time() + plugin.WAIT_LONGEST for v in plugin._waiting.values()) and len(waiting()) >= 2, plugin._waiting)
plugin._waiting.clear()
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({alive: {"at": "x", "items": [{"session": "bad-at", "ts": now}]},
               "1": {"at": now, "items": "nope"},
               str(os.getpid()) + "0": {"at": now},
               "text-key": "not a dict", "other-key": 5,
               }, f)
check("a malformed working entry can't stop the feed", answer() == {"items": [], "waiting": []}, answer())
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({alive: {"at": now, "items": ["x", {"session": "no-ts"}, {"session": "bad", "ts": "y"}, {"session": "fine", "ts": now}]}}, f)
check("nor a malformed item", [i["session"] for i in answer()["items"]] == ["fine"], answer())
with open(plugin.ACTIVITY_FILE, "w") as f:
    f.write("[1, 2]")
check("nor a file that isn't an object", answer() == {"items": [], "waiting": []}, answer())
os.remove(plugin.ACTIVITY_FILE)

print("numbers too big for a float")
now = time.time()
huge = 10 ** 400
good = {"session": "real", "kind": "approval", "who": "", "profile": "p", "since": now, "until": now + 60}
check("a huge integer is not a number here", not plugin._is_number(huge) and not papi._is_number(huge))
bad = [dict(good, since=huge), dict(good, until=huge), dict(good, since=-huge)]
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({alive: {"at": huge, "items": [{"session": "x", "ts": huge}], "waiting": bad + [dict(good, open=huge, last=huge)]},
               "4444": {"at": now, "items": [{"session": "x", "ts": huge}]}}, f)
w = answer()["waiting"]
check("the route survives them and serves the good entry", [x["session"] for x in w] == ["real"] and w[0]["open"] == 1 and w[0]["last"] == now, w)
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({"4343": {"at": huge, "items": [1], "waiting": bad + [good]}}, f)
plugin._publish_activity()
check("a write survives them and keeps the good entry", [x["session"] for x in entries().get("4343", {}).get("waiting", [])] == ["real"], entries())
real_check = papi._waiting_entry
papi._waiting_entry = lambda pid, w, now: (_ for _ in ()).throw(RuntimeError("boom")) if w.get("session") == "breaks" else real_check(pid, w, now)
with open(plugin.ACTIVITY_FILE, "w") as f:
    json.dump({"1" + alive: {"at": now}, alive: {"at": now, "items": [], "waiting": [dict(good, session="breaks")]}}, f)
check("an entry that breaks is skipped alone", answer() == {"items": [], "waiting": []}, answer())
papi._waiting_entry = real_check
os.remove(plugin.ACTIVITY_FILE)

print("nothing here can answer")
src = (ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py").read_text()
route = src[src.index('@router.get("/activity")'):src.index("# ── what of the phone Hermes can reach")]
check("the route only reads", not any(w in route for w in ("resolve_gateway_approval", "write_text", ".post(", "respond")), route[:80])

print(f"{'all passed' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
