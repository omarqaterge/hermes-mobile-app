"""Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Contacts) sign-in for the Hermux app.

Hermes connects Google through its bundled `google-workspace` skill, whose own script does the whole setup
(skills/productivity/google-workspace/scripts/setup.py): `--client-secret PATH` stores the user's OAuth client,
`--auth-url` prints Google's consent link (PKCE state kept in HERMES_HOME/google_oauth_pending.json), `--auth-code
URL` takes the URL Google redirected the browser to (http://localhost:1/?code=…, a page that never loads) and saves
HERMES_HOME/google_token.json, `--check` says whether that token works, `--revoke` revokes and deletes it. Hermes's
dashboard has no route for it, so the plugin runs that same script for the chosen profile (HERMES_HOME set to the
profile's home) instead of copying its logic: whatever Hermes changes in its setup comes along.

Tokens never pass through here: the script reads and writes them in the profile's home.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Optional

SCRIPT = Path("skills") / "productivity" / "google-workspace" / "scripts" / "setup.py"
TIMEOUT = 60  # seconds for a step that may call Google (check, exchange, revoke)
INSTALL_TIMEOUT = 600  # installing Google's Python libraries into Hermes's venv


# Installing is one background job at a time for the whole Hermes: every profile shares its Python environment, and it
# takes longer than the app's HTTP call may wait. The app reads `installing` from the state.
_install = {"running": False, "error": ""}
_install_lock = threading.Lock()


class GoogleError(Exception):
    """A user-facing failure, with the script's own message."""


def agent_root() -> Optional[Path]:
    """The Hermes checkout (where hermes_constants and the bundled skills live), or None."""
    try:
        import hermes_constants

        return Path(hermes_constants.__file__).resolve().parent
    except Exception:
        return None


def find_script(home: Path) -> Optional[Path]:
    """The profile's copy of the skill first (Hermes syncs bundled skills into each home), then the main home's,
    then the one in the Hermes checkout."""
    root_home = home.parent.parent if home.parent.name == "profiles" else home
    candidates = [home / SCRIPT, root_home / SCRIPT]
    root = agent_root()
    if root:
        candidates.append(root / SCRIPT)
    return next((c for c in candidates if c.is_file()), None)


def _message(out: str, fallback: str) -> str:
    """The script's ERROR line (or its last line), without a path prefix the user can't use."""
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    err = next((ln for ln in lines if ln.startswith("ERROR:")), None)
    text = (err or (lines[-1] if lines else fallback)).removeprefix("ERROR:").strip()
    return text[:300] or fallback


def child_env(home: Path) -> dict:
    """The environment for the script: this profile's home, Hermes's own modules (hermes_constants, pm) and Hermes's
    current Python environment. The dashboard's PYTHONPATH names the one it started with, and an install publishes a
    new one, so it is asked for on every run."""
    env = dict(os.environ, HERMES_HOME=str(home), PYTHONUNBUFFERED="1")
    root = agent_root()
    if root:
        paths = [str(root)]
        try:
            from pm.environments import committed_venv, site_packages

            venv = committed_venv(root)
        except Exception:
            venv, site_packages = None, None
        if venv:
            paths.append(str(site_packages(venv)))
        elif env.get("PYTHONPATH"):
            paths.append(env["PYTHONPATH"])
        env["PYTHONPATH"] = os.pathsep.join(paths)
    return env


