# Checks hermes/patches/0002 on the real phone: a throwaway chat with the model picked before the first message,
# a code word, a switch, another code word, a switch, an edit of the first message (new code word), then the model
# is asked for every code word. Fixed Hermes answers only the edited one (OTTER); before the fix, messages sent
# around a switch went missing from its history. Spends a little model quota; the chat is deleted at the end.
# Run inside Debian with Hermes's Python, two models of yours (any provider):
#   tools/phone "proot-distro login debian -- bash -lc 'PY=\$(ls -td /root/.hermes/installs/*/environments/*/venv/bin/python3 | head -1); exec \$PY - \"<model-a> --provider <p>\" \"<model-b> --provider <p>\"'" < tools/probe_model_switch.py
import asyncio, json, re, sys, urllib.request
import websockets
page = urllib.request.urlopen("http://127.0.0.1:9119/").read().decode()
token = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page).group(1)
A, B = (v if "--session" in v else v + " --session" for v in sys.argv[1:3])

async def main():
    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={token}", max_size=None) as ws:
        n = [0]; events = []
        async def recv(timeout):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
            if msg.get("method") == "event": events.append(msg["params"])
            return msg
        async def call(m, p):
            n[0] += 1; i = n[0]
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": i, "method": m, "params": p}))
            while True:
                msg = await recv(120)
                if msg.get("id") == i and "method" not in msg:
                    if "error" in msg: raise RuntimeError(f"{m}: {msg['error']}")
                    return msg["result"]
        async def wait(t, sid, timeout=180):
            end = asyncio.get_event_loop().time() + timeout
            while True:
                for e in events:
                    if e.get("type") == t and e.get("session_id") == sid:
                        events.remove(e); return e
                await recv(end - asyncio.get_event_loop().time())
        async def turn(sid, text):
            await call("prompt.submit", {"session_id": sid, "text": text, "surface": "mobile"})
            t = (await wait("message.complete", sid)).get("payload", {}).get("text", ""); print("  reply:", repr(t[:80])); return t
        r = await call("session.create", {"source": "mobile"})
        sid, stored = r["session_id"], r["stored_session_id"]
        try:
            await wait("session.info", sid, 30)
            await call("config.set", {"session_id": sid, "key": "model", "value": A})
            r1 = await call("prompt.submit", {"session_id": sid, "text": "HM-TEST message one. Code word: PELICAN. Reply with just: ok", "surface": "mobile"})
            await wait("message.complete", sid)
            await turn(sid, "HM-TEST message two. Reply with just: ok")
            await call("config.set", {"session_id": sid, "key": "model", "value": B})
            await turn(sid, "HM-TEST message three. Code word: WALRUS. Reply with just: ok")
            await call("config.set", {"session_id": sid, "key": "model", "value": A})
            r = await call("prompt.submit", {"session_id": sid, "text": "HM-TEST edited first message. Code word: OTTER. Reply with just: ok", "surface": "mobile", "truncate_before_row_id": r1["user_row_id"], "confirm_truncate": True, "confirm_empty_truncate": True})
            await wait("message.complete", sid)
            h = await call("session.history", {"session_id": sid})
            print("stored user turns after edit:", [m.get("text") or m.get("content") for m in h["messages"] if m.get("role") == "user" and not m.get("display_kind")])
            ans = await turn(sid, "HM-TEST final. List every code word I gave you in this chat, comma separated, nothing else. If you see none, say NONE.")
            print("MODEL ANSWER:", ans.strip())
            print("SESSION", stored)
        finally:
            await call("session.close", {"session_id": sid})
            await call("session.delete", {"session_id": stored})
            print("deleted", stored)
asyncio.run(main())
