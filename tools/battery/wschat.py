#!/usr/bin/env python3
"""One benchmark chat turn over Hermes's gateway WebSocket (the same JSON-RPC the app uses), from the computer
through `adb forward tcp:9119`. Prints one JSON line per milestone; after the reply it stays attached (like the app
showing the chat) until a line arrives on stdin, then closes and DELETES the chat.

    python3 tools/battery/wschat.py "<prompt>"        (needs `pip install websockets`)
"""
import asyncio
import json
import re
import subprocess
import sys
import time
import urllib.request

import websockets

HERMES = "http://127.0.0.1:9119"


def out(ev, **kw):
    print(json.dumps({"t": time.time(), "ev": ev, **kw}), flush=True)


async def main(prompt):
    subprocess.run(["adb", "forward", "tcp:9119", "tcp:9119"], capture_output=True)
    page = urllib.request.urlopen(HERMES + "/", timeout=15).read().decode()
    token = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page).group(1)
    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={token}", max_size=None) as ws:
        ids = iter(range(1, 10**6))
        pending = {}
        events = asyncio.Queue()

        async def reader():
            async for raw in ws:
                msg = json.loads(raw)
                if "id" in msg and "method" not in msg and msg["id"] in pending:
                    pending.pop(msg["id"]).set_result(msg)
                elif msg.get("method") == "event":
                    await events.put(msg.get("params") or {})

        async def rpc(method, params, timeout=120):
            n = next(ids)
            fut = asyncio.get_running_loop().create_future()
            pending[n] = fut
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params}))
            msg = await asyncio.wait_for(fut, timeout)
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error']}")
            return msg.get("result") or {}

        task = asyncio.create_task(reader())
        r = await rpc("session.create", {"source": "mobile"})
        sid, stored = r.get("session_id"), r.get("stored_session_id")
        out("created", session=sid, stored=stored)
        # The agent is built in the background; its first session.info says it is ready (see gateway.ts trackBuild).
        t_end = time.time() + 20
        while time.time() < t_end:
            try:
                e = await asyncio.wait_for(events.get(), max(0.1, t_end - time.time()))
            except asyncio.TimeoutError:
                break
            if e.get("type") == "session.info":
                break
        out("built")
        await rpc("prompt.submit", {"session_id": sid, "text": prompt, "surface": "mobile"})
        out("sent")
        deltas = chars = tools = 0
        while True:
            e = await asyncio.wait_for(events.get(), 900)
            t = e.get("type")
            if t in ("message.delta", "reasoning.delta"):
                deltas += 1
                chars += len(str((e.get("payload") or {}).get("text") or ""))
            elif t == "tool.start":
                tools += 1
            elif t == "message.complete":
                out("complete", deltas=deltas, chars=chars, tools=tools)
                break
            elif t == "error":
                out("error", payload=e.get("payload"))
                break
        await asyncio.get_running_loop().run_in_executor(None, sys.stdin.readline)
        try:
            await rpc("session.close", {"session_id": sid}, 30)
        except Exception as e:  # noqa: BLE001
            out("close-failed", error=str(e))
        try:
            await rpc("session.delete", {"session_id": stored}, 30)
            out("deleted", stored=stored)
        except Exception as e:  # noqa: BLE001
            out("delete-failed", error=str(e), stored=stored)
        task.cancel()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
