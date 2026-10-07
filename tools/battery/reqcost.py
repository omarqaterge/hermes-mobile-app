#!/usr/bin/env python3
"""What one app request costs Hermes's dashboard (python + its proot), in CPU ms, measured from /proc ticks.

    python3 tools/battery/reqcost.py [--n 10]

Runs each request N times over one WebSocket / HTTP keep-alive from the computer (adb forward 9119) and reads the
dashboard's CPU before and after through adb (shell user). Read-only requests only.
"""
import argparse
import asyncio
import json
import re
import subprocess
import time
import urllib.request

import websockets

HERMES = "http://127.0.0.1:9119"


def adb(cmd):
    return subprocess.run(["adb", "shell", cmd], capture_output=True, text=True).stdout


def dash_pids():
    out = adb("ps -A -o PID,PPID,NAME,ARGS")
    proot = next(l.split()[0] for l in out.splitlines() if " proot " in f" {l} " and "hermes dashboard" in l)
    py = next(l.split()[0] for l in out.splitlines() if l.split()[1:2] == [proot])
    return proot, py


def ticks(pids):
    out = adb(" ; ".join(f"cat /proc/{p}/stat" for p in pids))
    total = 0
    for line in out.splitlines():
        f = line[line.rindex(")") + 2:].split()
        total += sum(int(x) for x in f[11:15])
    return total


async def main(n):
    subprocess.run(["adb", "forward", "tcp:9119", "tcp:9119"], capture_output=True)
    page = urllib.request.urlopen(HERMES + "/").read().decode()
    token = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page).group(1)
    pids = dash_pids()

    def http(path):
        req = urllib.request.Request(HERMES + path, headers={"X-Hermes-Session-Token": token})
        urllib.request.urlopen(req, timeout=60).read()

    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={token}", max_size=None) as ws:
        seq = iter(range(1, 10**6))

        async def rpc(method, params):
            i = next(seq)
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == i:
                    return m.get("result")

        made = await rpc("session.create", {"source": "mobile"})
        sid = made["session_id"]
        await asyncio.sleep(8)  # the agent builds in the background
        cases = [
            ("GET /api/plugins/hermes-mobile/activity", lambda: http("/api/plugins/hermes-mobile/activity")),
            ("GET /api/status", lambda: http("/api/status")),
            ("GET /api/plugins/hermes-mobile/canvas", lambda: http(f"/api/plugins/hermes-mobile/canvas?session={made.get('stored_session_id')}")),
        ]
        rpcs = [("rpc session.list limit=100", "session.list", {"limit": 100}),
                ("rpc session.context_breakdown", "session.context_breakdown", {"session_id": sid}),
                ("rpc gateway.ping", "gateway.ping", {})]
        idle0 = ticks(pids)
        t0 = time.time()
        await asyncio.sleep(10)
        idle_rate = (ticks(pids) - idle0) / (time.time() - t0)  # ticks per second while nothing is asked
        print(f"dashboard idle: {idle_rate * 10:.1f} ms CPU per second")
        for name, fn in cases:
            a, t = ticks(pids), time.time()
            for _ in range(n):
                await asyncio.get_running_loop().run_in_executor(None, fn)
            cost = (ticks(pids) - a - idle_rate * (time.time() - t)) * 10 / n
            print(f"{name:40} {cost:7.0f} ms CPU each")
        for name, m, p in rpcs:
            a, t = ticks(pids), time.time()
            for _ in range(n):
                await rpc(m, p)
            cost = (ticks(pids) - a - idle_rate * (time.time() - t)) * 10 / n
            print(f"{name:40} {cost:7.0f} ms CPU each")
        await rpc("session.close", {"session_id": sid})
        await rpc("session.delete", {"session_id": made.get("stored_session_id")})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    asyncio.run(main(ap.parse_args().n))
