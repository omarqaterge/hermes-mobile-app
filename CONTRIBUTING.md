# Contributing

Pull requests and issues are welcome.

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep it focused; one idea per PR. Update the specification (index: [docs/SPEC.md](docs/SPEC.md), text: the area's file in `docs/spec/`) in the
   same commit, and for anything users notice add a file to [changes/](changes/README.md) (not a line in CHANGELOG.md, so parallel
   branches don't conflict). Coding agents: see [AGENTS.md](AGENTS.md).
3. Run the checks: `tools/setup.sh` once per checkout, then `tools/check.sh`, which runs the ones your changes need
   (`--all` for everything; it takes most of its commands from CI's workflow file). CI runs the same on every PR. What each check covers is in the spec, [7.2 Every `tools/` file](docs/spec/07-02-every-tools-file.md) and
   [7.3 Browser e2e](docs/spec/07-03-browser-e2e.md). Not in CI: `python3 tools/e2e.py`, end-to-end checks against a
   real phone; run it after touching the plugin, the service or the event flow.
4. Open a pull request and fill in the template. Add a screenshot for UI changes.

To build the app and work on the interface, see [Build the app yourself](README.md#build-the-app-yourself) in the README.

## After a Hermes update

The app uses Hermes's internal protocol, which can change. Copy the phone's Hermes `apps/shared/src` into `web/vendor/hermes-shared`,
update `.hermes-commit` and `.hermes-version` (the `hermes --version` build string, e.g. `0.21.5+4582.gb8a8be1`), run
`npm run typecheck` in `web/` and rebuild. Then bring `hermes/patches` along: `hermes/README.md` says how.
The app compares the phone's Hermes build with `.hermes-version`: if they differ it shows a notice once and a warning in Settings → About.
There is no "update Hermes" button on purpose: Hermes updates ship with an app release, after the app has been adapted to them.

## Project rules

- No native form controls (`<select>`, range/checkbox inputs) and no `confirm()`/`prompt()`/`alert()`; use `web/src/components/ui.tsx` and `web/src/dialog.tsx`.
- Every native bridge method takes the per-page-load key first and is listed in `web/src/secure-bridge.ts`.
- Keep `rehype-sanitize` in front of rendered Markdown.
- Colours come from CSS variables so the light theme works.
- No periodic loops or wake locks without a bound (battery).
- Don't commit keys, tokens, `*.keystore`, `.env` files, or screenshots of real chats.

By contributing you agree your work is released under the MIT license.
