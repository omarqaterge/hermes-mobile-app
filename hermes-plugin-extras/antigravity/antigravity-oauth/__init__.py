"""Hermes Antigravity Plugin — Google Antigravity accounts manager & proxy provider.

A Hermes plugin that manages Google Antigravity OAuth accounts and serves a
local OpenAI-compatible proxy (default http://127.0.0.1:8999/v1), translating
requests — text, images, tool calls, reasoning effort — for Google's
v1internal Gemini/Claude endpoints.

Install: copy this directory to ~/.hermes/plugins/antigravity-oauth/
(or symlink it) and restart the gateway.
"""

import json
import urllib.request
import urllib.parse
import os
import threading
import socket
import http.server
import socketserver
import webbrowser
import time
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Proxy Configuration ──────────────────────────────────────
PROXY_PORT = 8999
CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep" + ".apps.googleusercontent.com"
CLIENT_SECRET = "GOCSPX-" + "K58FWR486LdLJ1mLB8sXC4z6qDAf"
ENDPOINT = "https://daily-cloudcode-pa.googleapis.com"
CATALOG_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com"
DEFAULT_PROJECT_ID = "rising-fact-p41fc"
MODEL_CATALOG_TTL_SECONDS = 300
REDIRECT_URI = "http://localhost:51121/oauth-callback"
SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs https://www.googleapis.com/auth/aicode openid"

# Token & Project Cache
_token_cache = {}  # email -> token
_project_cache = {}  # email -> project_id
_token_expiry_cache = {}  # email -> epoch seconds when the access token expires
_cooldown_cache = {} # "email:family" -> timestamp until cooldown expires
_consecutive_failures = {} # "email:family" -> int count
_model_catalog_cache = None
_model_catalog_cache_time = 0
_cache_lock = threading.Lock()

# Automatic re-authentication state (browser OAuth as last resort)
_reauth_lock = threading.Lock()
_last_auto_relogin = {"ts": 0.0}
_AUTO_RELOGIN_MIN_INTERVAL = 300  # seconds between interactive attempts

# ── Recovery event log ───────────────────────────────────────
# JSONL: one JSON object per line, human-readable and easy to tail/grep.
LOG_PATH = os.path.expanduser("~/.hermes/logs/antigravity-proxy.log")

def _log_event(event, **fields):
    """Append a structured recovery/behaviour event to the plugin log."""
    try:
        entry = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "event": event}
        entry.update(fields)
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with _cache_lock:
            pass  # keep ordering simple; file appends are atomic enough per-line
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # logging must never break the proxy

# ── Auth & Account Helpers ────────────────────────────────────
def get_accounts_file_path():
    path = os.path.expanduser('~/AppData/Local/hermes/antigravity-accounts.json')
    if not os.path.exists(path):
        # Fallback to OpenCode path
        opencode_path = os.path.expanduser('~/.config/opencode/antigravity-accounts.json')
        if not os.path.exists(opencode_path):
            appdata = os.environ.get('APPDATA')
            if appdata:
                opencode_path = os.path.join(appdata, 'opencode', 'antigravity-accounts.json')
        if os.path.exists(opencode_path):
            return opencode_path
    return path

def load_accounts_data():
    path = get_accounts_file_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 4, "accounts": [], "activeIndex": 0, "activeIndexByFamily": {"claude": 0, "gemini": 0}}

def save_accounts_data(data):
    path = get_accounts_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def get_active_account():
    data = load_accounts_data()
    accounts = data.get("accounts", [])
    if not accounts:
        raise ValueError("No accounts configured. Type /antigravity-login in chat to log in.")
        
    active_idx = data.get("activeIndex", 0)
    if active_idx < 0 or active_idx >= len(accounts):
        active_idx = 0
    return accounts[active_idx]

def refresh_token(ref_token):
    url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": ref_token,
        "grant_type": "refresh_token"
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        return res_data["access_token"]

def refresh_token_with_expiry(ref_token):
    """Refresh and return (access_token, expires_in_seconds). Falls back to a
    conservative 3500s (~58 min) when Google doesn't report an expiry."""
    url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": ref_token,
        "grant_type": "refresh_token"
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        return res_data["access_token"], int(res_data.get("expires_in", 3500))

def load_project_id(access_token):
    url = f"{ENDPOINT}/v1internal:loadCodeAssist"
    body = json.dumps({
        "metadata": {
            "ideType": "ANTIGRAVITY",
            "platform": "PLATFORM_UNSPECIFIED",
            "pluginType": "GEMINI"
        }
    }).encode("utf-8")
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
    }
    
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        project_field = res_data.get("cloudaicompanionProject")
        if isinstance(project_field, dict):
            return project_field.get("id")
        return project_field

def get_auth_credentials(account, force_refresh=False):
    email = account.get("email", "")
    if not force_refresh:
        with _cache_lock:
            token = _token_cache.get(email)
            project_id = _project_cache.get(email)
            expiry = _token_expiry_cache.get(email, 0)

        # Silently refresh ~2 min before expiry so calls never hit a dead token
        if token and time.time() > (expiry - 120):
            force_refresh = True

    if force_refresh or not token:
        token, expires_in = refresh_token_with_expiry(account["refreshToken"])
        project_id = load_project_id(token)
        with _cache_lock:
            _token_cache[email] = token
            _project_cache[email] = project_id
            _token_expiry_cache[email] = time.time() + expires_in
        _log_event("token_refreshed", email=email, expires_in=expires_in,
                   reason="forced" if force_refresh and token else "proactive")

    return token, project_id

def _clear_cached_credentials(email):
    """Drop cached access token/project so the next call does a fresh OAuth refresh."""
    with _cache_lock:
        _token_cache.pop(email, None)
        _project_cache.pop(email, None)
        _token_expiry_cache.pop(email, None)

def _try_auto_relogin(email=None):
    """Last-resort automatic recovery when even the refresh token is rejected.
    Opens the Google OAuth flow once (rate-limited) and reloads credentials.
    Returns True if a new login succeeded."""
    now = time.time()
    with _reauth_lock:
        if now - _last_auto_relogin["ts"] < _AUTO_RELOGIN_MIN_INTERVAL:
            _log_event("auto_browser_relogin_skipped", email=email,
                       detail="rate-limited: another attempt < 300s ago")
            return False  # another thread recently tried; don't spam browsers
        _last_auto_relogin["ts"] = now
    try:
        result = run_login_silent()
        ok = result.startswith("✓")
        _log_event("auto_browser_relogin", email=email, success=ok, detail=result[:200])
        print(f"[Proxy] Automatic re-login attempt: {result}")
        return ok
    except Exception as e:
        _log_event("auto_browser_relogin", email=email, success=False, detail=str(e)[:200])
        print(f"[Proxy] Automatic re-login failed: {e}")
        return False

