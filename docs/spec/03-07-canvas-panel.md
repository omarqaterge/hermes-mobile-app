### 3.7 Canvas panel

**Files:** `Canvas.tsx` (panel, editor, menus, history sheet), `DocView.tsx` (`DocView`, `CsvTable`, `fenced`: the viewer for each document type), `HtmlFrame.tsx` (sandboxed HTML frame, shared with the chat), `htmlframe.ts` (`frameDoc`, `frameHeight`), `canvas.ts` (state, sync with the plugin, the agent's tool events, line diff).

The canvas is a set of documents that belong to one chat. Hermes writes them with its `canvas` tool, you read, edit and run them, and they stay with the chat. The panel is `web/src/components/Canvas.tsx` `CanvasPanel`. Its state and its sync with the phone are in `web/src/canvas.ts` (`useCanvas`, `canvasState`).

#### What the user sees

- A header button (aria-label Canvas, or "Canvas (Hermes is writing)" while a canvas call streams) with a dot when the chat has documents.
- A panel that slides in from the right. On a phone it covers the chat. On a wide screen (min-width 700 px: upright tablets, unfolded foldables, landscape) it is a column beside the chat whose width the user drags (see "Divider and width on wide screens" below).
- Documents show as tabs. Each has a type icon (`TYPE_ICON`): markdown 📝, html 🌐, code 💻, text 📄, json `{ }`, csv ▦, svg 🖼, mermaid ⛓.

#### Ways to open it

| Gesture / control | What it does |
|---|---|
| Header canvas button (`openChatCanvas` in `web/src/swipe.ts`) | Opens this chat's canvas. On the empty new-chat screen it first starts a chat (`newSession`), then opens, because a canvas belongs to a chat. A chat that is still opening (cold start) counts as a chat: its canvas opens without creating a new one. |
| Swipe left on the chat (`installSwipeToDrawer` in `web/src/swipe.ts`) | Same as the button. Needs finger travel left of more than 70 px and more than twice the vertical travel, a chat on screen (active or opening) and the canvas closed. The swipe is ignored when it starts on an input, a dialog, a sheet, the canvas, the drawer, a lightbox, a slider, the read-aloud player, the find bar, a code block, a table, a formula, a diagram or an OpenUI card, on anything that scrolls sideways, or while the drawer, a screen or a sheet is open. |
| Swipe in from the right edge (wide screens; `EDGE` strip in `web/src/swipe.ts`, `edgePullStart` in `web/src/splitview.ts`) | A touch that starts in the 24 px strip at the right edge and moves more than 10 px left (more left than up or down) opens the canvas at zero width and the column follows the finger. Let go slowly and it stays at that width; a flick (faster than 0.5 px/ms leftwards) opens it at the width it had last time; let go under 20 % of the room and it closes again. Needs a chat on screen (active or opening), the canvas closed, and no drawer, screen or sheet open. The strip belongs to the canvas: code blocks, tables or the scrubber under it don't stop the pull; text fields, dialogs, sheets, the drawer, a lightbox and the read-aloud player still do (`EDGE_SKIP`). A mostly vertical move (more than 20 px) is a scroll. |
| Pull tab (`CanvasPull` in `Canvas.tsx`, class `canvas-pull`, aria-label Open the canvas) | A slim grip at mid-height on the right edge, in a 24 × 200 px touch area, on wide screens only while the edge swipe can work (a chat on screen, canvas closed, no drawer, screen or sheet). Tap: opens the canvas (`openChatCanvas`). It marks the strip of the edge that the Android shell keeps free of its Back gesture (`claimEdge` → bridge `setEdgeGrab`, 4.5). It is hidden (class `off`), not removed, while it doesn't apply, so a pull that started on it keeps its touch events. |
| Chat ⋮ menu → Canvas | Opens it. The row's second line says "N documents" or "Documents, notes and pages beside the chat". |
| Code block button "Canvas" (`web/src/components/Markdown.tsx`) | Shown on a code block of 3 lines or more. Makes a document from the block (`createDoc`; type html, svg, markdown, json or csv from the fence language, else code) and shows the toast "Opened in the canvas". |
| Files → a text file → "Open in canvas" | `openFileInCanvas`: opens the file as a document linked to it (`POST /canvas/open-file`). |
| Canvas gallery → "Open canvas" | See 3.8. |
| Hermes writes a document | The panel opens by itself (see "While Hermes writes"). |

#### Ways to close it

- Button ✕ (aria-label Close canvas).
- Android Back (`useBackHandler`): if the panel is full screen it first goes back to the side size; otherwise it closes. While one of the panel's own sheets is open, Back closes that sheet first.
- Swipe right on the top bar (`.canvas-head`, phones only, below 700 px). The panel follows the finger. It closes when you let go past 30 % of its width, or with a flick faster than 0.5 px/ms (slides out in 200 ms); otherwise it slides back. The drag starts only after 10 px of travel, mostly rightwards. A swipe that begins while the tab row is scrolled away from its start is left to the tab row. Leftwards or mostly vertical movement is not a close swipe.
- Wide screens: drag the divider to under 20 % of the room and let go (see below).
- Closing saves a pending edit first (`flushSave`).

#### Divider and width on wide screens (`web/src/splitview.ts`)

- **The divider** (`SplitHandle` in `Canvas.tsx`, class `canvas-split`) sits on the column's left border: a 16 px touch area with a grip (`canvas-split-grip`), `role="separator"`, `aria-orientation="vertical"`, aria-label Resize the canvas, `aria-valuenow` the stored share in percent (20–85). Shown only at the side size on wide screens (`useDock`, `DOCK` = `(min-width: 700px)`).
- **Drag** (pointer events, mouse or finger; `dividerStart`, `dragTo`, `dragEnd`, `dragCancel`): the chat and the canvas follow the finger. While dragging, `html.resizing` turns off the width transitions and makes iframes ignore the pointer, and `--canvas-live` holds the width under the finger. Let go past 85 % of the room and the canvas goes full screen (the stored width is kept for later); under 20 % it closes; otherwise that share is kept. While the finger is past a snap point the divider shows "Full screen" or "Close" (`canvas-split-hint`, `html[data-snap]`).
- **Keys:** ArrowLeft widens the canvas by 5 %, ArrowRight narrows it (`nudgeSplit`). **Double-tap** goes back to the default width (`resetSplit`).
- **Width:** the canvas's share of the room beside the docked chat list (the screen width minus `--side-w`) is kept in localStorage `hm.canvasSplit.v1` and set as `--canvas-frac` on `html[data-split]`, so a rotation or hiding the list re-flows without code. `--canvas-w` = that share, at least 300 px, and leaving the chat at least 340 px (the canvas minimum wins on a screen too narrow for both). Without a stored share it is 46 %, at most 640 px. A share the screen cannot show (past the chat's minimum) is stored as what was shown (`keep`).

