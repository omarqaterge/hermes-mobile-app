#!/usr/bin/env python3
"""Tests for tools/check_spec.py against a tiny fake repo."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("check_spec", HERE / "check_spec.py")
cs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cs)

FULL = (
    "`secure-bridge.ts` `store.ts` `Settings.tsx` `__init__.py` `speak` `haptic` `skills` `hm.theme` "
    "Appearance Text size Close the sheet `session.list` `pre_tool_call` `canvas` `GET /canvas`\n"
)


def make_repo(d: Path, spec_text: str) -> Path:
    (d / "web/src/components").mkdir(parents=True)
    (d / "web/src/secure-bridge.ts").write_text("const METHODS = [\n  'speak', 'haptic'\n]\n")
    (d / "web/src/store.ts").write_text(
        "export type Screen = null | 'skills'\nlocalStorage.getItem('hm.theme')\n")
    (d / "web/src/components/Settings.tsx").write_text(
        '<Section title="Appearance"><Row icon="x" title="Text size" /></Section>\n'
        "rpc('session.list', {})\n<button aria-label=\"Close the sheet\">x</button>\n")
    plug = d / "hermes-plugin/hermes-mobile"
    plug.mkdir(parents=True)
    (plug / "__init__.py").write_text(
        'ctx.register_hook("pre_tool_call", f)\n'
        'ctx.register_tool(name="canvas", toolset="canvas")\n'
        '@router.get("/canvas")\n')
    (d / "docs").mkdir()
    (d / "docs/SPEC.md").write_text(spec_text)
    return d


class CheckSpec(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_inventory_reads_each_kind(self):
        inv = cs.inventory(make_repo(self.root, FULL))
        self.assertEqual(inv["bridge method"], {"speak", "haptic"})
        self.assertEqual(inv["plugin route"], {"GET /canvas"})
        self.assertEqual(inv["plugin hook"], {"pre_tool_call"})
        self.assertEqual(inv["plugin tool"], {"canvas"})
        self.assertEqual(inv["gateway RPC"], {"session.list"})
        self.assertEqual(inv["localStorage key"], {"hm.theme"})
        self.assertEqual(inv["screen"], {"skills"})
        self.assertEqual(inv["Section title"], {"Appearance"})
        self.assertEqual(inv["row title"], {"Text size"})
        self.assertEqual(inv["aria-label"], {"Close the sheet"})
        self.assertEqual(inv["web file"], {"secure-bridge.ts", "store.ts", "Settings.tsx"})

    def test_complete_spec_passes(self):
        root = make_repo(self.root, FULL)
        self.assertEqual(cs.missing((root / "docs/SPEC.md").read_text(), cs.inventory(root)), [])
        self.assertEqual(cs.main(["check_spec.py", str(root)]), 0)

    def test_names_may_sit_in_any_spec_file(self):
        root = make_repo(self.root, FULL.replace("`haptic` ", "").replace("`GET /canvas`", ""))
        (root / "docs/spec").mkdir()
        (root / "docs/spec/04-05-bridge-methods.md").write_text("`haptic` buzzes the phone.\n")
        self.assertEqual(cs.main(["check_spec.py", str(root)]), 1)  # GET /canvas is still missing
        (root / "docs/spec/05-04-dashboard-routes.md").write_text("`GET /canvas` reads the canvas.\n")
        self.assertEqual(cs.main(["check_spec.py", str(root)]), 0)

    def test_missing_items_are_listed(self):
        root = make_repo(self.root, FULL.replace("`haptic` ", "").replace("`GET /canvas`", ""))
        gaps = cs.missing((root / "docs/SPEC.md").read_text(), cs.inventory(root))
        self.assertEqual(gaps, ["bridge method: haptic", "plugin route: GET /canvas"])
        self.assertEqual(cs.main(["check_spec.py", str(root)]), 1)

    def test_identifiers_need_backticks(self):
        root = make_repo(self.root, FULL.replace("`haptic`", "haptic"))
        self.assertIn("bridge method: haptic", cs.missing((root / "docs/SPEC.md").read_text(), cs.inventory(root)))

    def test_route_prefix_is_not_enough(self):
        root = make_repo(self.root, FULL.replace("`GET /canvas`", "`GET /canvas/doc`"))
        self.assertIn("plugin route: GET /canvas", cs.missing((root / "docs/SPEC.md").read_text(), cs.inventory(root)))

    def test_no_spec_file_fails(self):
        root = make_repo(self.root, FULL)
        (root / "docs/SPEC.md").unlink()
        self.assertEqual(cs.main(["check_spec.py", str(root)]), 1)


if __name__ == "__main__":
    unittest.main()
