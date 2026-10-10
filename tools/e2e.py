#!/usr/bin/env python3
"""End-to-end checks against the real phone (ADB + the app's loopback event service + the plugin API).

    python3 tools/e2e.py            # everything (~2 min)
    python3 tools/e2e.py --quick    # skips the 55 s heartbeat-expiry wait
    python3 tools/e2e.py --live     # also runs a real (tiny) Hermes turn and drops the WebSocket mid-turn

It sends fake events, so it never touches your chats unless --live is given (that creates one
"e2e" chat, which it deletes again). Leave the phone unlocked. If the app is on screen it is sent to the
background for the run (it shows approvals in its own sheet then, not as notifications) and brought back after.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results = []


def sh(cmd, inp=None, timeout=60):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, input=inp, timeout=timeout).stdout


def pick_device():
    if os.environ.get("ANDROID_SERIAL"):
        return
    devs = [l.split("\t")[0] for l in sh("adb devices").splitlines()[1:] if l.strip().endswith("device")]
    devs = [d for d in devs if "(" not in d] or devs  # the wireless duplicate is listed as "name (2)._adb-tls…"
    if devs:
        os.environ["ANDROID_SERIAL"] = devs[0]


def phone(cmd, inp=None):
    return sh(f"{HERE}/phone {shlex.quote(cmd)}", inp)


def event(obj):
    body = json.dumps(obj)
    script = f'K=$(cat ~/.hermes-mobile/key); curl -s -o /dev/null -w "%{{http_code}}" -H "X-Hermes-Mobile-Key: $K" -H "Content-Type: application/json" -d \'{body}\' http://127.0.0.1:9121/event'
    return phone("bash -s", script).strip()


def notifications():
    return sh("adb shell dumpsys notification --noredact")


def chip_on():
    return "Status: Thinking" in notifications()


def api(path):
    out = sh(f"{HERE}/api GET {json.dumps(path)}")
    try:
        return json.loads(out)
    except Exception:
        return None


APP = "com.omarqaterge.hermesmobile"


def app_in_front():
    return f"{APP}/" in sh("adb shell dumpsys window | grep mCurrentFocus")


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{PASS if ok else FAIL}] {name}" + (f"  ({detail})" if detail and not ok else ""))


def wait_until(fn, secs, step=2):
    end = time.time() + secs
    while time.time() < end:
        if fn():
            return True
        time.sleep(step)
    return fn()


def python_on_phone(code):
    return phone(
        "proot-distro login debian -- bash -lc 'PY=$(ls -td /root/.hermes/installs/*/environments/*/venv/bin/python3 | head -1); $PY -'",
        code,
    )


def t_listener():
    print("event listener")
    check("good key accepted (204)", event({"kind": "status", "working": False, "body": "Ready"}) == "204")
    bad = phone('curl -s -o /dev/null -w "%{http_code}" -H "X-Hermes-Mobile-Key: nope" -d "{}" http://127.0.0.1:9121/event').strip()
    check("bad key rejected (403)", bad == "403", bad)


def t_chip(quick):
    print("status chip")
    event({"kind": "status", "working": True, "body": "Thinking", "short": "Thinking", "profile": "default"})
    check("chip appears when working", wait_until(chip_on, 8))
    event({"kind": "status", "working": False, "body": "Ready"})
    check("chip clears on Ready", wait_until(lambda: not chip_on(), 8))
    if quick:
        print("  (skipped) heartbeat expiry")
        return
    event({"kind": "status", "working": True, "body": "Thinking", "short": "Thinking", "profile": "default"})
    wait_until(chip_on, 8)
    check("chip expires by itself when the plugin goes silent (<= 65 s)", wait_until(lambda: not chip_on(), 65, 5))


def t_review():
    print("background review label + activity banner feed")
    sim = """
