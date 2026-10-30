#!/usr/bin/env python3
"""Tests for tools/changelog.py (CHANGELOG fragments in changes/) against a tiny fake repo."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("changelog", HERE / "changelog.py")
cl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cl)

CHANGELOG = """# What's new

Intro.

## Unreleased

- **Old entry.** Written before fragments.
  Second line.

## v0.8.66 (2026-10-29)

- **Shipped.** Already out.
"""


class Changelog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "CHANGELOG.md").write_text(CHANGELOG)
        (self.root / "changes").mkdir()
        (self.root / "changes/README.md").write_text("# not a fragment\n")

    def tearDown(self):
        self.tmp.cleanup()

    def frag(self, name, text):
        (self.root / "changes" / name).write_text(text)

    def test_no_fragments_is_fine(self):
        self.assertEqual(cl.problems(self.root), [])
        self.assertEqual(cl.main(["check"], self.root), 0)

    def test_bad_fragments_are_listed(self):
        self.frag("lock-screen.md", "- **A.** b\n")
        self.frag("2026-10-30-empty.md", "\n")
        self.frag("2026-10-30-prose.md", "Some text\n")
        self.frag("2026-10-30-heading.md", "- **A.** b\n## v1\n")
        bad = cl.problems(self.root)
        self.assertEqual(len(bad), 4, bad)
        self.assertEqual(cl.main(["check"], self.root), 1)

    def test_show_puts_newest_fragments_first_then_unreleased(self):
        self.frag("2026-10-29-older.md", "- **Older.** x\n")
        self.frag("2026-10-30-newer.md", "- **Newer.** y\n  more\n")
        n = cl.notes(self.root)
        self.assertLess(n.index("Newer"), n.index("Older"))
        self.assertLess(n.index("Older"), n.index("Old entry"))
        self.assertNotIn("not a fragment", n)

    def test_release_folds_everything_and_removes_fragments(self):
        self.frag("2026-10-30-newer.md", "- **Newer.** y\n")
        self.assertEqual(cl.main(["release", "v0.8.70", "2026-11-01"], self.root), 0)
        text = (self.root / "CHANGELOG.md").read_text()
        head, unreleased, rest = cl._split(text)
        self.assertEqual(unreleased, "")
        self.assertTrue(rest.startswith("## v0.8.70 (2026-11-01)\n\n- **Newer.** y\n- **Old entry.**"), rest)
        self.assertIn("## v0.8.66 (2026-10-29)\n\n- **Shipped.**", rest)
        self.assertTrue(head.startswith("# What's new\n\nIntro."))
        self.assertEqual(cl.fragments(self.root), [])
        self.assertTrue((self.root / "changes/README.md").exists())

    def test_release_refuses_bad_input(self):
        with self.assertRaises(SystemExit):
            cl.release(self.root, "0.8.70", "2026-11-01")  # no leading v
        with self.assertRaises(SystemExit):
            cl.release(self.root, "v0.8.66", "2026-11-01")  # already there
        (self.root / "CHANGELOG.md").write_text("# What's new\n\n## Unreleased\n\n## v0.8.66 (x)\n\n- a\n")
        with self.assertRaises(SystemExit):
            cl.release(self.root, "v0.8.70", "2026-11-01")  # nothing to release

    def test_release_stops_on_a_bad_fragment(self):
        self.frag("bad.md", "- **A.** b\n")
        self.assertEqual(cl.main(["release", "v0.8.70"], self.root), 1)
        self.assertNotIn("v0.8.70", (self.root / "CHANGELOG.md").read_text())

    def test_the_real_repo_passes(self):
        self.assertEqual(cl.problems(HERE.parent), [])


if __name__ == "__main__":
    unittest.main()
