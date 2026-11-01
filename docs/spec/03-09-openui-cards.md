### 3.9 OpenUI cards

**Files:** `OpenUIBlock.tsx` (the block in a message), `openui-entry.tsx` (lazy renderer bundle), `openui-lib.ts` (component library and the reference text), `openui-date.tsx` (the DatePicker replacement), `openui-msg.ts` (button text, link check, saved form state, day text), `openui-query.ts` (the live-data tool client).

Hermes may answer with interactive cards (tables, charts, buttons, forms, steps) instead of prose. The reply contains a fenced block with the language `openui-lang` (the language `openui` also works). The app draws it with OpenUI's own chat component library. This is the one place where the app does not use its own native-style controls (owner decision); the canvas stays for things the user asks to build or write.

#### How a card is drawn

1. `CodeBlock` in `web/src/components/Markdown.tsx` sees the fence language and renders `web/src/components/OpenUIBlock.tsx` `OpenUIBlock`, with a fallback: a plain code block whose bar says "openui-lang (not shown)".
2. The renderer is a lazy bundle. `web/src/openui-entry.tsx` (renderer, OpenUI's component library, its own copy of React and its CSS, about 4 MB) is built on its own by `web/vite.config.ts` (`lazyBundle`) into an inert `<script type="text/hm-lazy" id="hm-openui">` inside `index.html`. Nothing parses it at start. The first card calls `runLazy('hm-openui', '__hmOpenUI')` in `web/src/lazy.ts`, which runs the text once with `new Function`. In a development build the module is imported directly instead.
3. Each card gets its own React root inside its own shadow root (`mount` in `openui-entry.tsx`). The app's Markdown CSS cannot leak in, and OpenUI's CSS stays out of the app. One parsed stylesheet is shared by every shadow root and by the document (for popups that Radix portals to `<body>`). `ThemeProvider` follows the app theme (`data-theme` on the root element: light, otherwise dark). A render error inside a card is caught by a boundary and reported as a `render-error`.
4. While the bundle loads the block shows the text "Loading card…". If it cannot load, or the parser reports `parse-failed`, `parse-exception` or `no-root` once the reply has finished streaming, the fallback code block shows instead. Other errors keep the card and add the line "⚠ Part of this card couldn’t be shown". While the reply is still streaming, errors are ignored and the card redraws as text arrives.
5. Taps inside a card belong to the card: the click does not reach the message (no time toggle, no tap-to-copy), and swipes and the pull-up gesture skip it (`.hm-openui` in `SKIP` of `swipe.ts` and `pullbtw.ts`).

#### What the card can do

| Card action | Result |
|---|---|
| Button / list item / follow-up with `@ToAssistant("...")` | Sends that text as the user's next message (`actionMessage` in `web/src/openui-msg.ts`): the words, then, when the button is inside a form, the form's values as lines `- field: value` (booleans as yes/no, lists joined with commas, empty values left out, `$`-variables never sent), then an optional `(context)`. Haptic tap, then `sendPrompt`. |
| Same, while Hermes is still answering | Nothing is sent; toast "Hermes is still answering. Try again when it’s done" |
| Same, in a view that is not a chat reply (canvas, files, /btw) | Toast "Open the chat to use this". Only chat replies are interactive (`interactive` is set in `ChatItems.tsx`). |
| `@OpenUrl` | Opens the link outside the app, only for `http` or `https` (`safeHttpUrl`); otherwise toast "That link can’t be opened" |
| Any other action type | Ignored |

#### Form fields (two fixes around OpenUI)

- **Dates.** OpenUI's own `DatePicker` keeps the picked day as a JavaScript `Date`, and its "required" check (`isEmpty` in lang-core) calls any object without own keys empty, so a Date always failed with "This field is required" while the field showed the day. `web/src/openui-date.tsx` replaces the component (`library.extend({ components: { override } })` in `openui-entry.tsx`; same name, props and description, so the reference text does not change). The calendar closes once the day (both ends of a range) is picked; OpenUI leaves it open over the buttons below. The day is kept as local text `YYYY-MM-DD` (`dayText`, `textDay` in `openui-msg.ts`; a range as `{from, to}`, counted for "required" only once both ends are picked). An older saved state holding the ISO text of a Date is still read (`textDay`). In the message a day reads `2026-10-15` and a range `2026-10-15 to 2026-10-19` (`formFields`).
- **Fields tied to a `$variable`.** `Select("role", items, null, rules, $role)` keeps its value in the card's variables, not under the form's field names, so the form's values reached Hermes without it. `withBoundValues` in `openui-entry.tsx` parses the card (`createParser`), finds the fields of the pressed button's form whose `value` is a `$variable`, and copies each value into the form state under the field name before `onAction`.
- Checked: in web-e2e with real Chrome, a real shadow root and real mouse clicks and touch taps, a card form with a required list picker (Radix Select, popup portalled to `<body>`), text and date; in vitest (`openui-form.test.tsx`) also text area, checkboxes, radio buttons and chips. Only the date failed.

#### Saved form state

What you typed or picked survives leaving and reopening the chat. State is saved in `localStorage` under `hm.openui.v1`, keyed by `<stored chat id>:<hash of the card code>`, 400 ms after the last change. At most the newest 150 cards and 300,000 characters are kept (`saveUiState`). A card that is still streaming has no key and saves nothing. A chat that is still opening uses its own stored id, so a card reopened from another chat finds its state.

#### Live data (Query)

- A card can read live data with `Query(...)`. The tool client is `makeToolClient` in `web/src/openui-query.ts`; each call goes to `POST /openui/call` with `{ name, args }` (`/api/plugins/hermes-mobile/openui/call`).
- Read-only tools only. The allowed list is `hermes-plugin/hermes-mobile/openui_tools.json`: `web_search`, `find_chats`, `read_file`, `search_files`. The plugin enforces the same list: a tool outside it gets 403, a call that takes over 30 s gets 504, a failing tool gets 502. A card can never write; any change goes through a button that asks Hermes in the chat, where the user approves it.
- Bounds: the same call (same chat, tool and arguments) made within 15 minutes (`QUERY_FRESH_MS`) gets the saved answer, also after reopening the chat, but only the card's first call; a Refresh button's repeat call goes to the network. One card instance makes at most 30 network calls (`QUERY_MAX_CALLS`); the 31st returns the error text "This card asked for data too often. Ask Hermes to refresh it." (`QUERY_TOO_OFTEN`). This stops a model-written refresh interval from polling for ever. Errors come back as an error result inside the card.
- Answers are stored through the same `hm.openui.v1` store, under keys starting `q:`.

#### What Hermes is taught (`web/src/openui-lib.ts`)

- `library` is OpenUI's chat library unchanged; the root component is Card. `PREAMBLE`, `RULES` (OpenUI's chat rules without "generate realistic/plausible data", plus the app's own: use only real data, every block is a complete program starting with `root = Card(...)`, buttons use `@ToAssistant`, `@OpenUrl` takes https links only, phone width about 380 px with at most 4 table columns, never give Query a refresh interval, cards only read) and `EXAMPLES` (the two shortest of OpenUI's examples) feed `referenceText()`. That text is what the plugin's `openui_reference` tool returns, also listing the Query tools and the `$variable` bindings. `npm run gen:openui` in `web/` regenerates the file; `openui-lib.ts` is imported only by the lazy bundle and its test, so the 4 MB never enters the main bundle.
- On/off: Settings → Replies, row "Dynamic UI" (`GET` and `PUT /openui`; applies to new chats only, because Hermes freezes the system prompt per chat). Cards already in chats keep showing either way.
- Read aloud: `speakable()` in `web/src/voice.ts` replaces a card by "(card shown in the app)." (and the notification text ends "[card]").

**Rules:** no card ever sends on its own: only a tap sends a message. The card library is the single exception to the native-controls rule.
