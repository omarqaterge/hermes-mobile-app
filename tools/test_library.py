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
    spec = importlib.util.spec_from_file_location(name, os.path.join(PLUGIN, f"{name}.py"))
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

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