def run(home: Path, *args: str, timeout: int = TIMEOUT) -> tuple[int, str]:
    script = find_script(home)
    if script is None:
        raise GoogleError("This Hermes has no google-workspace skill.")
    env = child_env(home)
    root = agent_root()
    try:
        r = subprocess.run(
            [sys.executable, str(script), *args],
            env=env, cwd=str(root or home), capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise GoogleError("Google didn't answer in time. Try again.")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def status(home: Path) -> dict:
    """{available, client_secret, signed_in, unverified, detail, installing, install_error}. `--check` runs only when
    there is a token (it may refresh it). `unverified`: there is a token, but Google couldn't be asked (no network), which
    says nothing against the sign-in."""
    out = {
        "available": find_script(home) is not None,
        "client_secret": (home / "google_client_secret.json").is_file(),
        "signed_in": False,
        "unverified": False,
        "detail": "",
        "installing": _install["running"],
        "install_error": _install["error"],
    }
    if out["available"] and (home / "google_token.json").is_file():
        try:
            code, text = run(home, "--check")
        except GoogleError as e:
            out["unverified"] = True
            out["detail"] = str(e)
            return out
        out["signed_in"] = code == 0
        first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        out["unverified"] = first.startswith("REFRESH_FAILED")
        out["detail"] = "" if first.startswith("AUTHENTICATED:") else first.split(" at /")[0][:300]
    return out


def save_client_secret(home: Path, text: str) -> None:
    """Checks the pasted client file, then lets the script store it (it checks it too)."""
    try:
        data = json.loads(text)
    except ValueError:
        raise GoogleError("That isn’t the JSON file Google gave you. Paste the whole file.")
    if not isinstance(data, dict) or not ("installed" in data or "web" in data):
        raise GoogleError("That isn’t an OAuth client file: create a Desktop app client and download its JSON.")
    fd, path = tempfile.mkstemp(prefix="hm-google-client-", suffix=".json", dir=str(home))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        code, out = run(home, "--client-secret", path)
    finally:
        Path(path).unlink(missing_ok=True)
    if code != 0 or "OK:" not in out:
        raise GoogleError(_message(out, "Saving the client file failed."))
    _private(home, "google_client_secret.json")


def libraries_missing(home: Path) -> bool:
    """Hermes's own answer, in a child on the current environment. The script would start installing them itself inside
    its short time limit, so the app asks first and offers the background install. No answer (a Hermes without `pm`): not missing."""
    code = "import sys, pm.extras as e; sys.exit(0 if e.available('google') else 3)"
    try:
        return subprocess.run([sys.executable, "-c", code], env=child_env(home), capture_output=True, timeout=TIMEOUT).returncode == 3
    except subprocess.TimeoutExpired:
        return False


def _private(home: Path, name: str) -> None:
    """The script writes its files with the default mode; they hold the sign-in."""
    try:
        os.chmod(home / name, 0o600)
    except OSError:
        pass


def start(home: Path) -> str:
    """Google's consent link for this profile."""
    if libraries_missing(home):
        raise GoogleError("Google’s Python libraries aren’t installed in Hermes yet.")
    code, out = run(home, "--auth-url")
    _private(home, "google_oauth_pending.json")
    url = next((ln.strip() for ln in reversed(out.splitlines()) if ln.strip().startswith("https://")), "")
    if code != 0 or not url:
        raise GoogleError(_message(out, "Couldn’t make the sign-in link."))
    return url


def finish(home: Path, pasted: str) -> None:
    """Takes the address the browser was sent to (or just its code) and saves the token."""
    pasted = (pasted or "").strip()
    if not pasted or len(pasted) > 4000 or any(c.isspace() for c in pasted):
        raise GoogleError("Paste the whole address from the browser’s address bar (it starts with http://localhost:1).")
    code, out = run(home, "--auth-code", pasted)
    _private(home, "google_token.json")
    if code != 0 or "OK: Authenticated" not in out:
        raise GoogleError(_message(out, "Google didn’t accept that. Start the sign-in again."))


def revoke(home: Path) -> str:
    """Deletes the token. Answers a warning when Google couldn't be told (the script deletes it anyway): the access stays
    open at Google until the user removes it there."""
    code, out = run(home, "--revoke")
    if code != 0:
        raise GoogleError(_message(out, "Signing out failed."))
    return "Google couldn’t be told, so its access stays listed in your Google account (myaccount.google.com/permissions)." if "revocation failed" in out else ""


def _install_job(home: Path) -> None:
    error = ""
    try:
        code, out = run(home, "--install-deps", timeout=INSTALL_TIMEOUT)
        if code != 0:
            error = _message(out, "Installing Google’s libraries failed.")
    except GoogleError as e:
        error = str(e)
    except Exception as e:
        error = f"Installing Google’s libraries failed ({type(e).__name__})."
    with _install_lock:
        _install.update(running=False, error=error)


def install_deps(home: Path) -> None:
    """Starts installing Google's Python libraries into Hermes's environment (the script's own --install-deps), unless
    that is already running. The state's `installing` and `install_error` say how it goes."""
    with _install_lock:
        if _install["running"]:
            return
        _install.update(running=True, error="")
    threading.Thread(target=_install_job, args=(home,), daemon=True, name="hm-google-install").start()
