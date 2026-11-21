# Model picker: slow, part of the list, stuck on "Loading models…" (2026-11-21)

**State:** a user reported that the chat's model picker took long to open every time, sometimes showed only two
providers (not every provider they had a key for), and in a new chat stayed on "Loading models…". At the same time
Settings → Model providers showed "Hermux unreachable: Hermes isn't answering" in both its sections: the dashboard
(`127.0.0.1:9119`) was not answering, or not with a valid proof (`LocalDashboard.NotVerified` uses the same words for
both), while chats over the gateway still worked. Setup check found what was missing and installed it; after that the
list was complete but still slow. Their Hermes was v0.21.6, newer than the build the app is made for
(`web/vendor/hermes-shared/.hermes-version`), so Settings showed "Different from what this app was made for".

Fixed in the web code (`web/src/modelcache.ts`, `ModelSheet` in `web/src/components/Sheets.tsx`):

- The picker used to ask Hermes for the live list (`model.options` with `refresh: true`, every provider's catalog fetched
  again, after `POST /refresh-logins`) on **every** open. On a phone that is seconds of work under one Python GIL, beside
  any reply running, and the next open's plain read waits behind it. Now the live refresh runs only when the last one
  for the profile is over 10 minutes old, after a sign-in or key/endpoint change (`modelsChanged`), or on "Refresh the
  list"; never two at once (`liveOnce`).
- The last list per profile is kept (`hm.modelOptions.v1`, slim) and shown at once on the next open; Hermes's plain read
  replaces it when it comes.
- The first answer has the 20 s `LOAD_LIMIT_MS` bound: an error with Try again and Report a problem instead of
  "Loading models…" for up to the RPC client's 120 s. `refresh-logins` is waited for at most 8 s.
- `LoadError` adds a "Setup check" link to "Hermux unreachable" errors, the step that fixed it for the user.

Browser checks `tools/web-e2e/checks/30-model-picker.cjs`; unit tests `web/src/modelcache.test.ts`.

**Not explained from here (no phone):** why only two providers showed. Candidates: Hermes's plain read (`non_blocking`,
disk cache only) falls back to curated lists, so rows should not vanish; with the dashboard down the live refresh's
`refresh-logins` failed, so a Claude subscription whose token had expired had no models. Hermes ≥ 0.21.6 also refuses
`model.options` with error 5098 when the running process is older than the code on disk (`_model_skew_err`: after a
`hermes update` without a restart); the picker now shows that reason instead of loading for ever.

**Next:** try it on a phone (`docs/manual-tests.md` "Model picker opens at once"); if a part list comes back, compare
`model.options` with and without `refresh` in Hermes's log for that profile.

**Needs a real phone:** yes.

**Links:** `web/src/modelcache.ts`, `web/src/components/Sheets.tsx`, `web/src/components/Screens.tsx`,
`docs/spec/03-05-chat-sheets.md`, `docs/spec/03-20-shared-ui-kit-hard-ui.md`, `docs/status/settings-loading.md`.
