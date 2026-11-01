#!/usr/bin/env python3
"""A fake OpenAI-compatible model for tools/hermes-contract (Python standard library only, no key, no network beyond
127.0.0.1). It lets the pinned Hermes run real model turns, one script per prompt (SCRIPTS, keyed by the text of the
conversation's LAST user message; the same prompts have scripted turns in tools/web-e2e/mock.cjs):

  POST /v1/chat/completions   streams (SSE) a canned reply. A script is a list of tool calls and a final text: the reply
                              to a request is the script's next tool call (counted by the tool results after the last
                              user message), with some reasoning first, or the final text in several chunks once every
                              call has its result. The final text comes after a 1.6 s pause, so that Hermes's
                              once-a-second session.usage ticker fires during the turn. "slow reply" streams its text
                              over about 20 s, so that a turn can be interrupted while it runs. A title request
                              (Hermes's auxiliary title generation) gets {"title": "Contract title"}; a delegated
                              sub-agent (its goal is the user message) answers at once. Without "stream": true the
                              same reply comes as one JSON body.
  GET  /v1/models             one model, so Hermes's model checks find it.

Usage: fake-model.py <port file> <file for the read_file call> [request log]
The other scripts' files live next to the note: x (made world-writable by "run the thing", which Hermes asks to
approve) and site/ (edited by "edit files", so Hermes takes a checkpoint).
Picks a free port on 127.0.0.1, writes it to <port file> (the caller waits for that file), then serves until killed.
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT_FILE, NOTE = sys.argv[1], sys.argv[2]
LOG = sys.argv[3] if len(sys.argv) > 3 else None
WORK = os.path.dirname(os.path.abspath(NOTE))
MODEL = "contract-model"
SUB_GOAL = "Count to three"

# prompt -> (tool calls, final text chunks). Each tool call is (name, args).
SCRIPTS = {
    "read the note": ([("read_file", {"path": NOTE})], ["The note says: ", "contract note. ", "Nothing else ", "to report."]),
    # Hermes's dangerous-command check asks to approve a world-writable chmod (tools/approval_detection.py).
    "run the thing": ([("terminal", {"command": f"chmod 777 {WORK}/x"})], ["Ran ", "the thing."]),
    "ask me": ([("clarify", {"question": "Which colour?", "choices": ["Red", "Blue"]})], ["You picked ", "a colour."]),
    # The task list tool (todo_list) is a deferred tool here: the model reaches it through the tool_call bridge.
    "plan it": ([("tool_call", {"calls": [{"name": "todo_list", "arguments": {"todos": [
        {"id": "1", "content": "Read", "status": "completed"},
        {"id": "2", "content": "Write", "status": "in_progress"}]}}]})], ["Planned."]),
    "edit files": ([("write_file", {"path": f"{WORK}/site/a.txt", "content": "x\ny\n"}),
                    ("patch", {"path": f"{WORK}/site/b.txt", "old_string": "old", "new_string": "new"})], ["Edited."]),
    "delegate it": ([("delegate_task", {"goal": SUB_GOAL, "context": "Answer with the three words only."})], ["The helper ", "counted."]),
}
SLOW = ["Slow ", "done."] + [" more"] * 40
REASON1 = ["Let me read ", "the note first."]
REASON2 = ["I have the note, ", "now I can answer."]


def chunk(delta, finish=None, usage=None):
    c = {"id": "chatcmpl-contract", "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL,
         "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    if usage:
        c["usage"] = usage
    return c


def text_of(m):
    c = m.get("content")
    if isinstance(c, list):
        return "".join(p.get("text", "") for p in c if isinstance(p, dict))
    return c or ""


def plan(body):
    """The chunks of the reply to this request, its finish reason and how long to wait before it."""
    msgs = body.get("messages") or []
    system = " ".join(text_of(m) for m in msgs if m.get("role") == "system")
    if system.startswith("You name chat sessions"):
        return [{"content": json.dumps({"title": "Contract title"})}], "stop", 0
    users = [i for i, m in enumerate(msgs) if m.get("role") == "user"]
    last = text_of(msgs[users[-1]]).strip() if users else ""
    done = sum(1 for m in msgs[(users[-1] if users else 0):] if m.get("role") == "tool")
    if SUB_GOAL in last:  # the sub-agent delegate_task starts: its goal is its first user message
        return [{"content": "One, two, three."}], "stop", 0
    if last.endswith("slow reply"):
        return [{"content": t} for t in SLOW], "stop", 0.5
    calls, final = next((v for k, v in SCRIPTS.items() if last.endswith(k)), ([], ["OK"]))
    if done >= len(calls):
        reason = REASON2 if calls else []
        return [{"reasoning_content": t} for t in reason] + [{"content": t} for t in final], "stop", 1.6
    name, args = calls[done]
    a = json.dumps(args)
    cid = f"call_contract_{done + 1}"
    first = {"tool_calls": [{"index": 0, "id": cid, "type": "function", "function": {"name": name, "arguments": a[:12]}}]}
    rest = {"tool_calls": [{"index": 0, "function": {"arguments": a[12:]}}]}
    return [{"reasoning_content": t} for t in REASON1] + [first, rest], "tool_calls", 0


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
                msgs = body.get("messages", [])
                users = [text_of(m)[-60:] for m in msgs if m.get("role") == "user"]
                f.write(json.dumps({"path": self.path, "stream": bool(body.get("stream")), "roles": [m.get("role") for m in msgs],
                                    "last_user": users[-1] if users else None,
                                    "tools": [t.get("function", {}).get("name") for t in body.get("tools") or []]}) + "\n")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._json({"error": {"message": "not found"}}, 404)
        deltas, finish, pause = plan(body)
        # Hermes pushes session.usage from a ticker that fires once a second while a turn runs, and only when the counters
        # changed: the answer after the tool call comes late enough for one tick to see the first call's usage.
        time.sleep(pause if finish == "stop" and pause > 1 else 0)
        gap = pause if pause and pause <= 1 else 0.05
        usage = {"prompt_tokens": 120, "completion_tokens": 20, "total_tokens": 140}
        if not body.get("stream"):
            msg = {"role": "assistant", "content": "".join(d.get("content", "") for d in deltas) or None}
            calls = [d["tool_calls"][0] for d in deltas if "tool_calls" in d]
            if calls:
                fn = calls[0]["function"]
                msg["tool_calls"] = [{"id": calls[0]["id"], "type": "function", "function": {
                    "name": fn["name"], "arguments": "".join(c["function"]["arguments"] for c in calls)}}]
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
                time.sleep(gap)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(PORT_FILE, "w") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
