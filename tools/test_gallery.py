#!/usr/bin/env python3
"""Unit tests for the canvas gallery (hermes-plugin/hermes-mobile/gallery.py) and canvas categories. Temp HOME.
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

print("categories on canvas documents")
soup = canvas.create(A, "Soup", "# Soup\n\nTomato **and** basil", category="  Recipes ")
check("create stores a trimmed category", soup["category"] == "Recipes", soup.get("category"))
page = canvas.create(B, "Chart", "<!doctype html><title>Chart</title><body><h1>Sales</h1><script>x=1</script></body>")
check("no category = empty", page["category"] == "")
out = json.loads(canvas.tool_handler({"action": "create", "title": "Stew", "content": "beef", "category": "Recipes"}, session_id=A))
check("tool create keeps the category and lists the gallery's", out["category"] == "Recipes" and out["gallery_categories"] == ["Recipes"], str(out))
r = json.loads(canvas.tool_handler({"action": "set_category", "id": "Stew", "category": "Cooking"}, session_id=A))
check("tool set_category (by title)", r["ok"] and r["category"] == "Cooking", str(r))
r = json.loads(canvas.tool_handler({"action": "save_to_library", "id": r["id"], "category": "Recipes"}, session_id=A))
check("old save_to_library files it under a category instead of copying", r["ok"] and r["category"] == "Recipes" and not library.list_items(), str(r))
rev = canvas.get(A, soup["id"])["rev"]
canvas.set_category(A, soup["id"], "Food")
check("set_category is not a new version", canvas.get(A, soup["id"])["rev"] == rev)
canvas.set_category(A, soup["id"], "Recipes")
canvas.create(GONE, "Orphan", "left over")

print("gallery list")
g = gallery.list_all()
by = {i["title"]: i for i in g["items"]}
check("every chat's documents, all profiles", {"Soup", "Stew", "Chart", "Orphan"} <= set(by), str(list(by)))
check("categories with counts", g["categories"].get("Recipes") == 2 and g["categories"].get("Web pages") == 1, str(g["categories"]))
check("no category = grouped by type", by["Chart"]["category"] == "Web pages" and by["Chart"]["auto"] and not by["Soup"]["auto"])
check("chat of a document (title, profile)", by["Soup"]["chat"]["title"] == "Dinner ideas" and by["Soup"]["chat"]["profile"] == "default")
check("chat in another profile, archived flag", by["Chart"]["chat"]["profile"] == "work" and by["Chart"]["chat"]["archived"])
check("a chat that no longer exists has no chat", by["Orphan"]["chat"] is None)
check("key = chat/doc", by["Soup"]["key"] == f"{A}/{soup['id']}" and by["Soup"]["session"] == A)
check("markdown snippet is plain text, without the title again", by["Soup"]["snippet"] == "Tomato and basil", by["Soup"]["snippet"])
check("html snippet skips tags and scripts", by["Chart"]["snippet"] == "Sales", by["Chart"]["snippet"])
check("no content in the list", all("content" not in i for i in g["items"]))
check("newest first", [i["updated"] for i in g["items"]] == sorted((i["updated"] for i in g["items"]), reverse=True))

print("saved copies from the old Library")
library.save({"id": soup["id"], "title": "Old soup", "type": "markdown", "content": "x"}, "Recipes", A)
old = next(i for i in gallery.list_all()["items"] if i["title"] == "Old soup")
check("listed with its chat", old["saved"] and old["key"].startswith("lib:") and old["chat"]["title"] == "Dinner ideas", str(old))

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
    check("GET /gallery lists items + categories", any(i["title"] == "Soup" for i in lst["items"]) and lst["categories"].get("Recipes") == 3, str(lst["categories"]))
    r = c.post(f"{P}/canvas/category", json={"session": B, "id": page["id"], "title": "Work"})
    check("POST /canvas/category files it", r.status_code == 200 and r.json()["category"] == "Work", r.text)
    check("the gallery follows", c.get(f"{P}/gallery").json()["categories"].get("Work") == 1)
    r = c.post(f"{P}/canvas/category", json={"session": B, "id": page["id"], "title": ""})
    check("a blank category groups it by type again", r.json()["category"] == "" and "Work" not in c.get(f"{P}/gallery").json()["categories"])
    check("missing document is a 400", c.post(f"{P}/canvas/category", json={"session": B, "id": "nope", "title": "x"}).status_code == 400)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
