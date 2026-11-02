# Settings screens: no "Loading…" that stays (2026-11-02)

**State:** on the owner's phone (0.8.72-plugintest) Settings → Model providers → Fallback models stayed on "Loading…"
with no `fallback_providers` set. Why the phone's call never answered was not found from here (no phone was used): the
bridge's `httpAsync` has no time limit of its own, and the card waited for both `GET /api/config` and the credential
pool. Fixed in the web code: the card loads the config alone (the pool loads beside it, only for "Keys cooling down"),
an empty list says "No fallback models yet", and `useLoader` ends any load after 20 s (`LOAD_LIMIT_MS`) in an error
with Try again (`LoadError`), taking a late answer if it still comes. Try again was added on Model providers, API keys,
Advanced settings, Hermes settings and Connectors; the Connectors MCP and tools sections now show loading, empty and
error states inside their sections. Browser checks: `23-provider-rotation.cjs` (empty, error + Try again, entries),
`25-connectors.cjs` (server list error + Try again); unit tests `timelimit.test.ts`.

**Next:** on the phone, open the card with a build that has this; if it now shows "Hermux didn’t answer in time.",
find which call hangs (`/api/config` or `/api/credentials/pool`) in Hermes's log. Left as they were: Google and
"Keys for skills" on Connectors and the provider sheet's key pool stay hidden while they load or fail (by design).

**Needs a real phone:** yes, `docs/manual-tests.md` "Fallback models again (#10)".

**Links:** `web/src/components/Rotation.tsx`, `web/src/components/Screens.tsx`, `web/src/timelimit.ts`,
`docs/spec/03-17-model-providers-sign-in.md`, `docs/spec/03-20-shared-ui-kit-hard-ui.md`.
