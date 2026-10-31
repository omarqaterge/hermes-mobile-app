"""Seeds the throwaway HERMES_HOME of tools/hermes-contract like a set-up phone: a config.yaml naming a model, and one
saved chat (a question and its answer) written through Hermes's own SessionDB, so session.list / session.resume have a
stored chat to answer about. The model is the fake OpenAI-compatible server of fake-model.py (HM_FAKE_MODEL_URL, set by start-hermes.sh) with a
placeholder key: no real model is called and no real key exists. The app's plugin is enabled, as `hermes plugins enable
hermes-mobile` does (the plugin folder itself is copied in by start-hermes.sh).
Run from the Hermes source tree with its venv and HERMES_HOME set (start-hermes.sh does).
"""
import os
import sys
import time

sys.path.insert(0, os.getcwd())
from hermes_state import SessionDB  # noqa: E402

SESSION = "contract-chat"
# Settings the app reads from GET /api/config (agent.reasoning_effort, plugins.enabled) are set, as on a phone.
MODEL_URL = os.environ.get("HM_FAKE_MODEL_URL", "http://127.0.0.1:9/v1")
with open(os.path.join(os.environ["HERMES_HOME"], "config.yaml"), "w") as f:
    f.write(f"model:\n  default: contract-model\n  provider: custom\n  base_url: {MODEL_URL}\n"
            "  api_key: placeholder-not-a-key\nagent:\n  reasoning_effort: high\nplugins:\n  enabled:\n  - hermes-mobile\n"
            "auxiliary:\n  title_generation:\n    enabled: false\n")
# The built-in memory the app's Memory screen lists (MEMORY.md / USER.md: entries joined by a "§" line).
mem = os.path.join(os.environ["HERMES_HOME"], "memories")
os.makedirs(mem, exist_ok=True)
with open(os.path.join(mem, "MEMORY.md"), "w") as f:
    f.write("The contract check lives in tools/hermes-contract.\n§\nIt runs in CI.")
with open(os.path.join(mem, "USER.md"), "w") as f:
    f.write("The user likes short answers.")
db = SessionDB()
db.create_session(SESSION, "mobile")
t = time.time() - 120
db.append_message(SESSION, "user", "contract question", timestamp=t)
db.append_message(SESSION, "assistant", "contract answer", timestamp=t + 60, finish_reason="stop")
db.set_session_title(SESSION, "Contract chat")
db.close()
print(f"seeded {SESSION}")
