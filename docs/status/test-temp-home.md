# Tests never run in a real Hermes home (2026-11-19)

**State (2026-11-19):** `tools/check.sh` gives every check a new, empty `HOME` and `HERMES_HOME` (`temp_home`),
removed afterwards, and its first check fails when a check would get the caller's own home (`HM_CHECK_REAL_HOME=1`
opts out). `test_cron_ticker.py`, `test_claude_login.py` and `test_token_guard.py` set their own temporary home before
importing anything, so they are safe to run alone too. Spec 7.2 (`check.sh`, `test_claude_login.py`).

**Next:** `test_waiting.py` (sets `HOME` but not `HERMES_HOME`), `test_phone_taint.py` and `test_nested.py` were left
alone because other open PRs change them; they need the same guard once those merge.

**Needs a real phone:** nothing.

**Links:** spec 7.2.