#### Canvas panel (screen block)

**Opens from:** the controls above. **Closes with:** ✕, Back, swipe right on the top bar. **Source:** `web/src/components/Canvas.tsx` `CanvasPanel`, `web/src/canvas.ts`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Tab row | One chip per document: type icon + title; the active one is highlighted. A last chip "＋" (aria-label New document). | Tab: `selectDoc` (saves a pending edit, clears a conflict flag, loads the document). ＋: opens the New document sheet. | Scrolls sideways. Swipe right at its start closes the panel. | Not shown in full-screen size. |
| ✕ | Round close button, aria-label Close canvas | Closes the panel | Swipe right on the bar closes | |
| Writing state | Replaces the body while Hermes writes a document that is not on a tab yet: spinner, "Hermes is writing a document…" (or "Saving “Title”…" once the call has text), a seconds counter, and the text so far in a box (cut at 40,000 characters) or grey skeleton lines | | | Shown only while the model streams a `canvas` call |
| Loading | Spinner and "Loading the canvas…" | | | While the chat's document list has not arrived (chat still opening, or Hermes unreachable) |
| Empty | 🗒, "Your canvas is empty", "Ask Hermes to write something here, or start your own." and a button New document | New document opens the New document sheet | | No documents |
| Toolbar | Segmented control View / Edit (View is called Run for an HTML document); a status text; for an HTML document in View, a toggle "🚫 Offline" / "🌐 Online"; a button ⛶ (aria-label Fill the whole screen); a button ⋮ (aria-label More) | View: saves, then shows the document. Edit: shows the editor. Offline/Online: lets the page use the network (per document, kept until the app restarts). ⛶: full-screen size. ⋮: document menu. | | Status text: "Saving…", "Unsaved", "Saved ✓" (2 s, then back), "Conflict", "Not saved", otherwise "<when> · Hermes" or "<when> · You" (the age, such as "2 min ago", refreshes every 30 s while the panel is open and the page is visible) |
| Rewrite banner | Spinner and "Hermes is rewriting this document… Ns" | | | While Hermes writes into the open document |
| Conflict banner | "Hermes changed this document while you were editing." with buttons "Use Hermes’s" and "Keep mine" | Use Hermes’s: drops your unsaved text and reloads. Keep mine: reloads, puts your text back and saves it over Hermes's. | | Shown when Hermes changed a document you have unsaved edits in, or a save fails with a conflict |
| Body | The document: a viewer, or the editor in Edit | Tapping links in a text document opens them (`Linked`) | Selecting text in the viewer shows the selection bar | "Loading…" until the full document arrives |
| Selection bar | Label "Ask Hermes about the selection" and chips Rewrite, Shorter, Longer, Fix, Explain, Other… | A chip sends a chat message (see below). Other… asks "What should Hermes do with it?" first. | | Shown in View when more than 2 characters of the document are selected; cleared when the tab or mode changes |
| Ask bar | Text field "Ask Hermes to change “Title”…" and a send button (aria-label Send, disabled while the field is empty) | Sends the text as a chat message about this document | | Hidden in Edit |
| Exit full screen | Round button ⤓ at the top right (aria-label Exit full screen) | Back to the side size | | Only in full-screen size |