import importlib.util, time
s=importlib.util.spec_from_file_location('hm','/root/.hermes/plugins/hermes-mobile/__init__.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
m._post=lambda e: True
m._on_pre_llm_call(session_id='e2e-sim', turn_id='e2e-sim:u:1', user_message='Review the conversation above and update the skill library.')
m._on_stream_start(session_id='e2e-sim', turn_id='e2e-sim:u:1')
time.sleep(25)
m._on_post_llm_call(session_id='e2e-sim', turn_id='e2e-sim:u:1')
time.sleep(1)
"""
    import threading

    t = threading.Thread(target=python_on_phone, args=(sim,))
    t.start()
    def feed():
        return [i for i in (api("/api/plugins/hermes-mobile/activity") or {}).get("items", []) if i.get("session") == "e2e-sim"]

    wait_until(lambda: bool(feed()), 30, 2)  # the phone-side python takes a few seconds to start
    mine = feed()
    items = mine
    check("activity feed lists the review", bool(mine) and mine[0].get("review") is True, str(items)[:120])
    check("label says Learning, not Thinking", bool(mine) and "Learning" in mine[0].get("text", ""))
    t.join()
    time.sleep(1)
    items = (api("/api/plugins/hermes-mobile/activity") or {}).get("items", [])
    check("feed clears when the review ends", not [i for i in items if i.get("session") == "e2e-sim"])


def t_review_replay():
    print("real-format background review (turn ids as Hermes logs them)")
    code = open(os.path.join(HERE, "e2e_review_replay.py")).read()
    out = python_on_phone(code)
    check("review recognised and labelled", "review flag = True" in out and "Learning from this chat" in out, out[-200:])
    check("review cleared by its final stream_end", "after review final stream_end: active = False" in out)
    check("normal follow-up turn not mistaken for a review", "normal follow-up: text = Thinking… | review flag = False" in out)
    check("late uuid turn not mistaken for a review", "uuid turn, 20 s after last end: review flag = False" in out)


def api_call(method, path, body=None):
    """(status_ok, parsed json or text) for a dashboard REST call through tools/api (which exits non-zero on HTTP errors)."""
    args = f"{HERE}/api {method} {shlex.quote(path)}" + (f" {shlex.quote(json.dumps(body))}" if body is not None else "")
    r = subprocess.run(args, shell=True, capture_output=True, text=True)
    try:
        return r.returncode == 0, json.loads(r.stdout)
    except Exception:
        return r.returncode == 0, (r.stdout + r.stderr)


def t_canvas():
    print("canvas (tool + REST + versions + safety)")
    sid = "e2e-canvas"
    P = "/api/plugins/hermes-mobile/canvas"
    code = """
import importlib.util, json
s=importlib.util.spec_from_file_location('hm','/root/.hermes/plugins/hermes-mobile/canvas.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
c=lambda **a: json.loads(m.tool_handler(a, session_id='e2e-canvas'))
r=c(action='create', title='E2E note', content='alpha beta', type='markdown'); print('CREATE', r['ok'], r['rev'])
print('PATCH', c(action='patch', edits=[{'find':'beta','replace':'gamma'}])['ok'])
print('READ', c(action='read')['content'])
print('BADPATCH', c(action='patch', edits=[{'find':'zzz','replace':'y'}])['ok'])
"""
    out = python_on_phone(code)
    check("agent tool creates and patches a document on the phone", "CREATE True 1" in out and "PATCH True" in out and "READ alpha gamma" in out, out[-160:])
    check("a bad patch is reported, not raised", "BADPATCH False" in out)
    ok, docs = api_call("GET", f"{P}?session={sid}")
    doc = docs["docs"][0] if ok and docs.get("docs") else {}
    check("REST lists the agent's document", bool(doc) and doc.get("by") == "agent" and doc.get("rev") == 2)
    ok, w = api_call("PUT", f"{P}/doc", {"session": sid, "id": doc.get("id", ""), "content": "user text", "base_rev": 2})
    check("user edit saves (as the user)", ok and w.get("rev") == 3)
    ok, _ = api_call("PUT", f"{P}/doc", {"session": sid, "id": doc.get("id", ""), "content": "stale", "base_rev": 2})
    check("a stale edit is refused (409)", not ok)
    ok, full = api_call("GET", f"{P}/doc?session={sid}&id={doc.get('id', '')}")
    check("history keeps who changed what", ok and [v["by"] for v in full["versions"]] == ["agent", "agent", "user"])
    ok, r = api_call("POST", f"{P}/restore", {"session": sid, "id": doc.get("id", ""), "rev": 1})
    check("restore brings an old version back", ok and r.get("rev") == 4)
    ok, _ = api_call("POST", f"{P}/open-file", {"session": sid, "path": "/bin/ls"})
    check("a binary file is refused", not ok)
    ok, _ = api_call("POST", f"{P}/open-file", {"session": sid, "path": "relative.txt"})
    check("a relative path is refused", not ok)
    api_call("DELETE", f"{P}/doc?session={sid}&id={doc.get('id', '')}")
    phone("rm -rf $PREFIX/var/lib/proot-distro/containers/debian/rootfs/root/.hermes/mobile/canvas/e2e-canvas")


def t_approval():
    print("approval notification")
    event({"kind": "approval", "title": "Hermes", "body": "e2e approval (ignore)", "what": "e2e", "command": "echo hi",
           "session": "e2e-appr", "timeout": 60})
    time.sleep(3)
    n = notifications()
    check("approval notification posted", "tag=approval:e2e-appr" in n)
    m = re.search(r"tag=approval:e2e-appr.*?when=(\d+)", n, re.S)
    first = m.group(1) if m else None
    time.sleep(19)
    m2 = re.search(r"tag=approval:e2e-appr.*?when=(\d+)", notifications(), re.S)
    check("popped up again at ~20 s while unanswered", bool(first and m2 and m2.group(1) != first))
    event({"kind": "clear", "what": "approval", "session": "e2e-appr"})
    time.sleep(1)
    check("cleared when answered", "tag=approval:e2e-appr" not in notifications())
    event({"kind": "status", "working": False, "body": "Ready"})


def t_live():
    print("live turn + WebSocket dropped mid-turn (uses a little model quota)")
    code = r'''
import asyncio, json, re, urllib.request, websockets
page = urllib.request.urlopen("http://127.0.0.1:9119/").read().decode()
token = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page).group(1)
async def main():
    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={token}", max_size=None) as ws:
        async def call(i, m, p):
            await ws.send(json.dumps({"jsonrpc":"2.0","id":i,"method":m,"params":p}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id")==i and "method" not in msg: return msg.get("result", msg.get("error"))
        r = await call(1,"session.create",{"source":"mobile"})
        print("SESSION", r.get("stored_session_id"), flush=True)
        await call(2,"prompt.submit",{"session_id":r["session_id"],"text":"e2e test: run the shell command `sleep 20` then reply: done"})
        await asyncio.sleep(5)
asyncio.run(main())
'''
    out = python_on_phone(code)
    sid = (re.search(r"SESSION (\S+)", out) or [None, None])[1]
    check("chip clears after the turn ends (<= 90 s) even though the socket dropped", wait_until(lambda: not chip_on(), 90, 5))
    if sid:
        sh(f"{HERE}/gw session.delete {shlex.quote(json.dumps({'session_id': sid}))}")


def main():
    quick = "--quick" in sys.argv
    pick_device()
    was_in_front = app_in_front()
    if was_in_front:
        sh("adb shell input keyevent KEYCODE_HOME")
        wait_until(lambda: not app_in_front(), 5, 1)
    try:
        run(quick)
    finally:
        if was_in_front:
            sh(f"adb shell monkey -p {APP} -c android.intent.category.LAUNCHER 1")
    ok = sum(results)
    print(f"\n{ok}/{len(results)} passed")
    sys.exit(0 if ok == len(results) else 1)


def run(quick):
    t_listener()
    t_chip(quick)
    t_review()
    t_review_replay()
    t_canvas()
    t_approval()
    if "--live" in sys.argv:
        t_live()


if __name__ == "__main__":
    main()
