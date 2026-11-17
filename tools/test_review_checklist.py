#!/usr/bin/env python3
"""Tests for tools/review_checklist.py: item files, the diff reader, each kind of trigger, the report, and the real
items in docs/review-checklist/ against small made-up diffs."""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("review_checklist", HERE / "review_checklist.py")
rc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rc)

fails = 0


def check(name, ok, got=None):
    global fails
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok or got is None else f"  got: {got!r}"))
    fails += 0 if ok else 1


# --- item files
it = rc.Item("x", "# A title\n\n- paths: `^web/`\n- adds: `foo\\(`\n\nWhat to check.\nSecond line.\n")
check("an item: title, triggers, body", it.title == "A title" and set(it.rx) == {"paths", "adds"}
      and it.body == "What to check.\nSecond line." and not it.errors, it.errors)
check("no title is an error", any("Title" in e for e in rc.Item("x", "- paths: `a`\n\ntext").errors))
check("no paths is an error", any("paths" in e for e in rc.Item("x", "# T\n\n- adds: `a`\n\ntext").errors))
check("no text is an error", any("what to check" in e for e in rc.Item("x", "# T\n\n- paths: `a`\n").errors))
check("a bad regex is an error, once", len(rc.Item("x", "# T\n\n- paths: `(`\n\ntext").errors) == 1)
check("an unknown trigger is an error", any("unknown" in e for e in rc.Item("x", "# T\n\n- paths: `a`\n- when: `b`\n\ntext").errors))
it = rc.Item("x", "# T\n\n- paths: `a`\n\nText.\n\n- adds: `not a trigger, a list in the text`\n")
check("a list after the text starts is text", set(it.rx) == {"paths"} and "not a trigger" in it.body)

# --- the diff reader
DIFF = """diff --git a/web/src/a.ts b/web/src/a.ts
index 1..2 100644
--- a/web/src/a.ts
+++ b/web/src/a.ts
@@ -3 +3,2 @@
-old line
+new line
+setInterval(tick, 1000)
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/pic.png b/pic.png
new file mode 100644
Binary files /dev/null and b/pic.png differ
"""
ch = rc.parse_diff(DIFF)
check("the diff reader: files", sorted(ch) == ["gone.txt", "new.txt", "pic.png", "web/src/a.ts"], sorted(ch))
check("added and removed lines", ch["web/src/a.ts"] == (["new line", "setInterval(tick, 1000)"], ["old line"]), ch["web/src/a.ts"])
check("a deleted file keeps its path and lines", ch["gone.txt"] == ([], ["bye"]), ch["gone.txt"])
check("a new file", ch["new.txt"] == (["hello"], []))


# --- triggers
def item(*triggers):
    return rc.Item("x", "# T\n\n" + "\n".join(f"- {t}" for t in triggers) + "\n\nText.\n")


check("paths alone fires on a matching file", item("paths: `^web/`").match(ch) == ["web/src/a.ts"])
check("paths alone: no matching file, no fire", item("paths: `^android/`").match(ch) == [])
why = item("paths: `^web/`", "adds: `setInterval\\(`").match(ch)
check("adds fires on an added line and quotes it", len(why) == 1 and "+ setInterval(tick, 1000)" in why[0], why)
check("adds doesn't fire on a removed line", item("paths: `^web/`", "adds: `old line`").match(ch) == [])
why = item("paths: `^web/`", "removes: `old`").match(ch)
check("removes fires on a removed line", len(why) == 1 and "- old line" in why[0], why)
check("adds only looks in files that match paths", item("paths: `^android/`", "adds: `hello`").match(ch) == [])
check("adds or removes: either is enough", len(item("paths: `.`", "adds: `nothing`", "removes: `bye`").match(ch)) == 1)
check("without: fires when no file matches it", item("paths: `^web/`", "without: `^tools/`").match(ch) == ["web/src/a.ts"])
check("without: quiet when a file matches it", item("paths: `^web/`", "without: `^new\\.txt$`").match(ch) == [])

