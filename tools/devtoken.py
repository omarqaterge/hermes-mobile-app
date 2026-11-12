"""The Hermes dashboard's session token for the developer tools on a computer (tools/api, tools/battery/reqcost.py,
tools/battery/wschat.py, web/devserver.py), from a verified dashboard only: local_auth.dashboard_token (the hello, the
signed token request and the proof over the answer) with the shared key from HM_EVENT_KEY or the phone's key file.
The key itself is never sent.

Over `adb forward` the phone's dashboard proves its own address, so the proof is checked against HM_DASH_ADDR (default
127.0.0.1:9119) rather than the local port dialled. Without a key, ``plain=True`` reads the token from the page with no
key at all: only for a mock or a throwaway Hermes on this computer (tools/web-e2e), never the phone's.
"""
import importlib.util
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

KEY_FILE = "/data/data/com.termux/files/home/.hermes-mobile/key"
LOCAL_AUTH = Path(__file__).resolve().parent.parent / "hermes-plugin" / "hermes-mobile" / "local_auth.py"


def local_auth():
    mod = sys.modules.get("hm_local_auth")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_local_auth", LOCAL_AUTH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules["hm_local_auth"] = mod
    return mod


def key() -> str:
    k = os.environ.get("HM_EVENT_KEY", "").strip()
    if not k and os.path.exists(KEY_FILE):
        k = Path(KEY_FILE).read_text().strip()
    return k


def dashboard_token(base: str = "http://127.0.0.1:9119", plain: bool = False, timeout: float = 10) -> str:
    """The token of the dashboard at ``base`` (``http://127.0.0.1:<port>``). Raises SystemExit with a plain message when
    there is no key (unless ``plain``) or the dashboard doesn't verify."""
    u = urllib.parse.urlsplit(base)
    if u.hostname != "127.0.0.1":
        raise SystemExit("the dashboard must be on 127.0.0.1")
    port = u.port or 80
    k = key()
    if not k:
        if not plain:
            raise SystemExit("no key: set HM_EVENT_KEY to the phone's key (tools/phone 'cat ~/.hermes-mobile/key')")
        page = urllib.request.urlopen(base.rstrip("/") + "/", timeout=timeout).read().decode()
        m = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page)
        return m.group(1) if m else ""
    la = local_auth()
    try:
        return la.dashboard_token(port, k, timeout=timeout, server=os.environ.get("HM_DASH_ADDR") or "127.0.0.1:9119")
    except la.Unverified as e:
        raise SystemExit(f"the dashboard was not verified ({e.why}); nothing was sent") from None
    except OSError:
        raise SystemExit("the dashboard's token answer was unusable") from None
