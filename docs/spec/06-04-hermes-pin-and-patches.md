### 6.4 Hermes pin and patches (3)

**The pin.** The Hermes that gets installed is one exact commit: `HERMES_COMMIT` (40 characters) at the top of `phone/bootstrap.sh`. It must equal the build the app is written against: `web/vendor/hermes-shared/.hermes-commit` (short SHA) and `.hermes-version`. `tools/test_bootstrap_pin.sh` (run by CI) fails when they differ or when the Hermes installer is not called with `--commit $HERMES_COMMIT`. `bootstrap.sh` also uses the pinned commit's own `scripts/install.sh`, not the hosted one, so installs are reproducible.

**The patches.** `hermes/patches/*.patch` are plain `git format-patch` files applied on top of the pinned build. They are offered upstream, so the list should shrink as Hermes merges them. `phone/hermes-patches.sh status|apply|revert [dir]` (run in Debian, in the checkout `$HERMES_AGENT_DIR`, default `~/.hermes/hermes-agent`) classifies each patch as `upstream` (the commit in its `From <sha>` line is already in Hermes), `applied` (reverse-applies cleanly), `pending` (applies) or `conflict`. `apply` is all or nothing: a conflict undoes what this run applied and exits 2. `revert` removes applied patches in reverse order. The edits are ordinary uncommitted changes in the checkout, so `git diff` shows them. `hermes update` stashes them and puts them back.

| Patch | What it fixes | Upstream |
|---|---|---|
| `0001-fix-agent-keep-marker-merged-user-rows-addressable.patch` | A message merged into a model-switch marker could not be edited or retried ("target user message is no longer in session history"): alternation repair dropped its row id. | Already on Hermes main (commit 696f6e9); a backport for the pinned build. |
| `0002-fix-tui_gateway-keep-the-prompt-a-model-switch-marker-absorbed.patch` | The message sent right after a model switch (or the first message when the model was picked first) disappeared from the model's history at the next switch, while the chat still showed it. | Offered upstream. |
| `0003-perf-yaml-reuse-a-per-thread-reader-in-safe_load.patch` | Every YAML read built a new parser (about 7 ms on a phone), so a skill scan took about 1.8 s and held up other requests at start-up; now one reader per thread and mode. | To be offered upstream. |

**Workflow.**

- *New fix:* commit it in a `hermes-agent` clone at the pinned build with a test that fails without it, `git format-patch -1 --no-signature -o hermes/patches`, number it after the last, open the same fix as an upstream PR, and add it to the table in `hermes/README.md`.
- *Moving to a newer Hermes:* change `web/vendor/hermes-shared` and `HERMES_COMMIT` in `phone/bootstrap.sh` together; delete patches that now read `upstream`; re-make any that read `conflict`; recheck the Hermes-private helpers the plugin uses (`claude_login.py`, `checkpoints.py`, `auto_mode.py`, `phone_app.py`); update `hermes/README.md`; run the image workflow to publish a new image for the new pin.
- *Checks:* `tools/test_hermes_patches.sh` (CI) checks that every patch applies to the pinned build and reverts cleanly and shows how each fares on upstream main. `tools/hermes_repro_model_switch.py` reproduces the 0002 bug with a fake model; `tools/probe_model_switch.py` runs the same story against a real Hermes.
- *On the phone:* `install.sh` copies the patches to `/root/.hermes/hermes-mobile-patches` and applies them; check them with `bash ~/.hermes/scripts/hermes-patches.sh status ~/.hermes/hermes-mobile-patches`.
