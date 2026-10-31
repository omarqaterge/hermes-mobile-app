#!/usr/bin/env python3
"""A fake OpenAI-compatible model for tools/hermes-contract (Python standard library only, no key, no network beyond
127.0.0.1). It lets the pinned Hermes run one real model turn:

  POST /v1/chat/completions   streams (SSE) a canned reply. When the conversation has no tool result yet it answers
                              with some reasoning and ONE tool call (read_file on the file given as the 2nd argument);
                              once a tool result is in the conversation (the follow-up request) it answers with
                              reasoning and a text in several chunks, then stops. Without "stream": true the same
                              reply comes as one JSON body.
  GET  /v1/models             one model, so Hermes's model checks find it.

Usage: fake-model.py <port file> <file for the read_file call> [request log]
Picks a free port on 127.0.0.1, writes it to <port file> (the caller waits for that file), then serves until killed.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT_FILE, NOTE = sys.argv[1], sys.argv[2]
LOG = sys.argv[3] if len(sys.argv) > 3 else None
MODEL = "contract-model"
FINAL = ["The note says: ", "contract note. ", "Nothing else ", "to report."]
REASON1 = ["Let me read ", "the note first."]
REASON2 = ["I have the note, ", "now I can answer."]


def chunk(delta, finish=None, usage=None):
    c = {"id": "chatcmpl-contract", "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL,
         "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    if usage:
        c["usage"] = usage
    return c


def plan(body):
    """The chunks of the reply to this request, and its finish reason."""
    msgs = body.get("messages") or []
    if any(m.get("role") == "tool" for m in msgs):
        return [{"reasoning_content": t} for t in REASON2] + [{"content": t} for t in FINAL], "stop"
    call = {"name": "read_file", "arguments": json.dumps({"path": NOTE})}
    first = {"tool_calls": [{"index": 0, "id": "call_contract_1", "type": "function",
                             "function": {"name": call["name"], "arguments": call["arguments"][:12]}}]}
    rest = {"tool_calls": [{"index": 0, "function": {"arguments": call["arguments"][12:]}}]}
    return [{"reasoning_content": t} for t in REASON1] + [first, rest], "tool_calls"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            return self._json({"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "contract"}]})
        self._json({"error": {"message": "not found"}}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if LOG:
            with open(LOG, "a") as f:
                roles = [m.get("role") for m in body.get("messages", [])]
                f.write(json.dumps({"path": self.path, "stream": bool(body.get("stream")), "roles": roles,
                                    "tools": len(body.get("tools") or [])}) + "\n")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._json({"error": {"message": "not found"}}, 404)
        deltas, finish = plan(body)
        usage = {"prompt_tokens": 120, "completion_tokens": 20, "total_tokens": 140}
        if not body.get("stream"):
            msg = {"role": "assistant", "content": "".join(d.get("content", "") for d in deltas) or None}
            for d in deltas:
                if "tool_calls" in d and "id" in d["tool_calls"][0]:
                    msg["tool_calls"] = [{"id": "call_contract_1", "type": "function", "function": {
                        "name": "read_file", "arguments": json.dumps({"path": NOTE})}}]
            return self._json({"id": "chatcmpl-contract", "object": "chat.completion", "created": int(time.time()),
                               "model": MODEL, "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                               "usage": usage})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        out = [chunk({"role": "assistant", "content": ""})] + [chunk(d) for d in deltas]
        out += [chunk({}, finish), chunk({}, None, usage) | {"choices": []}]
        try:
            for c in out:
                self.wfile.write(b"data: " + json.dumps(c).encode() + b"\n\n")
                self.wfile.flush()
                time.sleep(0.05)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(PORT_FILE, "w") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
