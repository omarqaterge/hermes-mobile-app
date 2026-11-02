#!/usr/bin/env python3
"""Write tools/web-e2e/fixtures/hermes-config-defaults.json: what GET /api/config/defaults of the pinned Hermes returns.

The Hermes settings page (web/src/hermes-settings.ts) shows each option's default and hides options Hermes lacks; the
web-e2e mock answers /api/config/defaults with this fixture, and tools/hermes-contract compares its shape with the real
route. It only reads hermes_cli/config_defaults.py (DEFAULT_CONFIG), without importing the rest of Hermes. Regenerate
after moving the pin:

  pin=$(cat web/vendor/hermes-shared/.hermes-commit)
  git -C ~/.hermes/hermes-agent show $pin:hermes_cli/config_defaults.py > /tmp/config_defaults.py
  python3 -I tools/hermes-config-fixture.py /tmp/config_defaults.py $pin
"""
import json
import os
import runpy
import sys

src, pin = sys.argv[1], sys.argv[2]
defaults = runpy.run_path(src)["DEFAULT_CONFIG"]
out = {"_comment": f"GET /api/config/defaults of the pinned Hermes {pin} (DEFAULT_CONFIG). Regenerate with tools/hermes-config-fixture.py."}
out.update(defaults)
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web-e2e", "fixtures", "hermes-config-defaults.json")
with open(dest, "w") as f:
    f.write(json.dumps(out, indent=1, default=str, ensure_ascii=False) + "\n")
print(f"wrote {dest}")
