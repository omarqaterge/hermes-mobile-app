import json
import urllib.request

import providers
from providers.base import ProviderProfile

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

class AntigravityProfile(ProviderProfile):
    def fetch_models(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 8.0,
        **kwargs
    ) -> list[str] | None:
        url = (base_url or self.base_url).rstrip("/") + "/models"
        request = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {api_key or 'mock'}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            models = [
                item["id"]
                for item in payload.get("data", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ]
            return list(dict.fromkeys(models)) or list(MODEL_MAPPING)
        except (OSError, ValueError, TypeError):
            return list(MODEL_MAPPING)

    def build_api_kwargs_extras(
        self,
        *,
        reasoning_config: dict | None = None,
        supports_reasoning: bool = False,  # noqa: ARG002 — deliberately ignored
        **context,
    ):
        """Bridge /reasoning to the local proxy without touching core.

        Core's supports_reasoning gate is host-allowlisted and doesn't cover
        the local Antigravity proxy (127.0.0.1:8999), so extra_body.reasoning
        would never be emitted for this provider. Like the meta-ai plugin,
        we bypass that gate and emit a top-level reasoning_effort that our
        own proxy understands. The proxy then maps it to Gemini's
        generationConfig.thinkingConfig.thinkingLevel (LOW/MEDIUM/HIGH) the
        same way agy --effort does.
        """
        if not isinstance(reasoning_config, dict):
            return {}, {}
        if reasoning_config.get("enabled") is False:
            return {}, {"reasoning_effort": "none"}
        effort = str(reasoning_config.get("effort") or "").strip().lower()
        if not effort:
            return {}, {}
        # Clamp Hermes' wider vocabulary (xhigh/max/ultra/none) to the
        # Gemini wire's low/medium/high — agy only exposes those three for
        # Antigravity, matching _build_gemini_thinking_config in core.
        if effort not in {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
            effort = "medium"
        # Normalize agy equivalents: minimal→low, xhigh/max/ultra→high handles
        # the clamping below; keep raw effort for proxy to do per-model mapping.
        return {}, {"reasoning_effort": effort}

antigravity = AntigravityProfile(
    name="antigravity",
    aliases=("agy",),
    display_name="Google Antigravity",
    description="Query Gemini and Claude models directly using your Google OAuth accounts pool",
    signup_url="https://github.com/mrhisyammm/opencode-antigravity-auth",
    env_vars=("ANTIGRAVITY_API_KEY", "ANTIGRAVITY_BASE_URL"),
    base_url="http://127.0.0.1:8999/v1",
    auth_type="api_key",
    default_aux_model="gemini-3.5-flash",
    fallback_models=tuple(MODEL_MAPPING.keys()),
)

providers.register_provider(antigravity)
