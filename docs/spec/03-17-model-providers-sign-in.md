### 3.17 Model providers + sign-in

Settings → Model providers and the model step of the first-run flow (3.18) share one list. The catalog is read from Hermes at run time, so a provider a newer Hermes adds shows up without an app change.

**Source files:** `web/src/components/Providers.tsx` (`ProviderList`, `ProviderSheet`, `EndpointSheet`), `web/src/providers.ts` (`buildCatalog`, `POPULAR`, `PRESETS`, `matches`, `methods`, `connectedText`, `onlySlugs`), `web/src/components/Connect.tsx` (`DeviceLoginSheet`, `WelcomeBody`), `web/src/components/SignIn.tsx` (`ClaudeSignInSheet`, `loadPool`, `PoolEntry`, `withPoolStatus`, `afterSignIn`), `web/src/components/Rotation.tsx` (`FallbackSection`, `KeyPoolSection`, `STRATEGIES`, `chainOf`, `strategyOf`, `nextUp`, `sourceText`).

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
| Endpoint (saved own server only) | Address (the base URL), Model, API key ("Saved in Hermux’s .env" or "None"), Remove this endpoint (red) | Remove confirms "Remove <name>?" ("Hermux forgets this endpoint and its key.") and calls `DELETE /api/providers/custom-endpoints/<id>` |
| Sign in (footer when a sign-in only works with the provider's own program: "Some sign-ins need that provider’s own program in Debian: the app copies the command for Termux.") | One row per sign-in with a button Sign in, Copy command, or Sign out (when active and Hermes allows disconnecting: `DELETE /api/providers/oauth/<id>`) | See "Three kinds of sign-in" |
| API key (footer: "Saved in Hermux’s .env on this phone (<VARIABLE>). It never leaves the phone except to call <provider>.") | Saved key (preview + Remove button, confirms "Remove <VARIABLE>?"); a password field ("Paste API key", or "Paste a new key to replace it" when a key is saved; `aria-label` "<provider> API key") with Save (`PUT /api/env`, body `{ key, value }`, toast "<provider> connected"); Get a key ↗ (opens the sign-up page in the browser) | |
| Keys and logins · N | The provider's credential pool, see "Provider rotation" below. Only for a provider with an API key or pool entries; not for an own endpoint | |
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

#### Provider rotation (fallback models and key pools)
**Source:** `Rotation.tsx`. Two of Hermes's own mechanisms, through routes the pinned Hermes has (no plugin route): the fallback chain (`fallback_providers` in config.yaml) and the credential pool (several keys or logins per provider, in `auth.json`) with its rotation strategy (`credential_pool_strategies.<provider>` in config.yaml). Every call is scoped with `?profile=` to the bot chosen in the chips.

**Fallback models** (`FallbackSection`, on Settings → Model providers above the search field; not in the setup flow). Read with `GET /api/config?profile=`; the pool (for the status notes) loads beside it and never holds the card up. Both are re-read when a provider on the page was connected or removed. While the config loads: "Loading…"; if it fails or takes over 20 s: the error with "Try again" (`useLoader`, 3.20). With no fallback set, "No fallback models yet" sits between the main model and Add.
| Element | Looks like | Tap | States |
|---|---|---|---|
| Main model row | Number 1, the bot's model, sub "Main model · <provider>" | nothing (change it under Default models or a provider's "Choose a model") | "No model set" |
| One row per fallback | Number 2, 3…, the model, sub the provider; buttons ↑ ↓ ✕ (`aria-label` "Move <model> up", "Move <model> down", "Remove <model>") | ↑ / ↓ swap it with its neighbour, ✕ removes it (toast "<model> is no longer a fallback"). Each change writes the whole list at once with `PUT /api/config` `{ config: { fallback_providers: [...] } }` (a list replaces the old one in Hermes's merge); the list changes at once and goes back with a toast "Couldn’t save: …" if Hermes refuses | ↑ disabled on the first, ↓ on the last. A gold "Keys cooling down" badge in the sub line when every pool entry of that provider is exhausted or dead |
| Older single fallback | Rows for entries of the legacy `fallback_model` key not already in the list, sub "<provider> · tried last, from the older fallback_model setting (Advanced settings)" | nothing: `PUT /api/config` cannot delete a key | Only when set |
| Add a fallback model | ＋ row, sub "Any model of a connected provider" (or "Tried after the ones above") | Opens the model picker ("Model · fallback", without the reasoning pills: `ModelPicker` `noEffort`); the pick is added at the end (toast "<model> added as a fallback"); a model already in the list (or the main model) only toasts "<model> is already in the list" | |
Footer: "When the main model is rate-limited, out of credit, refuses its key or is gone, Hermux switches to the next model in this list and goes back to the main one once it works again."
Entries are `{ provider, model }` with the provider slug the model picker gives (as Hermes Desktop's editor writes them); other keys an entry has (`base_url`, `api_key`, `key_env`, `api_mode`) are kept when the list is rewritten. `chainOf` reads the list like Hermes does: only entries with a provider and a model count (Hermes skips anything else, such as a bare string).

**Keys and logins · N** (`KeyPoolSection`, in the provider sheet after the API key section). Lists every pool entry of the provider's slugs from `GET /api/credentials/pool`, re-read when the sheet's main key is saved or replaced. Hermes lists only providers already in its `auth.json`: a key saved in `.env` shows up as an `env:<VARIABLE>` entry once Hermes has loaded that provider's pool (a chat used it, or another key was added), and Claude's sign-in is an OAuth entry.
| Element | Looks like | Tap | States |
|---|---|---|---|
| One row per entry | The label, a badge, sub "<token preview> · <where from> · N uses" (`sourceText`: "Saved key (<VARIABLE>)", "Added here", "Sign-in", "Claude Code’s login", "From the config file") and Remove | Remove confirms "Remove <label>?" ("Hermux deletes <VARIABLE> from this bot’s .env and stops using it." for a `.env` key, else "Hermux forgets it and stops using it.") and calls `DELETE /api/credentials/pool/<provider>/<index>` (1-based). Positions move (Take turns reorders the pool on every use), so the app re-reads the pool first and deletes the entry with the same id at its current index (`removeById`; gone already: "That key is already gone. The list is up to date now."); the toast adds Hermes's first hint, if any | Badges: "Cooling down" (gold, `last_status` exhausted: rate-limited or out of credit), "Stopped working" (red, dead: the login was revoked), "In use" (green, the entry Hermes picks under In order) or "Next" (under Take turns or Least used). `nextUp` works this out the way Hermes's pool picks (lowest priority among usable entries; fewest uses for Least used; nothing for Random): Hermes has no route that says which entry a running chat holds, nor when a cooldown ends |
| Which key to use | Picker row, only with two or more entries in the provider's own pool (a grouped sign-in such as ChatGPT under OpenAI has its own pool) | Choices from `STRATEGIES`, Hermes's four: In order (`fill_first`, the default), Take turns (`round_robin`), Least used (`least_used`), Random (`random`), each with a one-line explanation. Saves `PUT /api/config` `{ config: { credential_pool_strategies: { <provider>: <strategy> } } }`; flips back with a toast on failure | `strategyOf` reads a missing or unknown value as In order, like Hermes |
| Add another key | Password field (`aria-label` "Another <provider> key") and Add | `POST /api/credentials/pool` with `{ provider, api_key }` in the body (never the URL); Hermes labels it "key #N"; toast "Key added to <provider>" | Only for a provider with an API key, not GitHub Copilot (Hermes keeps a raw Copilot token out of the pool on purpose) |
Footer: "Hermux switches to another key here when one is rate-limited or out of credit, and to the next fallback model when none is left. Status is from each key’s last use."
Not in the app because the pinned Hermes's dashboard has no route for them (only the `hermes auth` command): changing the order of pool entries (`hermes auth priority`), clearing a cooldown (`hermes auth reset`), adding a second OAuth login, and seeing which fallback a running chat switched to.

---