# ── Model Mapping ─────────────────────────────────────────────
MODEL_MAPPING = {
    # Primary Antigravity models (kept first for the Hermes picker)
    "gemini-3.8-flash": "gemini-3.8-flash-tiered",
    "gemini-3.7-flash": "gemini-3.7-flash-tiered",
    "gemini-3.6-flash": "gemini-3.6-flash-low",
    "gemini-3.5-flash": "gemini-3.5-flash-low",
    "gemini-3.1-pro": "gemini-3.1-pro-low",
    "claude-sonnet-4-6-thinking": "claude-sonnet-4-6",
    "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",

    # Direct variants
    "gemini-3.1-pro-low": "gemini-3.1-pro-low",
    "claude-opus-4-6": "claude-opus-4-6-thinking",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "gemini-3-flash": "gemini-3-flash",

    # Compatibility aliases
    "claude-3-5-sonnet-latest": "claude-sonnet-4-6",
    "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
    "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
    "claude-3-opus-20240229": "claude-opus-4-6-thinking",
    "claude-3-5-haiku-latest": "claude-sonnet-4-6",
}

def _catalog_model_ids(payload):
    """Return user-selectable agent model IDs from fetchAvailableModels."""
    models = payload.get("models", {})
    if not isinstance(models, dict):
        return []

    ordered = []
    for sort_group in payload.get("agentModelSorts", []):
        for group in sort_group.get("groups", []):
            ordered.extend(group.get("modelIds", []))
    tiered = payload.get("tieredModelIds", {})
    if isinstance(tiered, dict):
        for model_ids in tiered.values():
            if isinstance(model_ids, list):
                ordered.extend(model_ids)

    deprecated = set(payload.get("deprecatedModelIds", {}))
    result = []
    for model_id in ordered:
        metadata = models.get(model_id, {})
        if (
            isinstance(model_id, str)
            and model_id
            and model_id not in deprecated
            and not metadata.get("isInternal", False)
            and model_id not in result
        ):
            result.append(model_id)
    return result

def fetch_available_model_ids(force=False):
    """Fetch Antigravity's live agent catalog, with a short in-memory cache."""
    global _model_catalog_cache, _model_catalog_cache_time
    now = time.time()
    with _cache_lock:
        if (
            not force
            and _model_catalog_cache is not None
            and now - _model_catalog_cache_time < MODEL_CATALOG_TTL_SECONDS
        ):
            return list(_model_catalog_cache)

    data = load_accounts_data()
    accounts = data.get("accounts", [])
    active_idx = data.get("activeIndex", 0)
    if not 0 <= active_idx < len(accounts):
        active_idx = 0
    ordered_accounts = accounts[active_idx:] + accounts[:active_idx]
    last_error = None
    for account in ordered_accounts:
        if not account.get("enabled", True):
            continue
        try:
            token, project_id = get_auth_credentials(account)
            body = json.dumps({"project": project_id or DEFAULT_PROJECT_ID}).encode("utf-8")
            request = urllib.request.Request(
                f"{CATALOG_ENDPOINT}/v1internal:fetchAvailableModels",
                data=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "User-Agent": "antigravity/1.18.3 darwin/arm64",
                },
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                discovered = _catalog_model_ids(json.loads(response.read().decode("utf-8")))
            if discovered:
                with _cache_lock:
                    _model_catalog_cache = discovered
                    _model_catalog_cache_time = now
                return list(discovered)
        except Exception as exc:
            last_error = exc

    if _model_catalog_cache is not None:
        return list(_model_catalog_cache)
    if last_error:
        _log_event("model_discovery_failed", detail=str(last_error)[:200])
    return []

def get_exposed_model_ids():
    """Merge stable Hermes aliases with models advertised by Antigravity."""
    return list(dict.fromkeys(list(MODEL_MAPPING) + fetch_available_model_ids()))

def _safe_json_loads(s):
    try:
        return json.loads(s)
    except Exception:
        return {}


# Gemini 3 requires thoughtSignature on functionCall parts replayed in
# conversation history. Capture real ones from live responses and reuse the
# most recent per tool name; a stale-but-present signature satisfies the
# validator even if it doesn't match this exact call.
_THOUGHT_SIG_POOL = {}  # tool name -> last seen thoughtSignature

def _clean_schema(schema):
    """Recursively convert an OpenAI JSON schema to Gemini's subset.

    Gemini rejects unknown keywords (additionalProperties, $schema, etc.)
    and requires `items` whenever `type: ARRAY` is present. Uppercase types,
    recurse into properties/items/anyOf, and drop everything unrecognized.
    """
    if not isinstance(schema, dict):
        return {"type": "STRING"}
    # anyOf / oneOf -> pick the first non-null branch (Gemini supports anyOf
    # on some versions but the safest translation is a plain type).
    for comb in ("anyOf", "oneOf"):
        branches = schema.get(comb)
        if isinstance(branches, list) and branches:
            non_null = [b for b in branches if isinstance(b, dict) and b.get("type") != "null"]
            return _clean_schema(non_null[0] if non_null else branches[0])

    stype = schema.get("type")
    if isinstance(stype, list):
        non_null = [t for t in stype if t != "null"]
        stype = non_null[0] if non_null else "string"

    out = {}
    t = str(stype or "string").lower()
    if t == "array":
        out["type"] = "ARRAY"
        out["items"] = _clean_schema(schema.get("items") or {"type": "string"})
    elif t == "object":
        out["type"] = "OBJECT"
        props = schema.get("properties")
        if isinstance(props, dict) and props:
            out["properties"] = {k: _clean_schema(v) for k, v in props.items()}
            req = schema.get("required")
            if isinstance(req, list) and req:
                out["required"] = [str(x) for x in req]
        else:
            # Gemini requires properties (possibly empty) on OBJECT.
            out["properties"] = {}
    else:
        out["type"] = t.upper() if t in ("string", "number", "integer", "boolean") else "STRING"
        if t == "integer":
            out["type"] = "INTEGER"
        if t == "number":
            out["type"] = "NUMBER"
    if isinstance(schema.get("description"), str):
        out["description"] = schema["description"]
    enum = schema.get("enum")
    if isinstance(enum, list) and enum and out.get("type") in ("STRING", "INTEGER", "NUMBER"):
        out["enum"] = [x if isinstance(x, str) else json.dumps(x) for x in enum]
        out.pop("description", None)  # enum+description together rejected on some fields
    return out