In full-screen size (`size` = `max`) the tab row, toolbar, selection bar, ask bar and conflict banner are hidden; only the document and the Exit full screen button show.

Messages sent from the panel (`send` in `CanvasPanel`): the text starts with `About the canvas document “<title>” (id <id>).` followed by the instruction. For a selection the message adds the selected text in triple quotes and "Use the canvas tool: read the document, then patch or write the change." It goes through `sendPrompt` like a typed message. The instructions are: Rewrite ("Rewrite this so it is clearer."), Shorter, Longer, Fix, Explain ("Explain this to me in the chat (do not change the document)").

**Data:** `GET /canvas` (list for a chat), `GET /canvas/doc`, `POST /canvas/doc` (create), `PUT /canvas/doc` (save text, with `base_rev`), `DELETE /canvas/doc`, `POST /canvas/rename`, `GET /canvas/version`, `POST /canvas/restore`, `POST /canvas/open-file`, `POST /canvas/save-file`, all under `/api/plugins/hermes-mobile/canvas`. File export uses `POST /api/files/upload` with `overwrite: true`. Reads the stored chat id from the store: `opening`, else `active.storedId`. No `localStorage` key; the document text lives on the phone, in the plugin's canvas store.

**Rules:** the canvas is for things the user asks to build or write; inline cards are for answers (3.9). No native `<select>` or `confirm()`: the panel uses `confirmDialog` and `promptDialog` (`web/src/dialog.tsx`) and `Sheetish` bottom sheets.

#### Document types and how each shows (`DocView`)

`DocView` (`web/src/components/DocView.tsx`, props `type`, `lang`, `title`, `text`, `network`) is shared by the canvas, the Gallery viewer and the Files preview (3.14); `CsvTable` and `fenced` live in the same file.

| Type | Viewer |
|---|---|
| `markdown` | Rendered Markdown (`Markdown`) |
| `html` | Sandboxed iframe (see below) |
| `code` | Syntax-highlighted code block in the document's language (`lang`) |
| `json` | Pretty-printed (falls back to the text as written when it does not parse) in a json code block |
| `mermaid` | Rendered diagram (mermaid code block) |
| `csv` | Table; the first row is the header; at most 2,000 rows; "Empty table" when there is no data |
| `svg` | Shown as an image from a `data:` URL |
| `text` | Preformatted text with tappable links |

Code, json and mermaid are wrapped in a fence long enough that backticks inside the document cannot close it (`fenced`).

New documents you create yourself (New document sheet) can be: Notes / document (markdown, "Markdown with a live preview"), Web page (html, "HTML you can run right here"), Code (a source file, language python), Plain text ("Just text"). After the title prompt ("New notes / document" etc., button Create) the document opens in Edit. The other types (json, csv, svg, mermaid) come from Hermes or from a file.

#### HTML runs in a sandbox (`HtmlFrame`)

- The page is an `<iframe sandbox="allow-scripts allow-forms allow-modals" referrerPolicy="no-referrer">` with `srcDoc`. It has no access to the app (no same-origin) and no access to the phone bridge.
- A guard script is inserted first, right after the doctype, before any script of the page: it deletes `window.HermesAndroid`, reports errors (`hmCanvasError`, shown in the page header as "⚠ message"), replaces `alert()` with a message to the parent (`hmCanvasAlert`, shown as an app toast of up to 300 characters for 5 s), and turns link clicks into a message (`hmCanvasLink`). Links inside the frame would otherwise load the site inside the frame, so the parent asks "Open link?" (button Open) and then opens it outside the app with `openExternal`. Only `http` and `https` links are accepted.
- Offline (default): a `Content-Security-Policy` meta tag allows `default-src 'none'`, inline scripts and styles, images from `data:` and `blob:`, fonts from `data:`, media from `data:` and `blob:`, and sets `form-action 'none'` and `base-uri 'none'`. The Online toggle drops this tag for that document.
- The Gallery viewer uses the same frame and always offline (3.8).
- The same component shows the inline preview in chat replies (3.3, `autoHeight`): always offline. With `autoHeight` the guard also posts the page's height (`hmFrameHeight`, a `ResizeObserver` plus once on load) and the frame is set to that height, clamped between a minimum and a maximum (`frameHeight` accepts finite numbers only). The `message` listener only reads messages whose `source` is this frame's `contentWindow`, and only the keys `hmCanvasError`, `hmCanvasAlert`, `hmCanvasLink` and `hmFrameHeight`.

