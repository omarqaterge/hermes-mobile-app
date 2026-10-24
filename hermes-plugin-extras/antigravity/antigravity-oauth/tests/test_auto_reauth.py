#!/usr/bin/env python3
"""Regression tests for automatic Antigravity OAuth recovery."""

import importlib.util
import io
import json
import pathlib
import sys
import time
import unittest
import urllib.error
from unittest import mock

PLUGIN_PATH = pathlib.Path.home() / ".hermes/plugins/antigravity-oauth/__init__.py"


def load_plugin():
    name = f"antigravity_oauth_test_{time.time_ns()}"
    spec = importlib.util.spec_from_file_location(name, PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class AutoReauthTests(unittest.TestCase):
    def setUp(self):
        self.plugin = load_plugin()
        self.account = {"email": "test@example.invalid", "refreshToken": "fake-refresh", "enabled": True}
        with self.plugin._cache_lock:
            self.plugin._token_cache.clear()
            self.plugin._project_cache.clear()
            if hasattr(self.plugin, "_token_expiry_cache"):
                self.plugin._token_expiry_cache.clear()

    def test_force_refresh_ignores_cached_access_token(self):
        """A 401 recovery must not reuse the cached token that caused the 401."""
        with self.plugin._cache_lock:
            self.plugin._token_cache[self.account["email"]] = "expired-access"
            self.plugin._project_cache[self.account["email"]] = "old-project"

        with mock.patch.object(
            self.plugin, "refresh_token_with_expiry", return_value=("fresh-access", 3600)
        ) as refresh, mock.patch.object(
            self.plugin, "load_project_id", return_value="fresh-project"
        ):
            token, project = self.plugin.get_auth_credentials(self.account, force_refresh=True)

        self.assertEqual(token, "fresh-access")
        self.assertEqual(project, "fresh-project")
        refresh.assert_called_once_with("fake-refresh")

    def test_proactive_refresh_near_expiry(self):
        """A token within 2 minutes of expiry must be refreshed silently."""
        import time as _time
        with self.plugin._cache_lock:
            self.plugin._token_cache[self.account["email"]] = "dying-token"
            self.plugin._project_cache[self.account["email"]] = "proj"
            self.plugin._token_expiry_cache[self.account["email"]] = _time.time() + 30

        with mock.patch.object(
            self.plugin, "refresh_token_with_expiry", return_value=("new-access", 3600)
        ) as refresh, mock.patch.object(
            self.plugin, "load_project_id", return_value="proj"
        ):
            token, _ = self.plugin.get_auth_credentials(self.account)

        self.assertEqual(token, "new-access")
        refresh.assert_called_once()

    def test_fresh_cached_token_not_refreshed(self):
        """A healthy cached token must not trigger a network refresh."""
        with self.plugin._cache_lock:
            self.plugin._token_cache[self.account["email"]] = "good-token"
            self.plugin._project_cache[self.account["email"]] = "proj"
            self.plugin._token_expiry_cache[self.account["email"]] = time.time() + 3000

        with mock.patch.object(
            self.plugin, "refresh_token_with_expiry"
        ) as refresh:
            token, project = self.plugin.get_auth_credentials(self.account)

        self.assertEqual(token, "good-token")
        self.assertEqual(project, "proj")
        refresh.assert_not_called()


class FakeHTTPError(urllib.error.HTTPError):
    def __init__(self, code, body=b"{}"):
        super().__init__("http://fake", code, "err", {}, io.BytesIO(body))

    def read(self, *a):
        try:
            return self.fp.read()
        except Exception:
            return b"{}"


class _FakeResp(io.BytesIO):
    """Context-manager response (supports both read() and iteration for SSE)."""
    def __enter__(self):
        return self
    def __exit__(self, *a):
        self.close()
        return False


class Handler401RecoveryTests(unittest.TestCase):
    """Drive do_POST against a fake upstream to prove 401 auto-recovery."""

    def setUp(self):
        self.plugin = load_plugin()
        self.plugin._THOUGHT_SIG_POOL.clear()
        # Single test account, no rotation ambiguity
        fake_accounts = {"version": 4, "accounts": [
            {"email": "t@example.invalid", "refreshToken": "rt", "enabled": True}],
            "activeIndex": 0}
        patcher = mock.patch.object(self.plugin, "load_accounts_data", return_value=fake_accounts)
        patcher.start()
        self.addCleanup(patcher.stop)
        with self.plugin._cache_lock:
            for c in (self.plugin._token_cache, self.plugin._project_cache,
                      self.plugin._token_expiry_cache, self.plugin._cooldown_cache,
                      self.plugin._consecutive_failures):
                c.clear()
        self.plugin._last_auto_relogin["ts"] = 0.0

        # Minimal request the handler can translate
        self.req_body = json.dumps({
            "model": "gemini-3.7-flash", "stream": False,
            "messages": [{"role": "user", "content": "hi"}]}).encode()

        class FakeSrv:
            def __init__(self, handler_self):
                self.hs = handler_self
        self.handler = mock.Mock(spec=self.plugin.AntigravityProxyHandler)
        self.handler.rfile = io.BytesIO(b"POST /v1/chat/completions HTTP/1.1\r\n\r\n")
        # Simulate Content-Length header read
        self.handler.headers = {"Content-Length": str(len(self.req_body))}
        self.wfile = io.BytesIO()

    def _run_handler(self, upstream_side_effects):
        h = self.plugin.AntigravityProxyHandler.__new__(self.plugin.AntigravityProxyHandler)
        h.rfile = io.BytesIO(self.req_body)  # handler reads body from here
        h.wfile = self.wfile
        h.path = "/v1/chat/completions"
        h.requestline = "POST /v1/chat/completions HTTP/1.1"
        h.command = "POST"
        h.request_version = "HTTP/1.1"
        h.headers = {"Content-Length": str(len(self.req_body))}
        h.client_address = ("127.0.0.1", 1)

        calls = {"n": 0}
        def fake_urlopen(req, timeout=30):
            i = calls["n"]; calls["n"] += 1
            effect = upstream_side_effects[min(i, len(upstream_side_effects) - 1)]
            if isinstance(effect, Exception):
                raise effect
            return _FakeResp(effect)

        with mock.patch.object(self.plugin.urllib.request, "urlopen", side_effect=fake_urlopen), \
             mock.patch.object(self.plugin, "get_auth_credentials",
                               side_effect=[("tok1", "p1"), ("tok2", "p2"), ("tok3", "p3")]), \
             mock.patch.object(self.plugin, "_try_auto_relogin", return_value=True) as relogin:
            h.do_POST()
        return calls["n"], relogin

    def test_401_then_silent_refresh_succeeds_no_browser(self):
        """First call 401 -> silent refresh -> replay succeeds; no browser login."""
        ok_body = json.dumps({"response": {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}}).encode()
        n_calls, relogin = self._run_handler([FakeHTTPError(401), ok_body])
        self.assertEqual(n_calls, 2)          # original + replay only
        relogin.assert_not_called()           # browser NOT needed
        out = self.wfile.getvalue()
        self.assertIn(b'"object": "chat.completion"', out)  # success relayed

    def test_401_dead_refresh_token_triggers_auto_relogin(self):
        """Both token and refresh rejected -> automatic browser re-login -> replay."""
        ok_body = json.dumps({"response": {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}}).encode()
        n_calls, relogin = self._run_handler(
            [FakeHTTPError(401), FakeHTTPError(401), ok_body])
        relogin.assert_called_once()
        self.assertGreaterEqual(n_calls, 3)   # original + replay + post-login replay
        self.assertIn(b'"object": "chat.completion"', self.wfile.getvalue())

    def test_429_still_applies_cooldown(self):
        """429 must still cooldown the account (unchanged behavior)."""
        n_calls, relogin = self._run_handler([FakeHTTPError(429)])
        relogin.assert_not_called()
        key = "t@example.invalid:gemini"
        with self.plugin._cache_lock:
            until = self.plugin._cooldown_cache.get(key, 0)
        self.assertGreater(until, time.time())          # cooldown applied
        self.assertIn(b"All accounts failed", self.wfile.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
