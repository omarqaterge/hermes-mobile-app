# Runs INSIDE Debian on the phone (fed over stdin by tools/gw-time). Times the two requests the app sends right after
# its socket opens at start-up, session.list and session.resume, alone and together, in the variants that could make
# them cheaper; then the other requests the app sends in the same moment (BURST), each alone, and all of them at once
# as the app does, to see whether they hold up the chat. Prints only timings, sizes and counts: never titles or chat text.
#   gw_time.py [session id] [runs]   (default: the newest chat, 3 runs; HM_GW_URL picks another dashboard)
# Each scenario opens a fresh socket, as the app does at start-up, closes the chats it resumed and waits for Hermes to
# settle (a resume builds the chat's agent in the background) before the next one.
import asyncio, json, os, re, statistics, sys, time, urllib.request

import websockets

BASE = os.environ.get("HM_GW_URL", "http://127.0.0.1:9119")
SETTLE_S = float(os.environ.get("HM_GW_SETTLE", "4"))
page = urllib.request.urlopen(BASE + "/").read().decode()
token = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page).group(1)
WS = BASE.replace("http", "ws", 1) + f"/api/ws?token={token}"
# What the app sends over HTTP in the same few milliseconds as session.list / session.resume at start-up (seen against
# the mock): App.tsx's health poll, the default model, the commands' skill descriptions, the plugin's prefs and activity.
BURST_HTTP = ["/api/status", "/api/status", "/api/model/info?profile=default", "/api/config?profile=default",
              "/api/skills?profile=default", "/api/plugins/hermes-mobile/prefs?profile=default",
              "/api/plugins/hermes-mobile/activity?profile=default"]


def http_get(path):
    """(ms, bytes) of one dashboard GET, as the app's bridge sends it."""
    t = time.perf_counter()
    req = urllib.request.Request(BASE + path, headers={"X-Hermes-Session-Token": token})
    try:
        size = len(urllib.request.urlopen(req, timeout=60).read())
    except Exception:
        size = -1
    return (time.perf_counter() - t) * 1000, size


async def call_many(reqs):
    """Send every (method, params) at once on a new socket; return [(ms from send to answer, bytes, result)]."""
    async with websockets.connect(WS, max_size=None) as ws:
        sent = {}
        for i, (method, params) in enumerate(reqs, 1):
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}))
            sent[i] = time.perf_counter()
        out = {}
        while len(out) < len(reqs):
            raw = await ws.recv()
            msg = json.loads(raw)
            if msg.get("id") in sent and "method" not in msg:
                out[msg["id"]] = ((time.perf_counter() - sent[msg["id"]]) * 1000, len(raw), msg.get("result") or {})
        closes = [r.get("session_id") for (_, _, r) in out.values() if isinstance(r, dict) and r.get("session_id")]
        for n, sid in enumerate(closes, 100):
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": n, "method": "session.close", "params": {"session_id": sid}}))
        return [out[i] for i in range(1, len(reqs) + 1)]


def resume_facts(result):
    msgs = result.get("messages") or []
    texts = [m.get("text") if isinstance(m.get("text"), str) else m.get("content") for m in msgs]
    texts = [t for t in texts if isinstance(t, str)]
    return f"{len(msgs)} messages, {sum('data:image/' in t for t in texts)} with an inline image"


async def main():
    target = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    if not target:
        (_, _, r), = await call_many([("session.list", {"limit": 1})])
        target = ((r.get("sessions") or [{}])[0]).get("id")
        if not target:
            sys.exit("no chat to resume")
    print(f"chat: the newest one ({len(target)}-character id); {runs} runs per scenario, {SETTLE_S:g} s apart\n")
    list80, list20 = ("session.list", {"limit": 80}), ("session.list", {"limit": 20})
    resume = ("session.resume", {"session_id": target})
    noimg = ("session.resume", {"session_id": target, "inline_images": False})
    scenarios = [
        ("list 80 alone", [list80]),
        ("list 20 alone", [list20]),
        ("resume alone", [resume]),
        ("resume, inline_images false, alone", [noimg]),
        ("list 80 + resume together (the app today)", [list80, resume]),
        ("list 20 + resume, inline_images false, together", [list20, noimg]),
    ]
    await timed_scenarios(scenarios, runs)
    await burst(target, runs)


async def timed_scenarios(scenarios, runs):
    for name, reqs in scenarios:
        times = [[] for _ in reqs]
        sizes, facts = [0] * len(reqs), ""
        for _ in range(runs):
            await asyncio.sleep(SETTLE_S)
            for k, (ms, size, result) in enumerate(await call_many(reqs)):
                times[k].append(ms)
                sizes[k] = size
                if reqs[k][0] == "session.resume":
                    facts = resume_facts(result)
        print(name)
        for k, (method, _) in enumerate(reqs):
            ts = ", ".join(f"{t:.0f}" for t in times[k])
            print(f"  {method:15} median {statistics.median(times[k]):6.0f} ms  ({ts})  reply {sizes[k] / 1024:.0f} KB")
        if facts:
            print(f"  resume: {facts}")



async def burst(target, runs):
    """The app's whole start-up burst: each extra request alone, then everything at once."""
    print("\neach other start-up request alone")
    for path in dict.fromkeys(BURST_HTTP):
        times = []
        for _ in range(runs):
            await asyncio.sleep(SETTLE_S)
            ms, size = await asyncio.to_thread(http_get, path)
            times.append(ms)
        print(f"  GET {path.split('?')[0]:40} median {statistics.median(times):6.0f} ms  reply {size / 1024:.0f} KB")
    await timed_scenarios([("commands.catalog alone", [("commands.catalog", {})])], runs)
    ws_reqs = [("commands.catalog", {}), ("session.list", {"limit": 80}), ("session.resume", {"session_id": target})]
    times = {k: [] for k in [m for m, _ in ws_reqs] + BURST_HTTP}
    for _ in range(runs):
        await asyncio.sleep(SETTLE_S)
        ws_res, *http_res = await asyncio.gather(call_many(ws_reqs), *[asyncio.to_thread(http_get, p) for p in BURST_HTTP])
        for (m, _), (ms, _, _) in zip(ws_reqs, ws_res):
            times[m].append(ms)
        for i, (ms, _) in enumerate(http_res):
            times.setdefault(f"{BURST_HTTP[i]}#{i}", []).append(ms)
    print("\neverything at once (the app's start-up)")
    for k, v in times.items():
        if v:
            print(f"  {k.split('?')[0]:45} median {statistics.median(v):6.0f} ms  ({', '.join(f'{t:.0f}' for t in v)})")


asyncio.run(main())