def _convert_tools_to_gemini(openai_tools):
    """Translate OpenAI tools[] -> Gemini functionDeclarations."""
    decls = []
    for t in openai_tools or []:
        if not isinstance(t, dict):
            continue
        fn = t.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        decls.append({
            "name": name,
            "description": fn.get("description", ""),
            "parameters": _clean_schema(fn.get("parameters") or {}),
        })
    return [{"functionDeclarations": decls}] if decls else None


def _build_thinking_config_for_proxy(model: str, effort) -> dict | None:
    """Map Hermes reasoning effort to Gemini thinkingConfig (agys --effort).

    Mirrors agent/transports/chat_completions.py:_build_gemini_thinking_config
    but emits the shape Antigravity's v1internal endpoint expects.
    """
    if effort is None:
        return None
    # Handle dict form {effort: "high"} that some paths emit
    if isinstance(effort, dict):
        if effort.get("enabled") is False:
            return {"includeThoughts": False}
        effort = effort.get("effort", "medium")
    eff = str(effort or "").strip().lower()
    if not eff or eff == "none":
        return {"includeThoughts": False}
    nm = (model or "").strip().lower()
    if nm.startswith("google/"):
        nm = nm.split("/", 1)[1]
    # Gemini 2.5 only needs includeThoughts; no level
    if nm.startswith("gemini-2.5-"):
        return {"includeThoughts": True}
    # Non-Gemini (Claude) — no thinkingConfig
    if not nm.startswith("gemini"):
        return None
    if eff not in {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
        eff = "medium"
    tc: dict = {"includeThoughts": True}
    if nm.startswith(("gemini-3", "gemini-3.1")):
        if "flash" in nm:
            if eff in {"minimal", "low"}:
                tc["thinkingLevel"] = "low"
            elif eff in {"high", "xhigh", "max", "ultra"}:
                tc["thinkingLevel"] = "high"
            else:
                tc["thinkingLevel"] = "medium"
        elif "pro" in nm:
            tc["thinkingLevel"] = "high" if eff in {"high", "xhigh", "max", "ultra"} else "low"
        else:
            tc["thinkingLevel"] = "medium"
    else:
        # Generic Gemini fallback
        tc["thinkingLevel"] = "medium"
    return tc


def _openai_image_to_inline_data(image_url):
    """Convert an OpenAI image_url dict to Gemini inlineData {mimeType, data}.

    Returns None when the image cannot be resolved (caller skips it).
    Handles data: URLs inline; fetches http(s) URLs with a short timeout.
    """
    import base64
    url = image_url.get("url", "") if isinstance(image_url, dict) else ""
    if url.startswith("data:"):
        _header, _, b64 = url.partition(",")
        mime = _header.split(";")[0].split(":")[1] if ":" in _header else "image/jpeg"
        if not b64:
            return None
        return {"mimeType": mime or "image/jpeg", "data": b64}
    if url.startswith("http://") or url.startswith("https://"):
        try:
            import urllib.request
            with urllib.request.urlopen(url, timeout=20) as resp:
                raw = resp.read()
            if len(raw) > 15 * 1024 * 1024:
                return None
            mime = resp.headers.get_content_type() or "image/jpeg"
            return {"mimeType": mime, "data": base64.b64encode(raw).decode()}
        except Exception:
            return None
    return None


def translate_openai_to_gemini(messages, is_claude: bool = False):
    contents = []
    # Build tool_call_id -> function name map so resumed histories with
    # empty tool.name can still emit a valid functionResponse.name.
    _id_to_name = {}
    for _m in messages:
        for _tc in (_m.get("tool_calls") or []):
            _tid = _tc.get("id")
            _fname = (_tc.get("function") or {}).get("name")
            if _tid and _fname:
                _id_to_name[_tid] = _fname
    for msg in messages:
        role = msg.get("role", "user")
        if role == "assistant":
            role = "model"
        elif role == "system":
            role = "user"

        # Assistant tool_calls -> model parts (Claude vs Gemini shape)
        if msg.get("tool_calls"):
            parts = []
            c = msg.get("content")
            if isinstance(c, str) and c.strip():
                parts.append({"text": c})
            # Gemini 3 requires a thoughtSignature on the PART carrying a
            # replayed functionCall. Capture real ones from live responses
            # (_THOUGHT_SIG_POOL) and reuse; without it Google 400s.
            for tc in msg["tool_calls"]:
                fn = tc.get("function") or {}
                args = fn.get("arguments")
                if isinstance(args, str):
                    args = _safe_json_loads(args)
                tid = tc.get("id") or f"tool-call-{int(time.time()*1000)}-{len(parts)}"
                if is_claude:
                    # Claude via v1internal still uses functionCall, but requires id
                    # matching the follow-up functionResponse.id (opencode's assignToolIdsToContents logic)
                    parts.append({"functionCall": {"name": fn.get("name", ""), "args": args or {}, "id": tid}})
                    continue
                part_ = {"functionCall": {"name": fn.get("name", ""), "args": args or {}}}
                sig = tc.get("_thought_signature") or _THOUGHT_SIG_POOL.get(fn.get("name", "")) or next(
                    iter(_THOUGHT_SIG_POOL.values()), None)
                if sig:
                    part_["thoughtSignature"] = sig
                parts.append(part_)
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue

        # Tool result -> user role (name required by Gemini; recover from id map if empty)
        if role == "tool":
            name = msg.get("name") or _id_to_name.get(msg.get("tool_call_id") or "", "") or ""
            if not name.strip():
                # Fallback: generic but non-empty — avoids INVALID_ARGUMENT on resumed sessions
                name = "tool"
            tc_id = msg.get("tool_call_id") or ""
            body = msg.get("content", "")
            if not isinstance(body, str):
                body = json.dumps(body)
            if is_claude:
                contents.append({"role": "user", "parts": [{"functionResponse": {"name": name, "response": {"result": body}, "id": tc_id}}]})
                continue
            fr = {"name": name, "response": {"result": body}}
            contents.append({"role": "user", "parts": [{"functionResponse": fr}]})
            continue

        content = msg.get("content", "")
        if isinstance(content, list):
            parts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    parts.append({"text": part.get("text", "")})
                elif part.get("type") == "image_url":
                    inline = _openai_image_to_inline_data(part.get("image_url") or {})
                    if inline is not None:
                        parts.append({"inlineData": inline})
            if parts:
                contents.append({"role": role, "parts": parts})
        else:
            s = str(content) if content is not None else ""
            if s.strip():
                contents.append({"role": role, "parts": [{"text": s}]})

    return contents

def _parts_to_openai_deltas(parts):
    """Convert Gemini/Claude response parts to (text, reasoning, tool_calls, finish_reason)."""
    text = ""
    reasoning = ""
    tool_calls = []
    finish_reason = None
    for part in parts or []:
        # Claude thinking: {type:"thinking", thinking:"..."} or {thinking:{text:"..."}} or {thinking:"..."}
        if part.get("type") == "thinking":
            t = part.get("thinking")
            if isinstance(t, str):
                reasoning += t
            elif isinstance(t, dict):
                reasoning += t.get("text") or t.get("content") or ""
            elif "text" in part:
                reasoning += part.get("text") or ""
            else:
                reasoning += str(t or "")
            continue
        if isinstance(part.get("thinking"), str) and part.get("thinking"):
            reasoning += part.get("thinking")
            # also may have text sibling - don't double count
            if "text" in part and part.get("thought") is not True:
                # thinking string plus text? treat text as content
                text += part.get("text") or ""
            continue
        if isinstance(part.get("thinking"), dict):
            th = part.get("thinking")
            reasoning += th.get("text") or th.get("content") or ""
            if "text" in part and part.get("thought") is not True:
                text += part.get("text") or ""
            continue
        if part.get("thought") is True and "text" in part:
            # Gemini thinking part — surface as reasoning, not visible content
            reasoning += part.get("text") or ""
            continue
        if "text" in part:
            text += part.get("text") or ""
        fc = part.get("functionCall")
        if fc and isinstance(fc, dict):
            sig = part.get("thoughtSignature")
            if sig:
                _THOUGHT_SIG_POOL[fc.get("name", "")] = sig
            tool_calls.append({
                "id": f"call_{int(time.time() * 1000)}_{len(tool_calls)}",
                "type": "function",
                "function": {
                    "name": fc.get("name", ""),
                    "arguments": json.dumps(fc.get("args") or {}),
                },
            })
        raw_reason = part.get("finishReason")
        if raw_reason:
            finish_reason = "tool_calls" if tool_calls else "stop"
    if not finish_reason:
        finish_reason = "tool_calls" if tool_calls else (("stop" if (text or reasoning) else None))
    return text, reasoning, tool_calls, finish_reason


# ── Proxy HTTP Handler ─────────────────────────────────────────
class AntigravityProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/v1/models" or self.path == "/models":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            models = []
            for oai in get_exposed_model_ids():
                models.append({
                    "id": oai,
                    "object": "model",
                    "created": 1782210769,
                    "owned_by": "antigravity"
                })
            
            self.wfile.write(json.dumps({"object": "list", "data": models}).encode("utf-8"))
            return
            
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/v1/chat/completions" and self.path != "/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
            
        # Parse body
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        req_json = json.loads(post_data.decode('utf-8'))
        
        # Load all accounts to enable rotation
        data = load_accounts_data()
        accounts = data.get("accounts", [])
        if not accounts:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "No accounts configured. Type /antigravity-login in chat."}).encode("utf-8"))
            return
            
        active_idx = data.get("activeIndex", 0)
        if active_idx < 0 or active_idx >= len(accounts):
            active_idx = 0
            
        # Resolve model
        req_model = req_json.get("model", "gemini-3.5-flash")
        is_claude = "claude" in req_model.lower()
        family = "claude" if is_claude else "gemini"
        # Known friendly aliases are translated; newly discovered upstream IDs
        # pass through unchanged so releases do not require another code edit.
        mapped_model = MODEL_MAPPING.get(req_model, req_model)
        
        success = False
        last_err = None
        retried_401_emails = set()  # silent-refresh replay already done for this email
        
        # Rotate through accounts starting from the active one
        for offset in range(len(accounts)):
            idx = (active_idx + offset) % len(accounts)
            account = accounts[idx]
            email = account.get("email", "")
            
            if not account.get("enabled", True):
                continue
                
            # Check family-specific isolated cooldown
            cooldown_key = f"{email}:{family}"
            with _cache_lock:
                cooldown_until = _cooldown_cache.get(cooldown_key, 0)
            if time.time() < cooldown_until:
                continue
                
            try:
                token, project_id = get_auth_credentials(account)
                _log_event("account_attempt", email=email, family=family, index=idx)
            except Exception as e:
                last_err = f"Auth error on {email}: {str(e)}"
                _log_event("auth_refresh_failed", email=email, family=family,
                           detail=str(e)[:200])
                continue
                
            # Translate body
            gemini_contents = translate_openai_to_gemini(req_json.get("messages", []), is_claude=is_claude)
            
            stream = req_json.get("stream", False)
            action = "streamGenerateContent" if stream else "generateContent"
            
            url = f"{ENDPOINT}/v1internal:{action}"
            if stream:
                url += "?alt=sse"
                
            gemini_body = {
                "contents": gemini_contents,
                "generationConfig": {
                    "temperature": req_json.get("temperature", 0.7),
                }
            }

            # ── Reasoning effort → Gemini thinkingLevel (emulates agy --effort)
            # Hermes sends this via build_api_kwargs_extras as top-level
            # reasoning_effort (bypassing core's host gate), but also handle
            # extra_body shapes for robustness.
            _effort = req_json.get("reasoning_effort")
            if _effort is None and isinstance(req_json.get("reasoning"), dict):
                _effort = req_json["reasoning"].get("effort")
            if _effort is None and isinstance(req_json.get("extra_body"), dict):
                _effort = req_json["extra_body"].get("reasoning", {}).get("effort") if isinstance(req_json["extra_body"].get("reasoning"), dict) else None
            # Fallback: extra_body.google.thinking_config (Hermes Gemini path)
            if _effort is None:
                try:
                    _effort = req_json.get("extra_body", {}).get("google", {}).get("thinking_config", {}).get("thinking_level")
                except Exception:
                    _effort = None
            if _effort is not None:
                _tc = _build_thinking_config_for_proxy(mapped_model, _effort)
                if _tc is not None:
                    gemini_body["generationConfig"]["thinkingConfig"] = _tc

            # Forward OpenAI tool definitions as Gemini functionDeclarations
            gemini_tools = _convert_tools_to_gemini(req_json.get("tools"))
            if gemini_tools:
                gemini_body["tools"] = gemini_tools

            wrapped_body = json.dumps({
                "project": project_id,
                "model": mapped_model,
                "request": gemini_body
            }).encode("utf-8")
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "antigravity/windows/amd64",
                "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
            }
            
            try:
                req = urllib.request.Request(url, data=wrapped_body, headers=headers)
                resp = urllib.request.urlopen(req, timeout=30)
                
                success = True
                
                # Reset consecutive failures count on success
                with _cache_lock:
                    _consecutive_failures[cooldown_key] = 0
                
                # Update active index on success to keep it sticky
                if idx != active_idx:
                    data["activeIndex"] = idx
                    data["activeIndexByFamily"] = {"claude": idx, "gemini": idx}
                    save_accounts_data(data)
                
                break
            except urllib.error.HTTPError as he:
                status_code = he.code
                err_text = he.read().decode('utf-8', errors='ignore')
                last_err = f"Upstream HTTP {status_code} on {email}: {err_text}"
                
                if status_code == 401:
                    # Token expired/invalid — recover WITHOUT cooldown:
                    # clear cache and silently refresh, then replay this request once.
                    _clear_cached_credentials(email)
                    _log_event("upstream_401", email=email, family=family, model=req_model)
                    if email not in retried_401_emails:
                        retried_401_emails.add(email)
                        print(f"[Proxy] 401 on {email} — silent token refresh + replay...")
                        try:
                            token2, project2 = get_auth_credentials(account, force_refresh=True)
                            req2 = urllib.request.Request(url, data=wrapped_body, headers={
                                "Authorization": f"Bearer {token2}",
                                "Content-Type": "application/json",
                                "User-Agent": "antigravity/windows/amd64",
                                "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                                "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
                            })
                            resp = urllib.request.urlopen(req2, timeout=30)
                            success = True
                            _log_event("recovery_silent_refresh_success", email=email,
                                       family=family, model=req_model)
                            with _cache_lock:
                                _consecutive_failures[cooldown_key] = 0
                            if idx != active_idx:
                                data["activeIndex"] = idx
                                data["activeIndexByFamily"] = {"claude": idx, "gemini": idx}
                                save_accounts_data(data)
                            break
                        except urllib.error.HTTPError as he2:
                            last_err = f"Upstream HTTP {he2.code} on {email} (after refresh): {he2.read().decode('utf-8', errors='ignore')}"
                            _log_event("recovery_silent_refresh_failed", email=email,
                                       family=family, model=req_model,
                                       status=he2.code)
                            if he2.code == 401:
                                # Refresh token itself is dead — automatic browser re-auth
                                print(f"[Proxy] Refresh token for {email} rejected — attempting automatic browser re-login (a browser tab will open; complete Google sign-in)...")
                                if _try_auto_relogin(email):
                                    try:
                                        token3, project3 = get_auth_credentials(account, force_refresh=True)
                                        headers3 = dict(headers)
                                        headers3["Authorization"] = f"Bearer {token3}"
                                        resp = urllib.request.urlopen(urllib.request.Request(url, data=wrapped_body, headers=headers3), timeout=30)
                                        success = True
                                        _log_event("recovery_browser_relogin_success", email=email,
                                                   family=family, model=req_model)
                                        with _cache_lock:
                                            _consecutive_failures[cooldown_key] = 0
                                        break
                                    except Exception as e3:
                                        last_err = f"Re-login replay failed on {email}: {str(e3)}"
                                        _log_event("recovery_browser_relogin_replay_failed",
                                                   email=email, family=family, detail=str(e3)[:200])
                        except Exception as e2:
                            last_err = f"Refresh+replay error on {email}: {str(e2)}"
                            _log_event("recovery_silent_refresh_error", email=email,
                                       family=family, detail=str(e2)[:200])
                    continue

                # Rate limited (429) or forbidden (403) — cooldown this family on this account
                if status_code in (429, 403):
                    with _cache_lock:
                        # Increment consecutive failures
                        failures = _consecutive_failures.get(cooldown_key, 0) + 1
                        _consecutive_failures[cooldown_key] = failures
                        
                        # Apply exponential backoff cooldown
                        if failures == 1:
                            cooldown_duration = 60      # 1 minute
                        elif failures == 2:
                            cooldown_duration = 300     # 5 minutes
                        elif failures == 3:
                            cooldown_duration = 1800    # 30 minutes
                        else:
                            cooldown_duration = 7200    # 2 hours
                            
                        _cooldown_cache[cooldown_key] = time.time() + cooldown_duration
                        
                        # Clear cached credentials to force fresh reload next time on error
                        if email in _token_cache: del _token_cache[email]
                        if email in _project_cache: del _project_cache[email]
                    _log_event("cooldown_applied", email=email, family=family,
                               status=status_code, consecutive_failures=failures,
                               cooldown_seconds=cooldown_duration)
                    print(f"[Proxy] Account {email} got HTTP {status_code} on {family} (consecutive failures: {failures}), {cooldown_duration}s cooldown applied.")
                continue
            except Exception as e:
                last_err = f"Request error on {email}: {str(e)}"
                continue
                
        if not success:
            # Summarize which accounts were tried and why each failed
            tried = []
            for offset in range(len(accounts)):
                idx2 = (active_idx + offset) % len(accounts)
                acc2 = accounts[idx2]
                em2 = acc2.get("email", "?")
                key2 = f"{em2}:{family}"
                with _cache_lock:
                    cd = _cooldown_cache.get(key2, 0)
                state = "cooldown" if time.time() < cd else ("disabled" if not acc2.get("enabled", True) else "tried")
                tried.append(f"{em2}:{state}")
            _log_event("request_failed_all_accounts", model=req_model, family=family,
                       accounts=tried, detail=str(last_err)[:300])
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            hint = ""
            if last_err and "401" in str(last_err) and "invalid authentication" in str(last_err).lower():
                hint = " | FIX: run `antigravity-relogin` in terminal or `/antigravity-login` inside Hermes to refresh OAuth."
            self.wfile.write(json.dumps({"error": f"All accounts failed. Last error: {last_err}{hint}"}).encode("utf-8"))
            return

        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            # Force BaseHTTPRequestHandler to close the socket after this
            # response. Without this, keep-alive leaves the client waiting
            # for EOF that never comes and every streaming call hangs.
            self.close_connection = True
            self.end_headers()
            
            try:
                for line_bytes in resp:
                    line = line_bytes.decode('utf-8').strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        try:
                            data_str = line[5:].strip()
                            if not data_str:
                                continue
                            gemini_data = json.loads(data_str)
                            response_obj = gemini_data.get("response", {})
                            candidates = response_obj.get("candidates", [])
                            text = ""
                            tool_calls = []
                            finish_reason = None
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                text, reasoning, tool_calls, finish_reason = _parts_to_openai_deltas(parts)

                            # Emit tool_calls as their own delta chunk
                            if tool_calls:
                                tc_chunk = {
                                    "choices": [{
                                        "delta": {"tool_calls": [
                                            {**tc, "index": i} for i, tc in enumerate(tool_calls)
                                        ]},
                                        "index": 0,
                                        "finish_reason": None,
                                    }]
                                }
                                self.wfile.write(f"data: {json.dumps(tc_chunk)}\n\n".encode("utf-8"))

                            # Emit reasoning as a separate streaming chunk so
                            # Hermes renders it as a collapsible reasoning block
                            if reasoning:
                                rc_chunk = {
                                    "choices": [{
                                        "delta": {"reasoning_content": reasoning, "reasoning": reasoning},
                                        "index": 0,
                                        "finish_reason": None,
                                    }]
                                }
                                self.wfile.write(f"data: {json.dumps(rc_chunk)}\n\n".encode("utf-8"))

                            if text or finish_reason:
                                # Translate to OpenAI chunk
                                delta = {"content": text} if text else {}
                                if not text and tool_calls and finish_reason:
                                    pass  # tool_calls already emitted above
                                chunk_json = {
                                    "choices": [
                                        {
                                            "delta": delta,
                                            "index": 0,
                                            "finish_reason": finish_reason
                                        }
                                    ]
                                }
                                self.wfile.write(f"data: {json.dumps(chunk_json)}\n\n".encode("utf-8"))
                                self.wfile.flush()
                        except Exception as parse_err:
                            pass
            except Exception as stream_err:
                pass
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
            
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            res_data = json.loads(resp.read().decode("utf-8"))
            response_obj = res_data.get("response", {})
            candidates = response_obj.get("candidates", [])
            text = ""
            tool_calls = []
            finish_reason = "stop"
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                text, reasoning, tool_calls, finish_reason = _parts_to_openai_deltas(parts)

            message = {"role": "assistant", "content": text or None}
            if reasoning:
                message["reasoning_content"] = reasoning
                message["reasoning"] = reasoning
            if tool_calls:
                message["tool_calls"] = tool_calls

            openai_resp = {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": 1782210769,
                "model": req_model,
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "tool_calls" if tool_calls else "stop"
                    }
                ]
            }
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(openai_resp).encode("utf-8"))

