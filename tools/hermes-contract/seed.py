"""Seeds the throwaway HERMES_HOME of tools/hermes-contract like a set-up phone: a config.yaml naming a model, and one
saved chat (a question and its answer) written through Hermes's own SessionDB, so session.list / session.resume have a
stored chat to answer about. The model is a made-up OpenAI-compatible endpoint on 127.0.0.1:9 (nothing listens there)
with a placeholder key: the check never sends a prompt, so no model is called and no real key exists.
Run from the Hermes source tree with its venv and HERMES_HOME set (start-hermes.sh does).
"""
import os
import sys
import time

sys.path.insert(0, os.getcwd())
from hermes_state import SessionDB  # noqa: E402

SESSION = "contract-chat"
# Settings the app reads from GET /api/config (agent.reasoning_effort, plugins.enabled) are set, as on a phone.
with open(os.path.join(os.environ["HERMES_HOME"], "config.yaml"), "w") as f:
    f.write("model:\n  default: contract-model\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n"
            "  api_key: placeholder-not-a-key\nagent:\n  reasoning_effort: high\nplugins:\n  enabled: []\n"
            "auxiliary:\n  title_generation:\n    enabled: false\n")
db = SessionDB()
db.create_session(SESSION, "mobile")
t = time.time() - 120
db.append_message(SESSION, "user", "contract question", timestamp=t)
db.append_message(SESSION, "assistant", "contract answer", timestamp=t + 60, finish_reason="stop")
db.set_session_title(SESSION, "Contract chat")
db.close()
print(f"seeded {SESSION}")
