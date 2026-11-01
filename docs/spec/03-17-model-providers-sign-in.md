### 3.17 Model providers + sign-in

Settings → Model providers and the model step of the first-run flow (3.18) share one list. The catalog is read from Hermes at run time, so a provider a newer Hermes adds shows up without an app change.

**Source files:** `web/src/components/Providers.tsx` (`ProviderList`, `ProviderSheet`, `EndpointSheet`), `web/src/providers.ts` (`buildCatalog`, `POPULAR`, `PRESETS`, `matches`, `methods`, `connectedText`, `onlySlugs`), `web/src/components/Connect.tsx` (`DeviceLoginSheet`, `WelcomeBody`), `web/src/components/SignIn.tsx` (`ClaudeSignInSheet`, `loadPool`, `withPoolStatus`, `afterSignIn`).

#### Provider list
**Opens from:** Settings → Model providers; the model step of the setup flow. **Closes with:** Back (it is part of a page). **Source:** `Providers.tsx` `ProviderList`.

The catalog is built from four calls, each scoped to the bot: `GET /api/env` (keys, with provider tags), `GET /api/providers/oauth` (sign-ins), `GET /api/providers/custom-endpoints` (saved own servers) and `GET /api/credentials/pool` (a Claude login lives only in the credential pool). A failure of the last three degrades quietly to empty.

**Layout, top to bottom:**
| Element | Looks like | Tap | States |
|---|---|---|---|
| Search providers (e.g. deepseek, groq) | Search field | Matches name, id, description, sign-in names, key variable names and addresses | "No provider matches. Try your own server below." |
| Section Connected · N | Rows of connected providers | Opens the provider sheet | |
| Section Popular | Not-connected providers from the fixed list Anthropic, OpenAI, Gemini, OpenRouter, xAI, DeepSeek, Mistral, Groq, in that order | Opens the sheet (Mistral and Groq open the endpoint sheet, they are presets) | |
| Section All providers · N (or More while searching) | The rest, A–Z | Opens the sheet | |
| Section Your own server (footer: "Any OpenAI-compatible API: vLLM, llama.cpp, LocalAI, a company gateway…") | Row "Add an OpenAI-compatible endpoint", sub "Its address, and a key if it needs one" | Opens the empty endpoint sheet | Only after the catalog loaded |

A provider row has a dot (filled when connected), the name, a sub line (what is connected, or a short description) and, when not connected, how it connects on the right: Key or sign in, API key, Sign in, Set up, or Your endpoint. A provider counts as connected when any of its key variables is set, or (for providers with no key, such as a cloud account) a setting is set, or a sign-in is active (logged in and not a free tier). A vendor's sign-in is grouped with its API key (for example ChatGPT / Codex under OpenAI, Claude Code under Anthropic). Presets Mistral, Groq and Ollama (local) are OpenAI-compatible services Hermes has no provider for; they are saved as custom endpoints, and are not offered once such an endpoint exists or a newer Hermes has the provider.

#### Provider sheet
**Opens from:** tapping a provider row. **Closes with:** the grip, the backdrop or Back. **Source:** `Providers.tsx` `ProviderSheet`.

