### 6.2 `hermes-services`: the supervisor loops

`~/bin/hermes-services` is idempotent: run it from boot, the app, a widget or by hand. It starts one background loop per job with `run_loop name command...`. Each loop is `while true; do command; sleep 10; done` in a subshell, with its pid in `~/logs/<name>.pid` and output in `~/logs/<name>.log`; a loop whose pid is alive is not started twice. There is **no permanent wake lock** (battery): the script releases a lock left by older versions once per boot (`boot_id` marker `~/.hermes-mobile/unlocked`) and strips a bare `termux-wake-lock` line from the boot script.

| Loop (pid file) | Command | Purpose |
|---|---|---|
| `sshd` (no loop) | `sshd` if installed and not running | Optional remote shell. |
| `dashboard` | `hermes dashboard --host 127.0.0.1 --port 9119 --no-open` in Debian | Hermes's web server and WebSocket gateway; the app talks to it. Restarted 10 s after it dies (also how `hermes-debian --restart` works). |
| `memory-sync` | `hermes_memory_sync.py sync`, then `sleep 590` | Only if `/root/.hermes/scripts/hermes_memory_sync.py` exists in Debian. |
| `cron-ticker` | `cron_ticker.py` with Hermes's own venv Python | Cron jobs and wake reporting (6.1). |
| `app-keeper` | If `127.0.0.1:9121` does not accept a connection, `am broadcast -n com.omarqaterge.hermesmobile/.StartReceiver -f 32`; then `sleep 300` | Revives the app's service after a force stop or a Recents clean-up. Flag 32 is `FLAG_INCLUDE_STOPPED_PACKAGES`; stock Android drops the broadcast without it. Costly (a Java VM per call), so only when the port does not answer. |
| `bot-keeper` (retired) | none | If an old `~/logs/bot-keeper.pid` exists, kills that loop and runs `bots.py off` once (parks every bot, stops the keeper and the host gateway). The always-on bot keeper is no longer started: the app is the only front end. |
