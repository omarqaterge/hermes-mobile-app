"""Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Contacts) sign-in for the Hermes Mobile app.

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
from pathlib import Path
from typing import Optional

SCRIPT = Path("skills") / "productivity" / "google-workspace" / "scripts" / "setup.py"
TIMEOUT = 60  # seconds for a step that may call Google (check, exchange, revoke)
INSTALL_TIMEOUT = 600  # installing Google's Python libraries into Hermes's venv


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


def run(home: Path, *args: str, timeout: int = TIMEOUT) -> tuple[int, str]:
    script = find_script(home)
    if script is None:
        raise GoogleError("This Hermes has no google-workspace skill.")
    env = dict(os.environ, HERMES_HOME=str(home), PYTHONUNBUFFERED="1")
    root = agent_root()
    if root:  # the script imports Hermes's own modules (hermes_constants, pm) when they are importable
        env["PYTHONPATH"] = os.pathsep.join(p for p in (str(root), env.get("PYTHONPATH", "")) if p)
    try:
        r = subprocess.run(
            [sys.executable, str(script), *args],
            env=env, cwd=str(root or home), capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise GoogleError("Google didn't answer in time. Try again.")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def status(home: Path) -> dict:
    """{available, client_secret, signed_in, detail}. `--check` runs only when there is a token (it may refresh it)."""
    out = {
        "available": find_script(home) is not None,
        "client_secret": (home / "google_client_secret.json").is_file(),
        "signed_in": False,
        "detail": "",
    }
    if out["available"] and (home / "google_token.json").is_file():
        try:
            code, text = run(home, "--check")
        except GoogleError as e:
            out["detail"] = str(e)
            return out
        out["signed_in"] = code == 0
        first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
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
    try:
        os.chmod(home / "google_client_secret.json", 0o600)
    except OSError:
        pass


def start(home: Path) -> str:
    """Google's consent link for this profile."""
    code, out = run(home, "--auth-url")
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
    if code != 0 or "OK: Authenticated" not in out:
        raise GoogleError(_message(out, "Google didn’t accept that. Start the sign-in again."))


def revoke(home: Path) -> None:
    code, out = run(home, "--revoke")
    if code != 0:
        raise GoogleError(_message(out, "Signing out failed."))


def install_deps(home: Path) -> None:
    """Installs Google's Python libraries into Hermes's environment (the script's own --install-deps)."""
    code, out = run(home, "--install-deps", timeout=INSTALL_TIMEOUT)
    if code != 0:
        raise GoogleError(_message(out, "Installing Google’s libraries failed."))
