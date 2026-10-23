#!/usr/bin/env python3
"""Tests for the in-app Claude sign-in (hermes-plugin/hermes-mobile/claude_login.py):
    python3 tools/test_claude_login.py                                   # Hermes faked (CI)
    ~/.hermes/hermes-agent/venv/bin/python3 tools/test_claude_login.py   # + the real Hermes save path

Part 1 fakes Hermes's helpers. Part 2 (only when Hermes is importable) uses Hermes's real auth_commands and
credential pool on a throwaway HERMES_HOME, with only the network exchange faked, and checks the login lands where
`hermes auth add anthropic` puts it.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
MOD = HERE.parent / "hermes-plugin" / "hermes-mobile" / "claude_login.py"
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def load():
    spec = importlib.util.spec_from_file_location("hm_claude_login_test", MOD)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


if os.environ.get("HM_CLAUDE_REAL") != "1":
    print("claude_login with Hermes faked")
    EXCHANGES, SAVED = [], []
    ac = types.ModuleType("agent.anthropic_credentials")
    ac._OAUTH_CLIENT_ID = "cid"
    ac._OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
    ac._OAUTH_SCOPES = "org:create_api_key user:profile user:inference"
    ac._generate_pkce = lambda: ("verifier-1", "challenge-1")

    def post(data, *, content_type, timeout, what):
        EXCHANGES.append(json.loads(data))
        if json.loads(data)["code"] == "refused":
            raise RuntimeError("HTTP 400 invalid_grant")
        return {"access_token": "sk-ant-oat-SECRET", "refresh_token": "rt-SECRET", "expires_in": 3600}

    ac._post_oauth_token = post
    ac._oauth_token_state = lambda r: {"access_token": r.get("access_token", ""), "refresh_token": r.get("refresh_token"), "expires_at_ms": 1}
    agent = types.ModuleType("agent")
    agent.anthropic_credentials = ac
    sys.modules["agent"] = agent
    sys.modules["agent.anthropic_credentials"] = ac

    class Spec:
        auth_type = "oauth"
        source = "manual:hermes_pkce"
        token = staticmethod(lambda c: c["access_token"])
        fields = staticmethod(lambda c, p: {"refresh_token": c.get("refresh_token"), "expires_at_ms": c.get("expires_at_ms"), "base_url": "https://api.anthropic.com"})

    class Pool:
        def entries(self):
            return list(SAVED)

        def add_entry(self, e):
            SAVED.append(e)
            return e

    class Cred(types.SimpleNamespace):
        pass

    cmd = types.ModuleType("hermes_cli.auth_commands")
    cmd._OAUTH_ADD_SPECS = {"anthropic": Spec()}
    cmd.load_pool = lambda p: Pool()
    UNSUPPRESSED = []
    cmd._unsuppress_provider_sources = UNSUPPRESSED.append
    cmd.label_from_token = lambda t, d: d
    cmd.PooledCredential = Cred
    import uuid

    cmd.uuid = uuid
    hc = types.ModuleType("hermes_cli")
    hc.auth_commands = cmd
    sys.modules["hermes_cli"] = hc
    sys.modules["hermes_cli.auth_commands"] = cmd

    m = load()
    s = m.start("default")
    q = parse_qs(urlparse(s["url"]).query)
    check("start: claude.ai authorize link", s["url"].startswith("https://claude.ai/oauth/authorize?"))
    check("start: same parameters as `hermes auth add anthropic`",
          q.get("code") == ["true"] and q.get("client_id") == ["cid"] and q.get("response_type") == ["code"]
          and q.get("redirect_uri") == [ac._OAUTH_REDIRECT_URI] and q.get("scope") == [ac._OAUTH_SCOPES]
          and q.get("code_challenge") == ["challenge-1"] and q.get("code_challenge_method") == ["S256"], str(q))
    check("start: no verifier in the answer", "verifier-1" not in json.dumps(s))
    state = q["state"][0]

    def err(fn):
        try:
            fn()
        except m.LoginError as e:
            return str(e)
        return ""

    check("finish: unknown session → expired", "expired" in err(lambda: m.finish("nope", f"c#{state}", "default")))
    check("finish: other profile refused", "another profile" in err(lambda: m.finish(s["session_id"], f"c#{state}", "work")))
    check("finish: empty code", "Paste" in err(lambda: m.finish(s["session_id"], "  ", "default")))
    check("finish: wrong state refused, nothing exchanged", "whole code" in err(lambda: m.finish(s["session_id"], "c#bad", "default")) and not EXCHANGES)
    check("finish: a code without # refused", "whole code" in err(lambda: m.finish(s["session_id"], "c", "default")))
    r = m.finish(s["session_id"], f" the-code\n#{state} ", "default")
    check("finish: ok + label, no token in the answer", r == {"ok": True, "label": "anthropic-oauth-1"} and "SECRET" not in json.dumps(r), str(r))
    ex = EXCHANGES[-1] if EXCHANGES else {}
    check("finish: exchange like Hermes (code, state, verifier, redirect)",
          ex.get("grant_type") == "authorization_code" and ex.get("code") == "the-code" and ex.get("state") == state
          and ex.get("code_verifier") == "verifier-1" and ex.get("redirect_uri") == ac._OAUTH_REDIRECT_URI, str(ex))
    e0 = SAVED[0] if SAVED else None
    check("save: pool entry like auth add (oauth, manual:hermes_pkce, refresh token)",
          e0 is not None and e0.provider == "anthropic" and e0.auth_type == "oauth" and e0.source == "manual:hermes_pkce"
          and e0.access_token == "sk-ant-oat-SECRET" and e0.refresh_token == "rt-SECRET" and e0.priority == 0)
    check("save: suppressed sources re-enabled", UNSUPPRESSED == ["anthropic"])
    check("finish: session is single-use", "expired" in err(lambda: m.finish(s["session_id"], f"c#{state}", "default")))
    s2 = m.start("default")
    st2 = parse_qs(urlparse(s2["url"]).query)["state"][0]
    refusal = err(lambda: m.finish(s2["session_id"], f"refused#{st2}", "default"))
    check("finish: Claude refusing the code → its reason, session gone",
          "didn’t accept" in refusal and "invalid_grant" in refusal
          and "expired" in err(lambda: m.finish(s2["session_id"], f"x#{st2}", "default")), refusal)
    check("finish: refusal message has no secrets", "SECRET" not in refusal and "verifier" not in refusal)
    for _ in range(12):
        m.start("default")
    check("sessions are bounded", len(m._sessions) <= m.MAX_SESSIONS, str(len(m._sessions)))
    s3 = m.start("default")
    m._sessions[s3["session_id"]]["at"] -= m.TTL + 1
    st3 = parse_qs(urlparse(s3["url"]).query)["state"][0]
    check("sessions expire after 10 min", "expired" in err(lambda: m.finish(s3["session_id"], f"c#{st3}", "default")))
    check("cancel forgets a session", m.cancel(m.start("default")["session_id"]) is True)

    # REST routes (plugin_api.py), when fastapi is there (Hermes's venv)
    try:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
    except Exception:
        print("  [SKIP] REST routes (no fastapi)")
    else:
        sys.modules["hm_claude_login"] = m
        spec = importlib.util.spec_from_file_location("hm_plugin_api_test", HERE.parent / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py")
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        app = FastAPI()
        app.include_router(api.router, prefix="/api/plugins/hermes-mobile")
        c = TestClient(app)
        r = c.post("/api/plugins/hermes-mobile/claude-login/start?profile=default", json={})
        st = r.json()
        check("REST start: 200 with session_id + url", r.status_code == 200 and st.get("session_id") and st.get("url", "").startswith("https://claude.ai/"), r.text[:200])
        r = c.post("/api/plugins/hermes-mobile/claude-login/finish?profile=default", json={"session_id": st.get("session_id"), "code": "x#bad"})
        check("REST finish: wrong code → 400 with the reason", r.status_code == 400 and "whole code" in r.json().get("detail", ""), r.text[:200])
        state = parse_qs(urlparse(st["url"]).query)["state"][0]
        before = len(SAVED)
        r = c.post("/api/plugins/hermes-mobile/claude-login/finish?profile=default", json={"session_id": st["session_id"], "code": f"ok#{state}"})
        check("REST finish: ok, saved, no token in the body", r.status_code == 200 and r.json().get("ok") is True and len(SAVED) == before + 1 and "SECRET" not in r.text, r.text[:200])
        sid = c.post("/api/plugins/hermes-mobile/claude-login/start", json={}).json()["session_id"]
        check("REST cancel", c.post("/api/plugins/hermes-mobile/claude-login/cancel", json={"session_id": sid}).json() == {"ok": True})

        def boom(profile=None):
            raise ImportError("no _generate_pkce")

        real_start, m.start = m.start, boom
        r = c.post("/api/plugins/hermes-mobile/claude-login/start", json={})
        check("REST start: Hermes without the helpers → 501 (the app offers Termux)", r.status_code == 501, r.text[:200])
        m.start = real_start

    # Part 2: the real Hermes, in a child process (its modules must not meet the fakes above).
    hermes = Path(os.environ.get("HERMES_AGENT_DIR", Path.home() / ".hermes" / "hermes-agent"))
    probe = subprocess.run([sys.executable, "-c", "import agent.anthropic_credentials, hermes_cli.auth_commands"],
                           cwd=hermes, capture_output=True, text=True) if hermes.is_dir() else None
    if probe is None or probe.returncode != 0:
        print("  [SKIP] real Hermes save path (Hermes not importable with this python)")
    else:
        home = tempfile.mkdtemp()
        env = {**os.environ, "HM_CLAUDE_REAL": "1", "HERMES_HOME": home, "PYTHONPATH": str(hermes)}
        r = subprocess.run([sys.executable, __file__], cwd=hermes, env=env, capture_output=True, text=True, timeout=120)
        print(r.stdout, end="")
        if r.returncode != 0:
            print(r.stderr[-2000:])
            fails += 1
    print("OK" if not fails else f"{fails} FAILED")
    sys.exit(1 if fails else 0)

else:
    # Child: real Hermes modules, throwaway HERMES_HOME, only the token endpoint faked.
    print("claude_login with the real Hermes (throwaway HERMES_HOME, no network)")
    from agent import anthropic_credentials as ac

    sent = []

    def fake_post(data, *, content_type, timeout, what, **kw):
        sent.append(json.loads(data))
        return {"access_token": "sk-ant-oat01-REALTEST-abcdef", "refresh_token": "sk-ant-ort01-REALTEST", "expires_in": 28800}

    ac._post_oauth_token = fake_post
    m = load()
    s = m.start(None)
    state = parse_qs(urlparse(s["url"]).query)["state"][0]
    r = m.finish(s["session_id"], f"abc#{state}", None)
    check("real: finish ok", r.get("ok") is True, str(r))
    store = json.loads((Path(os.environ["HERMES_HOME"]) / "auth.json").read_text())
    entries = (store.get("credential_pool") or {}).get("anthropic") or []
    e = entries[0] if entries else {}
    check("real: one anthropic entry in auth.json credential_pool", len(entries) == 1, json.dumps(store)[:300])
    check("real: same shape as `hermes auth add anthropic`",
          e.get("auth_type") == "oauth" and e.get("source") == "manual:hermes_pkce" and e.get("refresh_token") == "sk-ant-ort01-REALTEST"
          and e.get("access_token") == "sk-ant-oat01-REALTEST-abcdef" and e.get("expires_at_ms"), json.dumps(e)[:300])
    check("real: the label in the answer is the stored one", r.get("label") == e.get("label"), f"{r} vs {e.get('label')}")
    from agent.credential_pool import load_pool

    check("real: Hermes's own pool loads it", any(x.source == "manual:hermes_pkce" for x in load_pool("anthropic").entries()))
    sys.exit(1 if fails else 0)
