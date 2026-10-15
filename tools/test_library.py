#!/usr/bin/env python3
"""Unit tests for the library storage (hermes-plugin/hermes-mobile/library.py). Uses a temp HOME.
    python3 tools/test_library.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import time

HOME = tempfile.mkdtemp(prefix="hm-library-test-")
os.environ["HOME"] = HOME
HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")


def load(name):
    return load_path(name, os.path.join(PLUGIN, f"{name}.py"))


def load_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


library = load("library")

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except library.LibraryError as e:
        return str(e)
    return None


print("saving and listing")
a = library.save({"id": "plan-1a2b", "title": "My Plan", "type": "markdown", "content": "# Plan\n- one"}, "  Work  ", "chat-1")
check("save returns id/category", a["id"].startswith("my-plan-") and a["category"] == "Work" and a["chars"] == 12, str(a))
check("save keeps the source", a["source"] == {"session": "chat-1", "doc": "plan-1a2b"}, str(a.get("source")))
check("blank category becomes Unsorted", library.save({"title": "x", "content": "y"}, "   ")["category"] == "Unsorted")
time.sleep(0.01)
b = library.save({"title": "Soup", "type": "text", "content": "water"}, "Recipes")
items = library.list_items()
check("list is newest first", [m["id"] for m in items][0] == b["id"] and len(items) == 3)
check("list hides content", all("content" not in m for m in items))
check("get returns content", library.get(a["id"])["content"] == "# Plan\n- one")
check("categories counts, sorted by name", library.categories() == {"Recipes": 1, "Unsorted": 1, "Work": 1}, str(library.categories()))

print("updating and deleting")
u = library.update(b["id"], title="Tomato soup", category="Notes")
check("update renames and moves", u["title"] == "Tomato soup" and u["category"] == "Notes")
check("update with blanks changes nothing", library.update(b["id"])["title"] == "Tomato soup")
check("categories follow the move", "Recipes" not in library.categories() and library.categories()["Notes"] == 1)
library.delete(b["id"])
check("delete removes it", all(m["id"] != b["id"] for m in library.list_items()))
check("delete of a missing item is fine", library.delete(b["id"]) is None)
check("get of a missing item refused", "no such item" in (raises(library.get, b["id"]) or ""))

print("safety and limits")
check("path tricks in ids refused", raises(library.get, "../x") is not None and raises(library.delete, "../../etc/passwd") is not None)
check("empty id refused", raises(library.get, "") is not None)
check("content cap", "too large" in (raises(library.save, {"title": "big", "content": "x" * (library.MAX_CHARS + 1)}, "x") or ""))
old = library.MAX_ITEMS
library.MAX_ITEMS = len(library.list_items())
check("item cap refused with a clear error", "full" in (raises(library.save, {"title": "one more", "content": "x"}, "x") or ""))
library.MAX_ITEMS = old

print("REST routes (dashboard/plugin_api.py)")
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:
    FastAPI = None
    print("  [SKIP] fastapi/httpx not installed (CI installs them)")
if FastAPI:
    api = load_path("plugin_api", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/plugins/hermes-mobile")
    c = TestClient(app)
    B = "/api/plugins/hermes-mobile"
    doc = c.post(f"{B}/canvas/doc", json={"session": "rest-chat", "title": "Rest note", "content": "hello rest", "type": "markdown"}).json()
    r = c.post(f"{B}/library", json={"session": "rest-chat", "id": doc["id"], "category": "Rest"})
    check("POST /library saves the canvas doc", r.status_code == 200 and r.json()["category"] == "Rest", r.text)
    iid = r.json()["id"]
    lst = c.get(f"{B}/library").json()
    check("GET /library lists items + categories", any(m["id"] == iid for m in lst["items"]) and lst["categories"].get("Rest") == 1, str(lst))
    check("GET /library/item has the content", c.get(f"{B}/library/item", params={"id": iid}).json()["content"] == "hello rest")
    u = c.put(f"{B}/library/item", json={"id": iid, "title": "Renamed", "category": "Moved"}).json()
    check("PUT /library/item renames and moves", u["title"] == "Renamed" and u["category"] == "Moved", str(u))
    check("DELETE /library/item", c.delete(f"{B}/library/item", params={"id": iid}).json() == {"ok": True})
    check("missing item is a 400", c.get(f"{B}/library/item", params={"id": iid}).status_code == 400)
    check("bad id is a 400", c.get(f"{B}/library/item", params={"id": "../x"}).status_code == 400)
    check("missing canvas doc is a 400", c.post(f"{B}/library", json={"session": "rest-chat", "id": "nope", "category": "x"}).status_code == 400)

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
