### 3.15 Settings

**Source files:** `web/src/components/Settings.tsx` (`SettingsScreen`, the page components, `ModelPicker`, `setProfileModel`, `profileLabel`), `web/src/theme.ts`, `web/src/update.ts`, `web/src/hermes-update.ts`; rows that live in other files are marked below (`AutoAccess.tsx` `DefaultAccessRow`, `Uninstall.tsx` `UninstallSection`, `Providers.tsx` `ProviderList`). Hermes validates and stores every write, exactly as Hermes Desktop would: the app only calls the dashboard's REST routes, scoped with `?profile=`.

**Opens from:** the ⚙ Settings tile in the drawer; the Bots sheet's "API keys & settings" (opens the API keys page for that bot). **Closes with:** Back arrow (a sub-page goes back to the Settings main page first; Android Back does the same). **Source:** `Settings.tsx` `SettingsScreen`.

The screen has one main page and seven sub-pages. The top-bar title is the page name: Settings, Appearance, Voice, Speech recognition (under Voice), Default models, Model providers, API keys, Advanced settings. Sub-pages that act on one bot (Model providers, API keys, Advanced settings) start on the open bot and show bot chips (the `ProfileChips` row, headed "Sign-ins for", "Keys for" or "Settings for"); tapping a chip changes the target bot.

**Main page, top to bottom (every Section and row):**
| Section | Row (title) | Shows | Tap changes |
|---|---|---|---|
| Appearance | Appearance | Sub "Theme and text size", value = current theme name | Opens the Appearance page |
| Voice | Read every reply aloud | Switch, sub "In all chats" | `setAutoRead` writes `hm.autoread` (`"1"` / `"0"`) and tells the Android side so replies are read with the screen off. A per-chat choice (chat ⋮ menu, `hm.autoread.chats`) wins over this one |
| Voice | Voice | Sub "Engine, voice, speed and pitch" | Opens the Voice page |
| Hermes | Default models | Sub "Which model each bot starts with" | Opens the Default models page |
| Hermes | Model providers | Sub "Sign-ins, API keys, your own server" | Opens the Model providers page |
| Hermes | API keys | Sub "Providers and tools" | Opens the API keys page |
| Hermes | Advanced settings | Sub "Every Hermes option" | Opens the Advanced settings page |
| Permissions | Auto for all chats | A picker row (`DefaultAccessRow`): Off, Auto access, Full access. Footer: "What new and existing chats start in. A chat you set with its own Auto button keeps that choice." | Writes `hm.defaultAccess.v1` (`setDefaultAccess`). Choosing Full access first shows the dialog "Full access in every chat?" with the button "Allow in all chats" |
| Replies | Dynamic UI | Switch, sub "Tables, charts and forms you can tap. Applies to new chats". The whole section is hidden until `GET /openui` answers (an older plugin has no such route) | `PUT /openui` with `{ enabled }`; on failure the switch flips back and a toast says "Couldn’t save: …". Hermes freezes its system prompt per chat, so it only affects new chats; cards already in chats keep showing |
| Background apps | Allow banking, payment, password and 2FA apps | Switch, sub "Off: Hermes won't open them in the background". Hidden until `GET /bgapps` answers. When the plugin says background apps are not available on this phone the row is not a switch and shows the plugin's reason (or "Hermes can’t use apps in the background on this phone") | `PUT /bgapps` with `{ allow_sensitive }`; flips back with a toast on failure |
| Connection | Status | Value Connected / Connecting… / Offline | Opens the Status sheet (3.5) |
| Connection | Reconnect / start Hermes | | `reconnectNow()` (which first calls `startHermes()`, asking the Android side to start Hermes through Termux, then reconnects) and a toast "Reconnecting…" |
| Connection | Setup check | Sub "Permissions, background running, the plugin" | Opens the Setup check screen (3.18) |
| About | App | The app version (`appVersion()` from the bridge; `web-dev` outside the app) | nothing |
| About | Check for updates / Update to <version> | The in-app update row, described next | See below |
| About | Hermes | Value `v<version>` of the phone's Hermes (from the open chat, else the health check), or "—" | nothing (no update button, see below) |
| About | Last start-up | Sub: the start-up timing marks of the last launch ("script 0.1s · …", from `hm.boot.v1` through `web/src/boot.ts`), or "Not measured yet" | nothing |
| About | Remote debugging | Only while Android Developer options are on (`remoteDebuggingState().available`). Sub "Off" or "On · N min left" (`remoteDebugRow` in `web/src/remotedebug.ts`; `RemoteDebugRow` in `Settings.tsx`). Re-read when the page becomes visible or focused, on the shell's `hm-devtools` event, and once a minute only while it is on and the page is visible (at most 60 reads) | Off: `openRemoteDebugging()`, which only makes the shell show its own confirmation and the phone's screen-lock prompt (2.3). On: `turnOffRemoteDebugging()` |
| Danger zone | Uninstall Hermes | Only inside the Android app with an app build that has the uninstall bridge. Footer: "Removes Hermes, all chats and every helper app from this phone. You can save a backup first." | Opens the Uninstall sheet (3.19) |

