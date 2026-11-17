#!/usr/bin/env python3
"""Tests for tools/check-no-emoji.py: each language's comment rules, test files skipped, \\u escapes not seen."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("check_no_emoji", HERE / "check-no-emoji.py")
ce = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ce)

TICK = "\u2705"
CROSS = "\u2715"


def found(name: str, body: str) -> list:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        if not ce.wanted(p):
            return []
        return list(ce.hits(p))


class CheckNoEmoji(unittest.TestCase):
    def test_java_string_fails_comment_passes(self):
        self.assertTrue(found("A.java", f'String s = "{TICK} Done";'))
        self.assertFalse(found("A.java", f'// done {TICK}\n/* {CROSS} */\nString s = "Done";'))

    def test_xml_comment_passes_text_fails(self):
        self.assertFalse(found("a.xml", f"<!-- {TICK} --><a>x</a>"))
        self.assertTrue(found("a.xml", f'<string name="a">{TICK} Done</string>'))

    def test_python_string_fails_docstring_and_comment_pass(self):
        self.assertTrue(found("a.py", f'x = "{TICK} Done"\n'))
        self.assertTrue(found("a.py", f'f(emoji="{TICK}")\n'))
        self.assertFalse(found("a.py", f'"""Module {TICK}."""\n# {CROSS}\ndef f():\n    """Doc {TICK}"""\n'))

    def test_escape_is_data_not_interface(self):
        self.assertFalse(found("a.py", 'x = "\\u2387"\n'))
        self.assertFalse(found("A.java", 'String s = "\\u2387";'))

    def test_shell_comment_passes_string_fails(self):
        self.assertFalse(found("a.sh", f"# {TICK} done\necho ok\n"))
        self.assertFalse(found("a.sh", f"echo ok # {TICK}\n"))
        self.assertTrue(found("a.sh", f'echo "{TICK} done"\n'))
        self.assertTrue(found("a.sh", f'echo "a # b {TICK}"\n'))

    def test_extensionless_script_with_shebang_is_checked(self):
        self.assertTrue(found("hm-thing", f'#!/bin/sh\necho "{TICK}"\n'))

    def test_tests_are_skipped(self):
        self.assertFalse(found("test_a.py", f'x = "{TICK}"\n'))
        self.assertFalse(found("tests/b.py", f'x = "{TICK}"\n'))
        self.assertFalse(found("ATest.java", f'String s = "{TICK}";'))

    def test_plain_arrow_and_punctuation_are_fine(self):
        self.assertFalse(found("a.py", 'x = "Settings \u2192 Voice \u00b7 a\u2026"\n'))


if __name__ == "__main__":
    unittest.main()