**Layout, top to bottom (each section only when it applies):**
| Section / element | Rows | What a tap does |
|---|---|---|
| Intro line | What is connected, or the description | |
| Endpoint (saved own server only) | Address (the base URL), Model, API key ("Saved in Hermes’s .env" or "None"), Remove this endpoint (red) | Remove confirms "Remove <name>?" ("Hermes forgets this endpoint and its key.") and calls `DELETE /api/providers/custom-endpoints/<id>` |
| Sign in (footer when a sign-in only works with the provider's own program: "Some sign-ins need that provider’s own program in Debian: the app copies the command for Termux.") | One row per sign-in with a button Sign in, Copy command, or Sign out (when active and Hermes allows disconnecting: `DELETE /api/providers/oauth/<id>`) | See "Three kinds of sign-in" |
| API key (footer: "Saved in Hermes’s .env on this phone (<VARIABLE>). It never leaves the phone except to call <provider>.") | Saved key (preview + Remove button, confirms "Remove <VARIABLE>?"); a password field ("Paste API key", or "Paste a new key to replace it" when a key is saved; `aria-label` "<provider> API key") with Save (`PUT /api/env`, body `{ key, value }`, toast "<provider> connected"); Get a key ↗ (opens the sign-up page in the browser) | |
| More settings | Row (sub "Base URL and other options") that reveals the section Settings, opened at once for providers that cannot work without it | |
| Settings | One row per non-key variable (base URL, region…): tapping it opens a text dialog (Save; saving an empty value removes it). Secret alias keys that are set show a Remove button | |
| Sign-up / docs ↗ | Only for a provider with no key, no sign-in and no endpoint | Opens the page |
| Bottom button | "Choose a model" (enabled once connected) or "Connect it first, then choose a model" | Opens the model picker limited to this provider's models, then `setProfileModel` and a toast "New chats use <model>" |

**Three kinds of sign-in** (`providers.ts` `kindOf`):
- Device code (ChatGPT / Codex, Nous Portal, xAI Grok, MiniMax): runs in the app (`DeviceLoginSheet`).
- Claude Pro / Max (`anthropic`): runs in the app (`ClaudeSignInSheet`) with Termux as the fallback.
- Command: other providers whose login Hermes only offers in a terminal; the button copies `hermes auth add <id>` (with `-p <profile>` for a non-default bot) and a toast says to run it in Termux inside Debian.

#### Device-code sign-in sheet
**Opens from:** the Sign in button of a device-code provider. **Closes with:** the grip, backdrop or Back. **Source:** `Connect.tsx` `DeviceLoginSheet`. Title "Sign in to <name>".
Steps shown: "1. Copy this code" (the code is a button that copies it, toast "Code copied"); "2. Open the sign-in page, sign in and enter the code" (the primary button "Copy code and open <host>" copies the code and opens the page in the browser); "3. Come back here: this closes by itself once you’re signed in" (with a spinner). While waiting: "Asking <name> for a sign-in code…".
How it works: `POST /api/providers/oauth/<id>/start` returns `session_id`, `user_code`, `verification_url`, `expires_in` and `poll_interval`. The sheet polls `GET /api/providers/oauth/<id>/poll/<session>` every `max(2, poll_interval or 3)` seconds, for at most `min(expires_in, 900)` seconds. `approved` toasts "Signed in to <name>" and closes; `denied`, `expired` and `error` show a message ("The code expired. Close this and try again." and others). Closing early calls `DELETE /api/providers/oauth/sessions/<session>` so Hermes stops waiting and does not save a late login.

#### Claude sign-in sheet
**Opens from:** Sign in on the Claude row. **Source:** `SignIn.tsx` `ClaudeSignInSheet`. Title "Sign in to Claude". Hermes's dashboard has no Claude sign-in of its own, so the app uses the plugin's routes: `POST /claude-login/start` (returns a `claude.ai` link and a session id), `POST /claude-login/finish` (the pasted code), `POST /claude-login/cancel` (when the sheet is closed or restarted before finishing). The login is saved in Hermes's credential pool, like `hermes auth add anthropic`.
Layout: "1. Sign in on claude.ai with your Pro or Max account and allow access" with the button Open claude.ai; "2. Claude shows a code. Copy it, come back and paste it here" with the field "Code from Claude" (placeholder "Paste the code here"; Enter submits); an error notice; the primary button Sign in ("Signing in…" while busy, disabled with no code), which turns into Start again when the error says the sign-in expired or was used up (a code works once and only for 10 minutes); the note about where the login is saved; and the button Use Termux instead. On success the toast says "Signed in to Claude. Its models are in the model menu now." and `afterSignIn()` reloads the default model and asks Hermes for a fresh model list with the `model.options` RPC (`refresh: true`). If the plugin route is missing, the sheet shows a warning and the button "Sign in with Termux" instead.
**Termux fallback:** the `signInTermux` bridge call opens Termux on `hermes auth add anthropic`. When the user comes back to the app (page visible again) the list reloads, and a toast says "Signed in to Claude" or "Claude is not signed in. If Termux showed an error, try again."
**Signed-in detection:** Hermes's `/api/providers/oauth` only sees Claude when a token file or key variable exists, so `withPoolStatus` also counts an OAuth entry in the credential pool (not the Claude Code token, which has its own card) as signed in.

#### Endpoint sheet (your own server)
**Opens from:** "Add an OpenAI-compatible endpoint", or a Mistral / Groq / Ollama preset. **Source:** `Providers.tsx` `EndpointSheet`. Title "Your own endpoint" or "Connect <preset>".
Fields: Name; Address (base URL); API key (marked "(if it needs one)" for presets and own servers that need none); for presets a Get a key ↗ button; the button "Find its models" (disabled until the address starts with http:// or https://); a note with the result; then the Default model picker when models were found, else a plain Model field. The intro says Hermes runs on this phone, so the loopback address is the phone itself. "Find its models" calls `POST /api/providers/custom-endpoints/validate`, shows the model count or the server's message and adopts the address Hermes resolved. Save (disabled until name, a valid address, a model and, for presets that need one, a key are filled) calls `POST /api/providers/custom-endpoints` with `{ name, base_url, model, api_key?, discover_models: true, models? }` and toasts "<name> connected". The key is saved in Hermes's `.env`, not in its config file; keys only travel in a request body, never in a URL.
**Rules:** no native `<select>` (the model choice is a `SelectRow`); no key is ever logged.

---
