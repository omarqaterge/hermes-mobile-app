#!/usr/bin/env python3
"""Write tools/web-e2e/fixtures/hermes-providers.json from a REAL Hermes source tree.

The app's provider list (web/src/providers.ts) reads two dashboard routes: GET /api/env (category
"provider" rows) and GET /api/providers/oauth. The web-e2e mock and the unit tests answer with this
fixture, so it must be what the pinned Hermes really returns. Regenerate after moving the pin:

  pin=$(cat web/vendor/hermes-shared/.hermes-commit); src=$(mktemp -d); home=$(mktemp -d)
  git -C ~/.hermes/hermes-agent archive $pin | tar -x -C $src
  (cd $src && HERMES_HOME=$home ~/.hermes/hermes-agent/venv/bin/python3 $OLDPWD/tools/hermes-provider-fixture.py $OLDPWD $pin)

HERMES_HOME must be an empty folder: nothing is set and no account is signed in. Account statuses can
still pick up sign-ins from the machine it runs on (other CLIs' credential files), so they are reset
to "signed out" and any path or token preview is dropped.
"""
import asyncio
import json
import os
import sys

repo, pin = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.getcwd())
from hermes_cli.web_routers import config_env, oauth  # noqa: E402

env = config_env._get_env_vars_sync(None)
env = {k: v for k, v in env.items() if v.get("category") == "provider"}
assert not any(v["is_set"] for v in env.values()), "HERMES_HOME is not empty"

providers = asyncio.run(oauth.list_oauth_providers(None))["providers"]
for p in providers:
    st = p.get("status") or {}
    for k in list(st):
        if k == "logged_in":
            st[k] = False
        elif k in ("token_preview", "expires_at", "last_refresh", "source_label"):
            st[k] = None
    p["status"] = st

out = {
    "_comment": f"Real answers of the pinned Hermes {pin} (GET /api/env provider rows, GET /api/providers/oauth), "
                "empty HERMES_HOME. Made by tools/hermes-provider-fixture.py: do not edit by hand.",
    "env": env,
    "oauth": {"providers": providers},
}
path = os.path.join(repo, "tools/web-e2e/fixtures/hermes-providers.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(out, f, indent=1, sort_keys=True)
    f.write("\n")
print(f"{len(env)} env rows, {len(providers)} account providers -> {path}")
