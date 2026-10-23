"""In-app Claude (Pro/Max subscription) sign-in for the Hermes Mobile app.

It is the same PKCE login `hermes auth add anthropic` runs in a terminal, split in two steps so the app can show
it in its own UI: `start` makes the claude.ai link (the user opens it in the browser and signs in), `finish` takes
the code claude.ai shows (`code#state`), exchanges it and saves the login.

Everything that matters comes from Hermes itself: the link parameters, PKCE pair and token exchange from
`agent.anthropic_credentials`, and the save from `hermes_cli.auth_commands` (its per-provider spec, label and
credential-pool entry), so the login lands exactly where `hermes auth add anthropic` puts it: a new entry in the
current profile's credential pool (auth.json → credential_pool.anthropic, source manual:hermes_pkce).

Tokens never leave this module: they are not returned, logged or kept after the save. A session (PKCE verifier +
state) lives in memory for 10 minutes at most and is used once.
"""

import json
import secrets
import threading
import time
from typing import Optional

TTL = 600  # seconds a started sign-in stays usable
MAX_SESSIONS = 8

_sessions: dict = {}
_lock = threading.Lock()


class LoginError(Exception):
    """A user-facing failure (wrong or expired code, Claude refused the exchange)."""


def _gc(now: float) -> None:
    for sid in [s for s, v in _sessions.items() if now - v["at"] > TTL]:
        _sessions.pop(sid, None)


def _profile_key(profile: Optional[str]) -> str:
    p = (profile or "").strip()
    return "" if p in ("", "default", "current") else p


def start(profile: Optional[str] = None) -> dict:
    """New sign-in: returns {session_id, url, expires_in}. The URL is the one `hermes auth add anthropic` prints."""
    from urllib.parse import urlencode

    from agent import anthropic_credentials as ac

    verifier, challenge = ac._generate_pkce()
    state = secrets.token_urlsafe(32)
    params = {
        "code": "true", "client_id": ac._OAUTH_CLIENT_ID, "response_type": "code", "redirect_uri": ac._OAUTH_REDIRECT_URI,
        "scope": ac._OAUTH_SCOPES, "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
    }
    sid = secrets.token_urlsafe(16)
    with _lock:
        now = time.time()
        _gc(now)
        while len(_sessions) >= MAX_SESSIONS:  # oldest first (dicts keep insertion order)
            _sessions.pop(next(iter(_sessions)))
        _sessions[sid] = {"verifier": verifier, "state": state, "profile": _profile_key(profile), "at": now}
    return {"session_id": sid, "url": f"https://claude.ai/oauth/authorize?{urlencode(params)}", "expires_in": TTL}


def cancel(session_id: str) -> bool:
    with _lock:
        return _sessions.pop(session_id, None) is not None


def finish(session_id: str, code: str, profile: Optional[str] = None) -> dict:
    """Exchange the pasted `code#state` and save the login. Returns {ok, label}; raises LoginError for the user."""
    raw = "".join((code or "").split())  # a pasted code may carry spaces or line breaks
    with _lock:
        _gc(time.time())
        sess = _sessions.get(session_id)
        if sess is None:
            raise LoginError("This sign-in expired. Start again.")
        if sess["profile"] != _profile_key(profile):
            raise LoginError("This sign-in was started for another profile. Start again.")
        if not raw:
            raise LoginError("Paste the code Claude shows first.")
        auth_code, _, got_state = raw.partition("#")
        # Same CSRF guard as Hermes's CLI login (RFC 6749 §10.12). The session survives so the user can paste again.
        if not auth_code or not got_state or not secrets.compare_digest(got_state, sess["state"]):
            raise LoginError("That isn’t the code from this sign-in. Copy the whole code Claude shows (it has a # in the middle).")
        _sessions.pop(session_id, None)  # the code is single-use from here on, whatever the exchange says

    from agent import anthropic_credentials as ac

    try:
        result = ac._post_oauth_token(
            json.dumps({
                "grant_type": "authorization_code", "client_id": ac._OAUTH_CLIENT_ID, "code": auth_code, "state": got_state,
                "redirect_uri": ac._OAUTH_REDIRECT_URI, "code_verifier": sess["verifier"],
            }).encode(),
            content_type="application/json", timeout=15, what="exchange",
        )
    except Exception as e:
        raise LoginError(f"Claude didn’t accept the code ({_short(e)}). Start again.")
    creds = ac._oauth_token_state(result if isinstance(result, dict) else {})
    if not creds.get("access_token"):
        raise LoginError("Claude didn’t send a login back. Start again.")
    return {"ok": True, "label": _save(creds)}


def _short(e: Exception) -> str:
    return (str(e) or type(e).__name__).splitlines()[0][:160]


def _save(creds: dict) -> str:
    """Store the login the way `hermes auth add anthropic` does (auth_commands.auth_add_command → _add_credential)."""
    from hermes_cli import auth_commands as cmd

    provider = "anthropic"
    spec = cmd._OAUTH_ADD_SPECS[provider]
    pool = cmd.load_pool(provider)
    cmd._unsuppress_provider_sources(provider)  # re-adding a login re-enables the provider's sources, as the CLI does
    token = spec.token(creds)
    label = cmd.label_from_token(token, f"{provider}-oauth-{len(pool.entries()) + 1}")
    entry = cmd.PooledCredential(
        provider=provider, id=cmd.uuid.uuid4().hex[:6], label=label, auth_type=spec.auth_type, priority=0,
        source=spec.source(creds) if callable(spec.source) else spec.source,
        access_token=token, **spec.fields(creds, provider),
    )
    entry = pool.add_entry(entry)
    return str(getattr(entry, "label", label) or label)