# ── Background Server Thread ──────────────────────────────────
def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def start_background_proxy():
    if is_port_in_use(PROXY_PORT):
        return
        
    def run():
        try:
            # Threaded so one slow upstream call can't block others (prior wedge)
            class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
                daemon_threads = True
                allow_reuse_address = True
            server = ThreadedHTTPServer(('127.0.0.1', PROXY_PORT), AntigravityProxyHandler)
            server.serve_forever()
        except Exception:
            pass
            
    t = threading.Thread(target=run, daemon=True)
    t.start()

# Launch proxy immediately
start_background_proxy()

# ── Interactive CLI & OAuth Manager ─────────────────────────
auth_code = None
server_instance = None

class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        global auth_code
        parsed_url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_url.query)
        
        if "code" in query:
            auth_code = query["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"""
            <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h2 style="color: #2e7d32;">Authentication Successful!</h2>
                    <p>You can close this tab and return to the terminal.</p>
                </body>
            </html>
            """)
            threading.Thread(target=lambda: server_instance.shutdown()).start()
        else:
            self.send_response(400)
            self.end_headers()

def start_local_server():
    global server_instance
    handler = OAuthCallbackHandler
    socketserver.TCPServer.allow_reuse_address = True
    # Mitigate stale 51121: kill any previous listener before binding
    try:
        import subprocess
        subprocess.run(["lsof", "-tiTCP:51121"], capture_output=True, timeout=2)
        # If port is busy, try to free it — allow_reuse_address handles TIME_WAIT,
        # but a stuck python LISTEN needs explicit kill (handled by antigravity-relogin).
    except Exception:
        pass
    server_instance = socketserver.TCPServer(("127.0.0.1", 51121), handler)
    # Auto-shutdown after 120s so a hanging browser doesn't leave LISTEN forever
    def _timeout_shutdown():
        time.sleep(120)
        try:
            if server_instance:
                server_instance.shutdown()
        except Exception:
            pass
    threading.Thread(target=_timeout_shutdown, daemon=True).start()
    server_instance.serve_forever()

def perform_oauth_flow():
    global auth_code
    auth_code = None
    
    t = threading.Thread(target=start_local_server)
    t.start()
    
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent"
    }
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    
    # Hermes Mobile: on a phone Debian has no browser, so print the link and hand it to Android (Termux:API) as well.
    print("\nOpen this link in a browser to log in with Google:\n" + auth_url + "\n")
    opened = False
    try:
        opened = webbrowser.open(auth_url)
    except Exception:
        pass
    if not opened:
        try:
            subprocess.run(["termux-open-url", auth_url], capture_output=True, timeout=10)
        except Exception:
            pass
    print("Waiting for callback on port 51121 (timeout 115s)...")
    t.join(timeout=115)
    
    return auth_code

def exchange_code_for_tokens(code):
    url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code"
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_user_email(access_token):
    url = "https://www.googleapis.com/oauth2/v2/userinfo"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data.get("email")

def run_login_silent():
    code = perform_oauth_flow()
    if not code:
        return "Login failed: OAuth timeout or cancelled."
        
    try:
        tokens = exchange_code_for_tokens(code)
        access_token = tokens["access_token"]
        refresh_token = tokens["refresh_token"]
        email = fetch_user_email(access_token)
        
        if not email:
            return "Login failed: could not fetch user email."
            
        data = load_accounts_data()
        accounts = data.get("accounts", [])
        
        existing_idx = next((i for i, a in enumerate(accounts) if a.get("email") == email), None)
        import time
        now_ms = int(time.time() * 1000)
        
        account_entry = {
            "email": email,
            "refreshToken": refresh_token,
            "addedAt": now_ms,
            "lastUsed": now_ms,
            "enabled": True
        }
        
        if existing_idx is not None:
            accounts[existing_idx] = account_entry
            msg = f"Account {email} updated successfully!"
        else:
            accounts.append(account_entry)
            msg = f"Account {email} added successfully!"
            
        new_idx = existing_idx if existing_idx is not None else len(accounts) - 1
        data["activeIndex"] = new_idx
        data["activeIndexByFamily"] = {"claude": new_idx, "gemini": new_idx}
        data["accounts"] = accounts
        save_accounts_data(data)
        
        with _cache_lock:
            _token_cache[email] = access_token
            _project_cache[email] = load_project_id(access_token)
            
        return f"✓ {msg} It is now set as the active account for Hermes Agent."
    except Exception as e:
        return f"✗ Login error: {str(e)}"

def run_login():
    code = perform_oauth_flow()
    if not code:
        print("Login failed.")
        return
        
    try:
        tokens = exchange_code_for_tokens(code)
        access_token = tokens["access_token"]
        refresh_token = tokens["refresh_token"]
        email = fetch_user_email(access_token)
        
        if not email:
            print("Failed to fetch user email.")
            return
            
        data = load_accounts_data()
        accounts = data.get("accounts", [])
        
        existing_idx = next((i for i, a in enumerate(accounts) if a.get("email") == email), None)
        import time
        now_ms = int(time.time() * 1000)
        
        account_entry = {
            "email": email,
            "refreshToken": refresh_token,
            "addedAt": now_ms,
            "lastUsed": now_ms,
            "enabled": True
        }
        
        if existing_idx is not None:
            accounts[existing_idx] = account_entry
            print(f"\nAccount {email} updated successfully!")
        else:
            accounts.append(account_entry)
            print(f"\nAccount {email} added successfully!")
            
        data["accounts"] = accounts
        save_accounts_data(data)
    except Exception as e:
        print(f"\nError during login: {str(e)}")

def run_list_and_select():
    data = load_accounts_data()
    accounts = data.get("accounts", [])
    if not accounts:
        print("\nNo accounts configured.")
        return
        
    active_idx = data.get("activeIndex", 0)
    
    print("\nConfigured Accounts:")
    for idx, acc in enumerate(accounts):
        marker = "-> " if idx == active_idx else "   "
        status = "enabled" if acc.get("enabled", True) else "disabled"
        print(f"{marker}{idx + 1}. {acc.get('email')} ({status})")
        
    choice = input("\nEnter account index to select active, or press Enter to cancel: ").strip()
    if not choice:
        return
        
    try:
        idx = int(choice) - 1
        if idx >= 0 and idx < len(accounts):
            data["activeIndex"] = idx
            data["activeIndexByFamily"] = {"claude": idx, "gemini": idx}
            save_accounts_data(data)
            print(f"Selected active account: {accounts[idx].get('email')}")
        else:
            print("Invalid index.")
    except ValueError:
        print("Invalid input.")

def run_remove():
    data = load_accounts_data()
    accounts = data.get("accounts", [])
    if not accounts:
        print("\nNo accounts configured.")
        return
        
    print("\nAccounts:")
    for idx, acc in enumerate(accounts):
        print(f"  {idx + 1}. {acc.get('email')}")
        
    choice = input("\nEnter account index to remove, or press Enter to cancel: ").strip()
    if not choice:
        return
        
    try:
        idx = int(choice) - 1
        if idx >= 0 and idx < len(accounts):
            removed = accounts.pop(idx)
            active_idx = data.get("activeIndex", 0)
            if active_idx >= len(accounts):
                active_idx = max(0, len(accounts) - 1)
            data["activeIndex"] = active_idx
            data["activeIndexByFamily"] = {"claude": active_idx, "gemini": active_idx}
            data["accounts"] = accounts
            save_accounts_data(data)
            print(f"Removed account: {removed.get('email')}")
        else:
            print("Invalid index.")
    except ValueError:
        print("Invalid input.")

def get_quota_summary_string(email, access_token, project_id):
    url = f"{ENDPOINT}/v1internal:retrieveUserQuotaSummary"
    body = json.dumps({"project": project_id}).encode("utf-8")
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "User-Agent": "antigravity/windows/amd64",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
    }
    
    lines = []
    try:
        req = urllib.request.Request(url, data=body, headers=headers)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
            def format_duration(target_str):
                if not target_str: return "N/A"
                try:
                    from datetime import datetime, timezone
                    target = datetime.fromisoformat(target_str.replace("Z", "+00:00"))
                    now = datetime.now(timezone.utc)
                    delta = target - now
                    if delta.total_seconds() <= 0: return "now"
                    hours = int(delta.total_seconds() // 3600)
                    minutes = int((delta.total_seconds() % 3600) // 60)
                    if hours >= 24:
                        return f"{hours // 24}d {hours % 24}h"
                    if hours > 0:
                        return f"{hours}h {minutes}m"
                    return f"{minutes}m"
                except Exception:
                    return target_str
            
            for group in data.get("groups", []):
                lines.append(f"\n  [{group.get('displayName')}]")
                buckets = group.get("buckets", [])
                for bucket in buckets:
                    if bucket.get("disabled"):
                        lines.append(f"  - {bucket.get('displayName')}: N/A (does not apply)")
                    else:
                        pct = int(bucket.get("remainingFraction", 0) * 100)
                        reset_in = format_duration(bucket.get("resetTime"))
                        lines.append(f"  - {bucket.get('displayName')}: {pct}% (resets: {reset_in})")
    except Exception as e:
        lines.append(f"  Failed to fetch quota: {str(e)}")
    return "\n".join(lines)

def run_quota_silent():
    data = load_accounts_data()
    accounts = data.get("accounts", [])
    if not accounts:
        return "No accounts configured."
        
    outputs = []
    for acc in accounts:
        email = acc.get("email")
        disabled_str = " (disabled)" if not acc.get("enabled", True) else ""
        outputs.append(f"Account: {email}{disabled_str}")
        try:
            token = refresh_token(acc["refreshToken"])
            project_id = load_project_id(token)
            summary = get_quota_summary_string(email, token, project_id)
            outputs.append(summary)
        except Exception as e:
            outputs.append(f"  Error: {str(e)}")
        outputs.append("-" * 35)
    return "\n".join(outputs)

def fetch_and_print_quota_summary(email, access_token, project_id):
    url = f"{ENDPOINT}/v1internal:retrieveUserQuotaSummary"
    body = json.dumps({"project": project_id}).encode("utf-8")
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "User-Agent": "antigravity/windows/amd64",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
    }
    
    try:
        req = urllib.request.Request(url, data=body, headers=headers)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
            def format_duration(target_str):
                if not target_str: return "N/A"
                try:
                    from datetime import datetime, timezone
                    target = datetime.fromisoformat(target_str.replace("Z", "+00:00"))
                    now = datetime.now(timezone.utc)
                    delta = target - now
                    if delta.total_seconds() <= 0: return "now"
                    hours = int(delta.total_seconds() // 3600)
                    minutes = int((delta.total_seconds() % 3600) // 60)
                    if hours >= 24:
                        return f"{hours // 24}d {hours % 24}h"
                    if hours > 0:
                        return f"{hours}h {minutes}m"
                    return f"{minutes}m"
                except Exception:
                    return target_str
            
            for group in data.get("groups", []):
                print(f"\n  ┌─ {group.get('displayName')}")
                buckets = group.get("buckets", [])
                for b_idx, bucket in enumerate(buckets):
                    connector = "└─" if b_idx == len(buckets) - 1 else "├─"
                    if bucket.get("disabled"):
                        print(f"  │  {connector} {bucket.get('displayName').ljust(20)} N/A (does not apply)")
                    else:
                        pct = int(bucket.get("remainingFraction", 0) * 100)
                        reset_in = format_duration(bucket.get("resetTime"))
                        print(f"  │  {connector} {bucket.get('displayName').ljust(20)} {pct}% (resets: {reset_in})")
    except Exception as e:
        print(f"  ❌ Failed to fetch quota: {str(e)}")

def run_quota():
    data = load_accounts_data()
    accounts = data.get("accounts", [])
    if not accounts:
        print("\nNo accounts configured.")
        return
        
    print("\n📊 Checking quotas for all accounts...")
    for idx, acc in enumerate(accounts):
        email = acc.get("email")
        disabled_str = " (disabled)" if not acc.get("enabled", True) else ""
        print(f"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(f"  {email}{disabled_str}")
        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        
        try:
            token = refresh_token(acc["refreshToken"])
            project_id = load_project_id(token)
            fetch_and_print_quota_summary(email, token, project_id)
        except Exception as e:
            print(f"  ❌ Error: {str(e)}")
    print("")

def run_interactive_menu():
    while True:
        print("\n" + "="*45)
        print("     Google Antigravity Accounts Manager")
        print("="*45)
        print("  1. List accounts / Select active account")
        print("  2. Log in a new account (OAuth)")
        print("  3. Check quotas for all accounts")
        print("  4. Remove an account")
        print("  5. Exit")
        print("="*45)
        
        choice = input("\nChoose option: ").strip()
        if choice == "1":
            run_list_and_select()
        elif choice == "2":
            run_login()
        elif choice == "3":
            run_quota()
        elif choice == "4":
            run_remove()
        elif choice == "5":
            break
        else:
            print("Invalid option.")

def handle_cli(args):
    cmd = getattr(args, "antigravity_command", None)
    if cmd == "login":
        run_login()
    elif cmd == "list":
        run_list_and_select()
    elif cmd == "remove":
        run_remove()
    elif cmd == "quota":
        run_quota()
    else:
        run_interactive_menu()

def setup_argparse(subparser):
    subs = subparser.add_subparsers(dest="antigravity_command")
    subs.add_parser("login", help="Log in a new Google Antigravity account")
    subs.add_parser("list", help="List and select active account")
    subs.add_parser("remove", help="Remove a configured account")
    subs.add_parser("quota", help="Check live quotas for all accounts")

def handle_slash_command(raw_args: str) -> str:
    import subprocess
    print("\nLaunching Google Antigravity Accounts Manager in a new terminal window...")
    try:
        # Spawn a new powershell window running 'hermes antigravity'
        subprocess.Popen('start powershell -Command "hermes antigravity"', shell=True)
        return "✓ Google Antigravity Accounts Manager opened in a new terminal window. Manage your accounts there, then return here."
    except Exception as e:
        return f"✗ Failed to open terminal window: {str(e)}\nPlease run 'hermes antigravity' manually in a new terminal."

def _mock_pre_llm_call(*args, **kwargs):
    return None

def handle_login_slash(raw_args: str) -> str:
    return run_login_silent()

def handle_quota_slash(raw_args: str) -> str:
    return run_quota_silent()

def register(ctx):
    # Register the CLI subcommand tree
    ctx.register_cli_command(
        name="antigravity",
        help="Manage Google Antigravity accounts and quotas",
        setup_fn=setup_argparse,
        handler_fn=handle_cli
    )
    # Register the in-session slash command /antigravity (spawns external terminal)
    ctx.register_command(
        "antigravity",
        handler=handle_slash_command,
        description="Open the Google Antigravity accounts manager in a new external terminal window"
    )
    # Register the in-session slash command /antigravity-login (direct login)
    ctx.register_command(
        "antigravity-login",
        handler=handle_login_slash,
        description="Directly log in a new Google Antigravity account (Works in Desktop GUI & CLI)"
    )
    # Register the in-session slash command /antigravity-usage (quota/usage)
    ctx.register_command(
        "antigravity-usage",
        handler=handle_quota_slash,
        description="Display Antigravity quota/usage (Works in Desktop GUI & CLI)"
    )
    # Register the hook declared in plugin.yaml to pass validation
    ctx.register_hook("pre_llm_call", _mock_pre_llm_call)