# --- the report
a = rc.Item("first", "# First rule\n\n- paths: `^web/`\n\nRead this.\n")
b = rc.Item("second", "# Second rule\n\n- paths: `^android/`\n\nNot this.\n")
rep = rc.report([a, b], ch)
check("the report counts and shows only what fired",
      rep.startswith("Review checklist: 1 of 2 items") and "[first] First rule" in rep and "Read this." in rep
      and "Second rule" not in rep, rep)
many = {f"web/f{i}.ts": ([], []) for i in range(5)}
check("the report shortens a long list of files", "and 2 more" in rc.report([a], many))
check("nothing fired: one line", rc.report([a, b], {}) == "Review checklist: 0 of 2 items match this change (docs/review-checklist/)")

# --- the real items
items = {i.name: i for i in rc.load(rc.ROOT)}
check("the real items are well formed", items and not [e for i in items.values() for e in i.errors],
      [(i.name, i.errors) for i in items.values() if i.errors])


def fires(name, path, added=(), removed=(), also=()):
    c = {path: (list(added), list(removed))}
    c.update({p: ([], []) for p in also})
    return bool(items[name].match(c))


J = "android/src/com/omarqaterge/hermesmobile/MainActivity.java"
check("bridge-method", fires("bridge-method", J, ["    @JavascriptInterface"]) and not fires("bridge-method", J, ["int x = 1;"]))
check("timers-and-wake-locks", fires("timers-and-wake-locks", "web/src/live.ts", ["const t = setInterval(() => poll(), 5000)"])
      and not fires("timers-and-wake-locks", "docs/battery.md", ["setInterval("]))
check("rendered-html", fires("rendered-html", "web/src/components/Markdown.tsx", ["<div dangerouslySetInnerHTML={{ __html: h }} />"]))
check("native-controls-and-dialogs", fires("native-controls-and-dialogs", "web/src/components/X.tsx", ["  if (confirm('Sure?')) go()"])
      and fires("native-controls-and-dialogs", "web/src/components/X.tsx", ['<input type="checkbox" />'])
      and not fires("native-controls-and-dialogs", "web/src/components/X.tsx", ["const ok = await dialog.confirm('Sure?')"]))
check("colours", fires("colours", "web/src/styles.css", ["  color: #ff0000;"])
      and not fires("colours", "web/src/styles.css", ["  --accent: #ff0000;"])
      and not fires("colours", "web/src/styles.css", ["  color: var(--accent);"]))
check("web-change-without-a-browser-check", fires("web-change-without-a-browser-check", "web/src/store.ts")
      and not fires("web-change-without-a-browser-check", "web/src/store.ts", also=["tools/web-e2e/checks/01-chat-basics.cjs"])
      and not fires("web-change-without-a-browser-check", "web/src/store.test.ts"))
check("tests-changed", fires("tests-changed", "web/src/queue.test.ts", removed=["  expect(q.length).toBe(2)"])
      and fires("tests-changed", "tools/test_chip.py", removed=['check("chip shows", ok)'])
      and not fires("tests-changed", "web/src/queue.test.ts", added=["  expect(q.length).toBe(2)"]))
check("flaky-test-workarounds", fires("flaky-test-workarounds", "tools/web-e2e/checks/12-app-shell.cjs", ["  await sleep(800)"])
      and fires("flaky-test-workarounds", "web/src/queue.test.ts", ["it.skip('sends', () => {"])
      and not fires("flaky-test-workarounds", "web/src/conn.test.ts", ["// the retry wait grows"]))
check("the-checks-themselves", fires("the-checks-themselves", "tools/check.sh") and fires("the-checks-themselves", ".github/workflows/ci.yml")
      and fires("the-checks-themselves", "docs/review-checklist/colours.md") and not fires("the-checks-themselves", "tools/test_chip.py"))
