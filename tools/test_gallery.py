#!/usr/bin/env python3
"""Unit tests for the canvas gallery (hermes-plugin/hermes-mobile/gallery.py). Temp HOME.
    python3 tools/test_gallery.py
"""
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile

HOME = tempfile.mkdtemp(prefix="hm-gallery-test-")
os.environ["HOME"] = HOME
os.environ["HERMES_HOME_ROOT"] = HOME  # chat_search reads the chats' state.db files from here
HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(PLUGIN, file))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


canvas = load("hm_canvas", "canvas.py")
library = load("hm_library", "library.py")
gallery = load("hm_gallery", "gallery.py")

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def db(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE sessions (id TEXT, title TEXT, started_at REAL, last_activity_at REAL, archived INT, hidden INT)")
    con.executemany("INSERT INTO sessions VALUES (?,?,?,?,?,?)", rows)
    con.commit()
    con.close()


A, B, GONE = "20261021_100000_aaaaaa", "20261021_110000_bbbbbb", "20261021_120000_cccccc"
db(os.path.join(HOME, ".hermes", "state.db"), [(A, "Dinner ideas", 1, 5, 0, 0)])
db(os.path.join(HOME, ".hermes", "profiles", "work", "state.db"), [(B, "Q3 report", 2, 6, 0, 1)])

soup = canvas.create(A, "Soup", "# Soup\n\nTomato **and** basil")
page = canvas.create(B, "Chart", "<!doctype html><title>Chart</title><body><h1>Sales</h1><script>var basil=1</script></body>")
canvas.create(A, "app.py", "print('hello')", type="code", lang="python")
canvas.create(GONE, "Orphan", "left over")
canvas.create(A, "Plan", "# The full plan for May\n\nStep one")
canvas.create(A, "Notes", "# Notes\n\n- first-item uses snake_case names\n- **bold** end-")
canvas.create(A, "Long", "intro " * 30 + "the zebra crossing is here")

print("gallery list")
g = gallery.list_all()
by = {i["title"]: i for i in g["items"]}
check("every chat's documents, all profiles", {"Soup", "Chart", "app.py", "Orphan", "Plan", "Long"} <= set(by), str(list(by)))
check("categories are the types, with counts", g["categories"] == {"HTML": 1, "Markdown": 5, "Code": 1}, str(g["categories"]))
check("category of a document = its type", by["Chart"]["category"] == "HTML" and by["app.py"]["category"] == "Code")
check("chat of a document (title, profile)", by["Soup"]["chat"]["title"] == "Dinner ideas" and by["Soup"]["chat"]["profile"] == "default")
check("chat in another profile, archived flag", by["Chart"]["chat"]["profile"] == "work" and by["Chart"]["chat"]["archived"])
check("a chat that no longer exists has no chat", by["Orphan"]["chat"] is None)
check("key = chat/doc", by["Soup"]["key"] == f"{A}/{soup['id']}" and by["Soup"]["session"] == A)
check("markdown snippet is plain text, without the title heading", by["Soup"]["snippet"] == "Tomato and basil", by["Soup"]["snippet"])
check("a leading heading worded differently is skipped too", by["Plan"]["snippet"] == "Step one", by["Plan"]["snippet"])
check("html snippet skips tags and scripts", by["Chart"]["snippet"] == "Sales", by["Chart"]["snippet"])
check("no content in the list", all("content" not in i for i in g["items"]))
check("newest first", [i["updated"] for i in g["items"]] == sorted((i["updated"] for i in g["items"]), reverse=True))

print("search")
titles = lambda q: sorted(i["title"] for i in gallery.list_all(q)["items"])
check("by title, any case", titles("SOUP") == ["Soup"], str(titles("SOUP")))
check("by content", titles("basil") == ["Soup"], str(titles("basil")))
check("html is searched as text: not its script or tags", titles("sales") == ["Chart"] and titles("script") == [] and titles("var") == [], str(titles("var")))
check("every word must match", titles("tomato basil") == ["Soup"] and titles("tomato zebra") == [])
check("categories count the results only", gallery.list_all("hello")["categories"] == {"Code": 1})
z = gallery.list_all("zebra")["items"][0]["snippet"]
check("the snippet shows the match", "zebra" in z and z.startswith("…"), z)
check("hyphenated and snake_case words are searchable", titles("first-item") == ["Notes"] and titles("snake_case") == ["Notes"] and titles("bold end") == ["Notes"], str(titles("first-item")))
check("no match: empty", gallery.list_all("nothing-like-this") == {"items": [], "categories": {}})

print("saved copies from the old Library")
library.save({"id": soup["id"], "title": "Old soup", "type": "markdown", "content": "barley"}, "Recipes", A)
old = next(i for i in gallery.list_all()["items"] if i["title"] == "Old soup")
check("listed with its chat, under its type", old["saved"] and old["key"].startswith("lib:") and old["chat"]["title"] == "Dinner ideas" and old["category"] == "Markdown", str(old))
check("found by its content", titles("barley") == ["Old soup"])
check("a saved copy shows a text snippet", old["snippet"] == "barley", old["snippet"])

print("canvas tool")
r = json.loads(canvas.tool_handler({"action": "save_to_library", "id": soup["id"], "category": "x"}, session_id=A))
check("old save_to_library: ok, says it's already in the gallery, copies nothing", r["ok"] and "gallery" in r["note"] and len(library.list_items()) == 1, str(r))

print("REST routes (dashboard/plugin_api.py)")
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:
    FastAPI = None
    print("  [SKIP] fastapi/httpx not installed (CI installs them)")
if FastAPI:
    api = load("plugin_api", os.path.join("dashboard", "plugin_api.py"))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/plugins/hermes-mobile")
    c = TestClient(app)
    P = "/api/plugins/hermes-mobile"
    lst = c.get(f"{P}/gallery").json()
    check("GET /gallery lists items + categories", len(lst["items"]) == 8 and lst["categories"].get("HTML") == 1, str(lst["categories"]))
    check("GET /gallery?q= searches", [i["title"] for i in c.get(f"{P}/gallery", params={"q": "basil"}).json()["items"]] == ["Soup"])

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