**In-app update row** (`Settings.tsx` `UpdateRow`, `web/src/update.ts`): it asks GitHub once when the page opens (and not again within a minute, no polling): `GET https://api.github.com/repos/omarqaterge/hermes-mobile-app/releases/latest`. It compares the release tag with `appVersion()` (dotted numbers, a leading `v` ignored). The row changes with `phase`:
| Phase | Title | Sub text |
|---|---|---|
| checking | Check for updates | Checking… (row disabled) |
| uptodate | Check for updates | "You're on the latest version (x)", or "You have a, newer than the latest release (x)" |
| available | Update to x | "A newer version is ready. Tap to download and install" (gold icon) |
| downloading | Check for updates | "Downloading… N%" (disabled) |
| installing | Check for updates | "Confirm in the Android installer" (disabled) |
| permission | Update to x | The shell's message, e.g. the "install unknown apps" request; tap again after allowing |
| error | Check for updates | The reason: GitHub rate limit, "Can't reach GitHub. Check your connection.", "Version x has no app file yet.", "Updating works inside the Android app only." |
A tap in `available` or `permission` calls `startUpdate()`, which hands the release's `.apk` URL to the Android shell (`installUpdate` bridge call; the shell only accepts this project's GitHub release URLs), downloads it and opens the system installer, which asks the user to confirm. The shell reports progress by calling `window.hermesUpdate(state, percent, message)`. Any other tap forces a new check.

**Hermes row and the version check** (`Settings.tsx` `HermesRow`, `web/src/hermes-update.ts`): the app talks to a Hermes build it was written against (`__HERMES_TESTED__`, injected at build time). `checkHermes` reads `current_version` from `GET /api/hermes/update/check` (the update fields in that answer are ignored). `compat` compares the git short hash in both version strings: `same`, `newer`, `older` or `unknown`. On `newer` or `older` the row turns gold and says "Different from what this app was made for. Update the app (x)." (or "…If something breaks, update the app."), and a toast is shown once per differing build (the build string is remembered in `hm.hermesSeen`). There is no "update Hermes" button on purpose: Hermes updates ship with an app release, after the app has been adapted to them.

#### Appearance
**Opens from:** Settings main page, row Appearance. **Closes with:** Back to the main page. **Source:** `Settings.tsx` `AppearancePage`, `web/src/theme.ts`.

**Layout, top to bottom:**
| Section | Element | Looks like | Tap | States |
|---|---|---|---|---|
| Theme (footer: "System follows your phone: OLED black when it is in dark mode, Light when it is not.") | Four swatch cards: Default, OLED black, Light, System | A mini preview with bars and a gold bubble, the name and a ✓ on the chosen one | Haptic, `setTheme(id)` saves the choice in `hm.theme` (`default`, `oled`, `light` or `system`), sets `data-theme` on `<html>` (and `data-oled` for the OLED rules) and tells Android the background colour (`#0E1115`, `#000000`, `#FFFFFF`) through the `setBackground` bridge call so the status and navigation bars match | The older key `hm.oled` = `1` is read as OLED black when `hm.theme` is not set |
| Text size | A sample sentence, then five buttons 90 %, 100 %, 110 %, 120 %, 135 % | Segmented control | Sets the store's `textScale` and `hm.textScale`; the whole app rescales | Default 100 % |