check("new-dependency", fires("new-dependency", "web/package.json", ['    "left-pad": "^1.3.0",'])
      and not fires("new-dependency", "web/package.json", ['    "test": "vitest run",']))
check("new-network-call", fires("new-network-call", "web/src/whatsnew.ts", ["  const r = await fetch(`https://api.github.com/x`)"])
      and not fires("new-network-call", "web/src/whatsnew.ts", ["  // see https://api.github.com/x"])
      and not fires("new-network-call", "web/src/whatsnew.ts", ["  fetch('http://127.0.0.1:9119/x')"])
      and not fires("new-network-call", "web/src/whatsnew.test.ts", ["  fetch('https://api.github.com/x')"]))
check("permission-or-exported", fires("permission-or-exported", "android/AndroidManifest.xml", ['<uses-permission android:name="android.permission.CAMERA" />']))
check("security-boundary", fires("security-boundary", "android/src/com/omarqaterge/hermesmobile/LocalAuth.java")
      and fires("security-boundary", "hermes-plugin/hermes-mobile/local_auth.py") and not fires("security-boundary", J))
check("gateway-and-mock", fires("gateway-and-mock", "web/src/gateway.ts") and fires("gateway-and-mock", "tools/web-e2e/mock.cjs"))
check("version-and-release", fires("version-and-release", "tools/version-code.sh") and not fires("version-and-release", "tools/check.sh"))
check("personal-data", fires("personal-data", "docs/manual-tests.md", ["tried on a Pixel 8"])
      and fires("personal-data", "docs/status/x.md", ["the log is in /Users/someone/logs"])
      and fires("personal-data", "README.md", ["connect to 203.0.113.7"])
      and not fires("personal-data", "docs/install.md", ["adb forward to 127.0.0.1:9119, Hermes 0.21.5"]))

# --- the command, in a temp repository with one item
with tempfile.TemporaryDirectory() as d:
    root = Path(d)

    def git(*a):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *a],
                       cwd=root, check=True, capture_output=True)

    (root / rc.ITEMS).mkdir(parents=True)
    (root / rc.ITEMS / "README.md").write_text("# Not an item\n")
    (root / rc.ITEMS / "loops.md").write_text("# A loop\n\n- paths: `^src/`\n- adds: `while`\n\nSay what stops it.\n")
    (root / "src").mkdir()
    (root / "src/a.txt").write_text("one\n")
    git("init", "-b", "main")
    git("add", "-A")
    git("commit", "-m", "base")
    git("tag", "base")
    loaded = rc.load(root)
    check("README.md is not an item", [i.name for i in loaded] == ["loops"])
    check("a clean tree: nothing fires", not loaded[0].match(rc.changes_since(root, "base")))
    (root / "src/a.txt").write_text("one\nwhile true\n")
    check("an uncommitted change fires", bool(loaded[0].match(rc.changes_since(root, "base"))))
    git("commit", "-am", "loop")
    check("a committed change fires", bool(loaded[0].match(rc.changes_since(root, "base"))))
    (root / "src/a.txt").write_text("one\n")
    git("commit", "-am", "no loop")
    (root / "src/new.txt").write_text("while it lasts\n")
    why = loaded[0].match(rc.changes_since(root, "base"))
    check("an untracked file's lines count as added", len(why) == 1 and why[0].startswith("src/new.txt"), why)

out = subprocess.run([sys.executable, str(HERE / "review_checklist.py"), "--check"], capture_output=True, text=True)
check("--check passes on the repository's items", out.returncode == 0 and "all well formed" in out.stdout, out.stdout)
out = subprocess.run([sys.executable, str(HERE / "review_checklist.py"), "--bogus"], capture_output=True, text=True)
check("an unknown argument prints the usage, exit 2", out.returncode == 2 and "Usage:" in out.stdout)

print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
