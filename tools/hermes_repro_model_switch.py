"""Repro: a prompt sent right after a model switch vanishes from the model's context at the next switch.

Run from a hermes-agent checkout (no API key, no network):  python /path/to/tools/hermes_repro_model_switch.py
Prints "LOST: ['PROMPT-2']" on Hermes without hermes/patches/0002, "LOST: nothing" with it.
Starts a fake OpenAI-compatible server that records each request, points a temp HERMES_HOME at it, drives
`python -m tui_gateway.entry` (the backend the TUI/Desktop use) over stdio, and prints the user turns the
model received on the last request.
"""
import json, os, queue, re, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

requests = []


class FakeLLM(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._json({"object": "list", "data": [{"id": m, "object": "model"} for m in ("model-a", "model-b")]})

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if req.get("tools"):  # the main agent call (aux calls send no tools)
            requests.append(req["messages"])
        chunk = {"id": "c", "object": "chat.completion.chunk", "created": 0, "model": req.get("model")}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for delta, finish in (({"role": "assistant", "content": "ok"}, None), ({}, "stop")):
            self.wfile.write(f"data: {json.dumps({**chunk, 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


server = ThreadingHTTPServer(("127.0.0.1", 0), FakeLLM)
threading.Thread(target=server.serve_forever, daemon=True).start()
home = tempfile.mkdtemp()
with open(os.path.join(home, "config.yaml"), "w") as f:
    f.write(f"model:\n  default: model-a\n  provider: custom\n  base_url: http://127.0.0.1:{server.server_port}/v1\n"
            "  api_key: sk-fake\nauxiliary:\n  title_generation:\n    enabled: false\n")

gw = subprocess.Popen([sys.executable, "-m", "tui_gateway.entry"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                      stderr=subprocess.DEVNULL, text=True, env={**os.environ, "HERMES_HOME": home})
replies, events, ids = {}, queue.Queue(), iter(range(1, 10**6))


def read():
    for line in gw.stdout:
        msg = json.loads(line)
        if msg.get("method") == "event":
            events.put(msg["params"])
        elif "id" in msg:
            replies[msg["id"]] = msg


threading.Thread(target=read, daemon=True).start()


def call(method, **params):
    i = str(next(ids))
    gw.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n")
    gw.stdin.flush()
    while i not in replies:
        time.sleep(0.05)
    assert "error" not in replies[i], replies[i]
    return replies[i]["result"]


def wait(kind, sid):
    while (e := events.get(timeout=120))["type"] != kind or e.get("session_id") != sid:
        pass


def prompt(sid, text):
    call("prompt.submit", session_id=sid, text=text)
    wait("message.complete", sid)


def switch(sid, model):
    call("config.set", session_id=sid, key="model", value=f"{model} --provider custom --session")


sid = call("session.create")["session_id"]
wait("session.info", sid)
prompt(sid, "PROMPT-1")
switch(sid, "model-b")
prompt(sid, "PROMPT-2 (sent right after a switch)")
switch(sid, "model-a")
prompt(sid, "PROMPT-3")
gw.kill()

sent = [m["content"] for m in requests[-1] if m["role"] == "user"]
print("user turns in the last request:")
for content in sent:
    content = re.sub(r"\[System: The active model[^\]]*\]", "<model-switch marker>", content)
    content = re.sub(r"\[System note: This is the user's very first message ever[^\]]*\]", "<first-run note>", content)
    print("  ", repr(content))
lost = [p for p in ("PROMPT-1", "PROMPT-2", "PROMPT-3") if not any(p in c for c in sent)]
print("LOST:", lost or "nothing")