System theme: `resolveTheme` asks `isSystemDark` (bridge) or the browser's `prefers-color-scheme`; dark gives OLED black, light gives Light. Android calls `window.__hmSystemTheme()` when the phone switches, and the theme is re-applied if System is chosen.

#### Voice (read-aloud settings)
**Opens from:** Settings main page, row Voice. **Closes with:** Back. **Source:** `Settings.tsx` `VoiceSettings`, `AssistantSection`; state in `web/src/voice.ts` and `web/src/live.ts`.

Outside the Android app (no `listVoices` bridge call) the page shows one section with the footer "Voice options are available in the Android app." and a row Voice with the value "Not available here". Inside the app:
| Section | Row (title) | Shows | Changes |
|---|---|---|---|
| Read aloud | Read every reply aloud | Switch, sub "In all chats. Turn it on for a single chat from its ⋮ menu." | Same as the main page row: `hm.autoread` |
| Voice (footer explains when a non-default engine lists only its own selected voice) | Speech engine | Picker of the installed text-to-speech engines (placeholder "Phone default") | Saves `hm.tts` (`{ engine, voice, rate, pitch }`), clears the chosen voice and asks Android to list that engine's voices again |
| Voice | Voice | Picker: "Default for my language" first, then the engine's voices grouped by language (the phone's language first). Names are tidied ("Voice 1 · on-device", "Voice 2 · online", brand voices as "ElevenLabs voice · …abcde") | Saves `voice` in `hm.tts` |
| Voice | Open <engine> to change its voice | Only for an engine other than the Google one and when the shell has `openTtsEngineApp` | Opens that engine's own app |
| Sound | Speed | Slider 0.5× to 2×, step 0.05 | `rate` in `hm.tts` |
| Sound | Pitch | Slider 0.5 to 2, step 0.05 | `pitch` in `hm.tts` |
| Dictation (footer: "Speech-to-text for the microphone button and Live mode: the phone’s own, or a model that runs on this phone, offline."; hidden when the shell has no `listSttModels`) | Speech recognition | Value: the model in use ("Moonshine Base"…) or "Phone’s speech recognition" | Opens the Speech recognition page |
| Live mode (footer: "How long you stay silent before Live mode sends what you said.") | Pause before sending | Slider 0.5 s to 6 s, step 0.5, default 2 s | `hm.live.pause`, in the `hm.live` key family (`setLivePause` in `web/src/live.ts`) |
| Phone assistant | Use Hermes as phone assistant | Value On / Off (the `isAssistant` bridge call, re-checked when the app becomes visible again). Footer: how to pick Hermes under "Digital assistant app", and what long-pressing the power button does. The section is hidden when the shell has no `openAssistantSettings` | Opens Android's own assistant picker; the app cannot take that role itself |
| Phone assistant | Talk to Hermes on the lock screen | Switch, default off (`hm.lockAssist.v1`). The footer adds "On the lock screen, the phone asks you to unlock first." when off, and, when on, that Live mode opens without unlocking for talking only and that allowing a command, answering a question or opening your chats asks you to unlock. Hidden when the shell has no `setLockAssist` | Saves it and pushes it to the shell (`setLockAssist`); see 4.6 "Talking on the lock screen" |
| (no title) | Test voice | Sub "Plays a sample sentence with these settings" | Speaks a sample sentence through `speak` |
| (no title) | Reset voice settings | | Sets engine and voice to the defaults, speed and pitch to 1, and reloads the voice list |

#### Speech recognition (on-device dictation models)
**Opens from:** Voice page, row Speech recognition. **Closes with:** Back (returns to Voice). **Source:** `SttSettings.tsx`; state in `web/src/stt.ts`; the shell side is `LocalStt` (4.6).

Outside the Android app (no `listSttModels`) the page shows "On-device speech recognition is available in the Android app." Inside the app, top to bottom:

| Section | Element | Shows | Tap |
|---|---|---|---|
| (no title; footer: the phone's recogniser may send your voice to its maker's servers and needs internet unless it has an offline language pack) | Phone’s speech recognition | Sub "Android’s recogniser (usually Google’s)"; value "✓ In use" when no ready model is chosen | `setSttModel("")` |
| On-device models (footer: your voice never leaves the phone, works offline, uses the processor only while the microphone is on, 45–140 MB) | One card per built-in model (aria-label "Speech model <name>") | Name and size; tags Recommended, In use, "Words while you speak" or "Words after each pause", "Punctuation" or "No punctuation"; 👍 what it is good at, 👎 what it is weaker at; while downloading a progress bar and "Downloading… <x> MB of <y> MB"; "Checking the model on a test recording…"; an error; once ready "Test: <n> of <m> words right · <s> s for 6.6 s of speech" and what it heard | Buttons by state: Download <size>, Cancel, Use, Test model, Try again (failed), Delete (confirms "Delete <name>?") |
| Your own model (footer: any sherpa-onnx model — Moonshine, Whisper, SenseVoice, or a Zipformer, NeMo or Parakeet transducer, in any language — is recognised and tried on a test recording before use) | Cards of the models the user added (tag with their kind, "From <source>"), the notice "Adding the model…" while one is added, the error of the last try | Use, Test model, Test again, Delete |
| | Add from Hugging Face | Sub "Paste the model’s link" | A text dialog "Add a model from Hugging Face" (button Add) → `addSttModelUrl` |
| | Add files from this phone | Sub "The model’s .onnx files and tokens.txt, or a .zip" | `pickSttModelFiles` (Android's document picker) |

The built-in models, the recommended one first: Moonshine Base (English, 142 MB), Moonshine Tiny (English, 44 MB), NeMo FastConformer streaming (English, 137 MB), Zipformer streaming (English, 73 MB). The first model that passes its check is used when none was chosen. The list follows the shell's `stt-models` events, so a download moves on without polling.

#### Default models
**Opens from:** Settings main page, row Default models. **Closes with:** Back. **Source:** `Settings.tsx` `ModelsTab`, `ModelPicker`, `setProfileModel`.

**Layout, top to bottom:** a section (footer "The model each bot starts new chats with. Change the model of a single chat from the chip in its header.") with the row "Set one model for all bots" (✨); then the section Bots with one row per bot: avatar letter, name, sub "<model> · <provider>" or "no model set". Tapping a row opens the model picker for that bot (or for every bot).

**Model picker** (sheet "Model · <bot name | all bots>"): reasoning-level pills (the values of `REASONING_EFFORT_VALUES`, default medium), a search field "Search models…", then the connected providers with their models (a "free" tag on free tiers; the current provider first). A search that is a model id no provider lists exactly (no spaces) adds a block "Use “<id>”" with one row per connected provider, including providers whose list is empty (aria-label "Use <id> with <provider>"); picking one sets that id the same way and, once it succeeded, remembers it in `hm.customModels.v1` (`web/src/custommodels.ts`), so it shows from then on as a normal row under its provider. Without a search, a hint "Missing a model? Type its exact name in the search box to use it." follows the list. Loading shows "Loading models…"; with no connected provider the sheet says "No connected providers. Connect one under Settings → Model providers." Tapping a model calls `setProfileModel`:
1. `POST /api/model/set` with `{ scope: "main", provider, model, profile }`. If Hermes answers `confirm_required` (an expensive model) a dialog "Use <model>?" asks, button "Use it"; confirming repeats the call with `confirm_expensive_model: true`.
2. `PUT /api/config` sets `agent.reasoning_effort` and a per-model `reasoning_overrides` entry to the chosen level, so new chats start at that level.
3. `loadDefaultModel()` refreshes the header of the empty new-chat screen.
For "all bots" the call runs once per profile and failures are gathered into one toast. A toast "<model> → <bot>" confirms. The model list is `GET /api/model/options?profile=` (the cached list first, then a live one with `refresh=true`; `refresh` is forced right after a new sign-in or key, because Hermes caches the list for an hour).

#### Model providers (page)
**Opens from:** Settings main page, row Model providers. **Closes with:** Back. Bot chips "Sign-ins for", then the provider list (3.17) and the note "Every provider this Hermes supports. ChatGPT, Claude, Grok, Nous and MiniMax sign in right here (Claude can also sign in from Termux). Tool keys are under Settings → API keys." **Source:** `Settings.tsx` `SettingsScreen` page `accounts`, `Providers.tsx` `ProviderList`.

#### API keys (page)
**Opens from:** Settings main page, row API keys; the Bots sheet's "API keys & settings". **Closes with:** Back. **Source:** `Settings.tsx` `KeysTab`, `KeySheet`.

**Layout, top to bottom:**
| Element | Looks like | Tap | States |
|---|---|---|---|
| Bot chips "Keys for" | One pill per bot | Chooses whose `.env` is shown | |
| Search keys (e.g. openai, tavily) | Search field | Filters by key name, description and provider label; a search also shows unset keys | |
| Only keys that are set | Switch (on by default), sub "Turn off to see every key Hermes supports" | Toggles between set keys and all keys | Empty text: "No keys set. Turn off “Only keys that are set” to see every key Hermes supports." / "No matches" |
| Add a custom key | Row | Opens the key sheet with an empty name | |
| Groups "<Category> · N" | Model providers first, then Tools, Settings, Custom keys and others A–Z. Each key row: a dot (filled when set), the variable name, sub "<provider> · <redacted value>" or its description / "not set" | Opens the key sheet | |

Messaging keys (`TELEGRAM_`, `DISCORD_`, `SLACK_`, `WHATSAPP_`, `SIGNAL_`, `MATRIX_`, `MATTERMOST_`, anything in the messaging category or marked `channel_managed`) are hidden: the app has no messaging-channel UI.
**Key sheet** (title = variable name, or "Add a key"): the description; a "Get a key ↗" link when Hermes knows a sign-up page; for a new key, a notice that a model provider belongs under Settings → Model providers (or its "Add an OpenAI-compatible endpoint" when it isn't listed), because a key added here puts no models in the model menu, then a Name field (letters, digits and `_`, forced to upper case); "Current" with the redacted value (a Show button asks `POST /api/env/reveal` and shows the real one); the input "Replace with" or "Value" (password type unless Hermes says the value is not secret; placeholder "Paste here"); a section with the switch "Apply to all bots" and the footer "Saved to <bot>’s .env on the phone. New chats pick it up." Buttons: Remove (confirms "Remove <KEY>?"; `DELETE /api/env`; a key already missing on another bot is ignored), Show, Save (`PUT /api/env` with `{ key, value }`, disabled until there is a name and a value). With "Apply to all bots" the call runs for every profile.

#### Advanced settings (page)
**Opens from:** Settings main page, row Advanced settings. **Closes with:** Back. **Source:** `Settings.tsx` `ConfigTab`, `ConfigSheet`.

It lists every option in Hermes's configuration schema (`GET /api/config/schema`, cached for the run) with the values of the chosen bot (`GET /api/config?profile=`).
| Element | Looks like | Tap | States |
|---|---|---|---|
| Bot chips "Settings for" | One pill per bot | Chooses the bot | |
| Search N settings | Search field with the number of options | Searches key and description; matches show in a section Results (at most 80; "No matches") | |
| Category rows | One row per schema category (title-cased) with a count and ⌄ / › | Expands the category in place | Loading / error notice |
| Option rows | Key name and description. A true/false option is a switch that flips at once and saves (it reverts on error); other options show their value on the right and a › | Opens the option sheet | |

Option sheet (title = key): the description; for a choice option a list with a ✓ on the current one; for a list or an object a text area ("JSON, or one item per line"); otherwise a field (a number option checks the value: "Enter a number"). A section with "Apply to all bots" and the footer "Saving to <bot | every profile>. New chats use it." Buttons Cancel and Save. Saving calls `PUT /api/config?profile=` with the value nested under its dotted path. A `model.*` change also reloads the bot list; a `model.*` or `agent.reasoning*` change refreshes the default model.
Hidden on purpose: everything that configures other chat platforms or the messaging gateway (the categories messaging, slack, discord, mattermost, matrix, gateway, bot_desktop; `display.platforms.*`, `agent.gateway_*`, `telegram.*`, `whatsapp.*`, `signal.*`, `email.*`).

---
