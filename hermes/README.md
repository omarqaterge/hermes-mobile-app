# Fixes to Hermes itself

Hermes Mobile runs an unmodified [Hermes Agent](https://github.com/NousResearch/hermes-agent) build, plus the small
fixes in `patches/`. Each one is a plain `git format-patch` file, applied on top of the Hermes build the app is made for
(`web/vendor/hermes-shared/.hermes-commit`) and offered upstream, so the list shrinks as Hermes merges them.

| Patch | What it fixes | Upstream |
|---|---|---|
| `0001-fix-agent-keep-marker-merged-user-rows-addressable` | A message merged into a model-switch marker could not be edited or retried ("target user message is no longer in session history") | NousResearch/hermes-agent@696f6e9, already on Hermes main: a backport for the pinned build |
| `0002-fix-tui_gateway-keep-the-prompt-a-model-switch-marker-absorbed` | The message sent right after a model switch (or the first message, when the model was picked before it) disappeared from the model's history at the next switch, while the chat still showed it | Offered upstream (Refs NousResearch/hermes-agent#131382) |

## On the phone

`phone/install.sh` copies the patches into Debian and runs `phone/hermes-patches.sh apply`. The changes sit in the Hermes
checkout as ordinary uncommitted edits, so you can always see and undo them (inside Debian):

```bash
bash ~/.hermes/scripts/hermes-patches.sh status ~/.hermes/hermes-mobile-patches   # applied / pending / upstream / conflict
bash ~/.hermes/scripts/hermes-patches.sh revert ~/.hermes/hermes-mobile-patches   # back to upstream's files
git -C ~/.hermes/hermes-agent diff                                               # exactly what changed
```

`install.sh` restarts a running Hermes so the change loads; after a manual `apply`/`revert`, re-run it or reboot the
phone. `apply` is all or nothing: a
patch that no longer fits the installed Hermes stops it with nothing changed. A patch whose upstream commit Hermes already
contains reads as `upstream` and is skipped. `hermes update` stashes the edits and puts them back after the update.

## Changing the list

- **New fix:** make the commit in a `hermes-agent` clone checked out at the pinned build, with a test that fails without
  it, then `git format-patch -1 --no-signature -o hermes/patches` and number it after the last one. Open the same fix
  as a PR upstream (rebased onto their `main`) and link it in the table.
- **Moving to a newer Hermes** (together with `web/vendor/hermes-shared`): delete the patches that read `upstream`,
  re-make any that read `conflict` on the new build, and update the table.
- `tools/test_hermes_patches.sh` (also run by CI) checks that every patch applies to the pinned build and reverts cleanly,
  and shows how each one fares on upstream `main`.