#### Editor (`Editor`)

- A text area (monospace unless the document is markdown; spell-check and sentence capitals only for markdown) with a bar above it: Undo and Redo (aria-labels Undo, Redo; a stack of up to 100 states; typing faster than 700 ms apart is one step). For markdown documents it also shows a separator and eight buttons that wrap the selection: Bold, Italic, Heading, Bullet list, Checklist, Quote, Code, Link.
- Every change calls `editDoc`, which saves 0.8 s after you stop typing (`flushSave`, `PUT /canvas/doc` with the revision you started from). Switching to View, switching tab, closing the panel or switching chat saves at once. An edit typed just before switching chats is saved to the chat it belongs to.
- If Hermes (or a restore) changes the document while you are not typing, the editor follows it. If you have unsaved edits, the conflict banner shows instead (see the table above).
- A failed save shows the status "Not saved" and an error toast; a save the server refuses because the revision moved shows "Conflict".

#### Document menu (⋮ More)

A bottom sheet titled with the document's title (`DocMenu`, built on `Sheetish`):

| Row | What it does |
|---|---|
| Rename | Asks "Rename document" (field Title, button Rename), then `POST /canvas/rename` |
| Version history | Sub-line "N version(s)". Opens the history sheet. |
| Section Share and save: Copy | Copies the text; toast "Copied" |
| Share… | Android share sheet (`shareText` bridge call); in a plain browser the toast "Copied (sharing works in the phone app)" shows (the canvas's own helper does not copy; the gallery's does) |
| Save a copy to Downloads | Writes `<title>.<ext>` into `/sdcard/Download` through `POST /api/files/upload`; toast "Saved to Downloads/<name>". Extensions: md, html, txt, json, csv, svg, mmd; for code the language's extension (py, js, ts, sh, rs, go, java, kt, c, cpp, css, sql, yml) or txt. |
| Save to the original file | Only for a document opened from a file (it has a `path`; the sub-line shows the path). Saves a pending edit, then `POST /canvas/save-file`; toast "Saved to <path>". |
| Open a file from the phone… | Closes the canvas and opens the Files screen; there, a text file has "Open in canvas" |
| Close this document | Confirm "Close “Title”?" (the document is removed from the canvas with its history; a saved file on the phone is not touched), then `DELETE /canvas/doc`. When it was the last document, the panel closes. |

#### Version history and restore

- The sheet "Version history" (`HistorySheet`) lists versions newest first. Each row shows who made it (Hermes or You), "Version N" (with " · current" on the newest), the age and an optional note.
- Tapping a row opens its body: "Changes from this version to the current one" as a line diff (`lineDiff`, shown with `DiffView`; two lines of context; a whole-block replace for very large texts). The text of the old version is fetched with `GET /canvas/version`.
- On an older version a button "Restore this version" asks "Restore version N?" ("The current text is kept in the history, so you can come back.", button Restore). Restoring calls `POST /canvas/restore`, reloads the document, closes the sheet and shows the toast "Version restored". It drops any unsaved edit and the writing state.

#### While Hermes writes (events from `web/src/gateway.ts`)

1. `tool.generating` with the name `canvas`, `tool_call` or `mcp__tool_call` calls `canvasWritingStarted`. The panel is not open yet, so after 1.5 s of still writing it opens on the writing state (a short read or list call finishes before that).
2. `tool.start` brings the real name and arguments (`canvasCallStarted`). If it is not a `canvas` call with action `create` or `write`, the guess is undone (the panel closes again if it was opened only for this). Otherwise the title and the document text so far show in the writing state.
3. `tool.complete` for `canvas` calls `canvasToolDone`: it refreshes the list, then opens the document if the tool says it should be shown or the action was `write` or `patch` while the panel is open. If the panel is closed it shows an info toast: "Hermes added a document to the canvas" or "Hermes updated the canvas". A `create` also refreshes the gallery list (`galleryToolDone`).
4. When the turn ends the writing state is cleared (`canvasWritingDone`); a panel opened only for a call that wrote nothing closes again.

#### Sync and per-chat scope

- Each chat has its own canvas. `syncSession` follows the open chat. Switching to a different chat closes the panel and clears its documents; when the chat was the one that was still opening, the id is the same and nothing resets.
- While the panel is open and the page visible, the list is refreshed every 6 s (`startCanvasSync`), because another device or a scheduled job could change a document. Nothing polls while the panel is closed. Hermes's own edits arrive through the tool event, not through polling.
- Creating a document without a chat shows the warning "Send a message first: the canvas belongs to a chat".

**Limits:** needs a plugin new enough to have the `/canvas` routes; with an older plugin calls fail with an error toast.
