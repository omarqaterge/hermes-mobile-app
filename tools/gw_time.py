# Runs INSIDE Debian on the phone (fed over stdin by tools/gw-time). Times the two requests the app sends right after
# its socket opens at start-up, session.list and session.resume, alone and together, in the variants that could make
# them cheaper. Prints only timings, sizes and counts: never titles or chat text.
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


asyncio.run(main())
