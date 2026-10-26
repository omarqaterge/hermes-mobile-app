"""The plugin in every Hermes profile (dashboard/plugin_api.py link_profiles, phone/install.sh does the same in shell).

Each profile loads plugins from its own plugins/ folder. A user whose `hermes profile use <name>` made another profile
the active one got "No plugin named 'hermes-mobile'" from the installer and a red plugin row in Setup check (GitHub
issue #5); profiles made from the Bots page had no status chip or approvals.
Run: python3 tools/test_profile_link.py (needs fastapi, like the other REST tests; skipped without it).
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f" ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1


try:
    import fastapi  # noqa: F401
except ImportError:
    print("  [SKIP] fastapi not installed (CI installs it)")
    sys.exit(0)

os.environ["HOME"] = tempfile.mkdtemp()
os.environ.pop("HERMES_HOME", None)
spec = importlib.util.spec_from_file_location("plugin_api_pl", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
api = importlib.util.module_from_spec(spec)
sys.modules["plugin_api_pl"] = api
spec.loader.exec_module(api)

root = Path(tempfile.mkdtemp())
target = root / "plugins" / "hermes-mobile"
target.mkdir(parents=True)
(target / "plugin.yaml").write_text("name: hermes-mobile\n")
for name in ("work", "cloned", "linked", "dangling"):
    (root / "profiles" / name).mkdir(parents=True)
(root / "profiles" / "cloned" / "plugins" / "hermes-mobile").mkdir(parents=True)  # an old copy (clone-all)
(root / "profiles" / "cloned" / "plugins" / "other").mkdir()
(root / "profiles" / "linked" / "plugins").mkdir()
(root / "profiles" / "linked" / "plugins" / "hermes-mobile").symlink_to(target)
(root / "profiles" / "dangling" / "plugins").mkdir()
(root / "profiles" / "dangling" / "plugins" / "hermes-mobile").symlink_to(root / "gone")
(root / "profiles" / "notes.txt").write_text("not a profile")

changed = api.link_profiles(root)
check("profiles without the plugin, with an old copy or a broken link are changed",
      sorted(changed) == ["cloned", "dangling", "work"], str(changed))
for name in ("work", "cloned", "linked", "dangling"):
    link = root / "profiles" / name / "plugins" / "hermes-mobile"
    check(f"{name}: plugin is a link to the main copy", link.is_symlink() and link.resolve() == target.resolve())
check("another plugin in a profile is left alone", (root / "profiles" / "cloned" / "plugins" / "other").is_dir())
check("the main copy is untouched", (target / "plugin.yaml").read_text() == "name: hermes-mobile\n")
check("a second run changes nothing", api.link_profiles(root) == [])

empty = Path(tempfile.mkdtemp())
(empty / "profiles" / "a").mkdir(parents=True)
check("no main copy: nothing is linked", api.link_profiles(empty) == [] and not (empty / "profiles" / "a" / "plugins").exists())
check("no profiles folder: no error", api.link_profiles(Path(tempfile.mkdtemp())) == [])

print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
