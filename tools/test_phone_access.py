"""Setup check's phone-access probe (dashboard/plugin_api.py phone_access_now).

On the phone the Termux:API row flipped to "Hermes can't reach it" for one check and back to ✓ on the next: a single
termux-battery-status call that didn't answer (the Termux:API app waking up) counted as "not set up". One retry.
Run: python3 tools/test_phone_access.py (needs fastapi, like the other REST tests; skipped without it)."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import types

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
spec = importlib.util.spec_from_file_location("plugin_api_pa", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
api = importlib.util.module_from_spec(spec)
sys.modules["plugin_api_pa"] = api
spec.loader.exec_module(api)

fake_cmd = os.path.join(tempfile.mkdtemp(), "termux-battery-status")
open(fake_cmd, "w").close()
import shutil  # noqa: E402  (phone_access_now imports it inside: patch the module itself)

shutil_which = shutil.which
shutil.which = lambda name: fake_cmd if name == "termux-battery-status" else shutil_which(name)
api._RISH = types.SimpleNamespace(exists=lambda: False)

real_run = subprocess.run


def runner(answers):
    calls = []

    def run(cmd, **kw):
        if cmd and cmd[0] == fake_cmd:
            calls.append(cmd)
            a = answers[min(len(calls), len(answers)) - 1]
            if a == "timeout":
                raise subprocess.TimeoutExpired(cmd, kw.get("timeout", 0))
            return subprocess.CompletedProcess(cmd, 0, stdout=a, stderr="")
        return real_run(cmd, **kw)

    return run, calls


print("Termux:API probe")
run, calls = runner(['{"percentage": 80}'])
subprocess.run = run
check("answers at once → reachable, one call", api.phone_access_now()["termux_api"] is True and len(calls) == 1, str(len(calls)))

run, calls = runner(["timeout", '{"percentage": 80}'])
subprocess.run = run
check("first call doesn't answer, the retry does → reachable", api.phone_access_now()["termux_api"] is True and len(calls) == 2, str(len(calls)))

run, calls = runner(["", '{"percentage": 80}'])
subprocess.run = run
check("first call answers empty, the retry works → reachable", api.phone_access_now()["termux_api"] is True)

run, calls = runner(["timeout", "timeout", "timeout"])
subprocess.run = run
check("never answers → not reachable, gives up after 2 tries", api.phone_access_now()["termux_api"] is False and len(calls) == 2, str(len(calls)))
subprocess.run = real_run
shutil.which = shutil_which

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
