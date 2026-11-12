# Runs INSIDE Debian on the phone (fed over stdin by tools/gw). One tui_gateway JSON-RPC call.
import asyncio, base64, json, re, sys, urllib.request

import websockets

method = sys.argv[1]
params = json.loads(base64.b64decode(sys.argv[2]).decode()) if len(sys.argv) > 2 else {}
def _verified_token(port=9119):
    """The dashboard's session token from a verified dashboard only (local authentication, through the installed
    plugin's local_auth.py: the hello, the signed token request, the proof over the answer). The key is never sent."""
    import importlib.util, os
    spec = importlib.util.spec_from_file_location("hm_local_auth", "/root/.hermes/plugins/hermes-mobile/local_auth.py")
    la = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(la)
    k = os.environ.get("HM_EVENT_KEY") or open("/data/data/com.termux/files/home/.hermes-mobile/key").read().strip()
    return la.dashboard_token(port, k, timeout=10, server=os.environ.get("HM_DASH_ADDR") or None)


token = _verified_token()


async def main():
    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={token}", max_size=None) as ws:
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1 and "method" not in msg:
                print(json.dumps(msg.get("result", msg.get("error")), indent=2, ensure_ascii=False))
                return


asyncio.run(main())
