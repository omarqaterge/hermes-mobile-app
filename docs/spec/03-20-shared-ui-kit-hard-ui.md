### 3.20 Shared UI kit + hard UI rules

**Source files:** `web/src/components/ui.tsx`, `web/src/dialog.tsx`, `web/src/components/useSheetDrag.ts`, the primitives in `web/src/components/Screens.tsx`, `web/src/components/Linked.tsx`, `web/src/theme.ts`, `web/src/backstack.ts` (the Android Back stack the sheets register with, 3.1).

**`ui.tsx` — the app's own form controls.** Nothing here uses the browser or Android defaults.
| Component | What it is | Behaviour |
|---|---|---|
| `Section` | A grouped card with an optional heading and footer text | Class `set-section`; the title is the heading |
| `Row` | One row of a section: optional icon chip, title, sub line, value, trailing control, › | With `onClick` it is a button (haptic on tap, can be `disabled`, `danger` makes the icon and title red); without it a static row |
| `IconChip`, `Tone` | The small coloured square with an emoji; tones gold, blue, green, purple, red, gray, teal | Colour comes from CSS variables |
| `Toggle` | A switch (`role="switch"`, `aria-checked`) | Haptic; its `aria-label` is the label |
| `ToggleRow` | A row whose whole width flips a `Toggle` | The switch's `aria-label` is the title when it is text, else "Toggle" |
| `PickerSheet`, `Option` | A bottom sheet listing choices with a ✓ on the current one; options may have a group heading, sub text and icon | Picking an option calls `onPick` and closes; registers with Android Back; draggable by its grip |
| `SelectRow` | A row that shows the current choice as its sub line and opens a `PickerSheet` | The replacement for `<select>` |
| `SliderRow` | A title, the formatted value and a styled range slider | The one place a range input is used; it is drawn with the app's CSS (the `--pct` fill) |
| `Collapse` | Wraps a body that opens and closes: mounts the children, then animates the wrapper's height and opacity (180 ms, Web Animations API); on close animates to 0, then unmounts (a timer of 280 ms unmounts it if the animation never reports finishing). `overflow: hidden` only while animating. Flipping `open` mid-animation continues from the current height | Used by `ToolCard`, `Reasoning` (the thought text), the todo list in `StatusBar` and the file list of `TurnChangesCard`. Not used for folded runs of tool calls, which stay instant (the chat keeps one child per item). Under `prefers-reduced-motion: reduce` it mounts and unmounts at once |
| `Chevron` | A right-pointing SVG chevron (`.chevron`) that turns 90 degrees when `open`, with a `transition: transform .18s` | Replaces the text chevrons (`▾`/`▸`) in `.chev` spans: tool run heads, `Reasoning`, the todo list, the changed-files card and the Archived row. The profile switch in the drawer keeps its text `▴`/`▾` |
| `Segmented` | A row of buttons, one selected | Used for the text-size choice in Appearance (the Memory screen's two tabs are plain styled buttons) |

**Motion.** `Collapse`, `Chevron`, the send button's face change (`face-in`: the Send, Stop, Mic, Live, Steer and Queue buttons are keyed, so a new face fades and scales in over 120 ms) and the effort bars are all switched off by the phone's own "Remove animations" setting, which reaches the page as `prefers-reduced-motion: reduce`; there is no motion setting inside the app.

**`dialog.tsx` — in-app dialogs.** `confirmDialog({ title, message, list, icon, confirmLabel, cancelLabel, danger })` returns a promise of true / false; `promptDialog({ …, placeholder, value, match })` returns the text or `null`. When `match` is set the confirm button stays disabled until the typed text equals it (type-the-name deletes). `DialogHost` (mounted once in `App.tsx`) shows the first queued request as a bottom sheet with `role="alertdialog"`; further requests wait in a queue. Cancel, the backdrop, dragging down and Android Back all answer "no". The danger style uses a 🗑 icon and the red button, labelled Delete unless `confirmLabel` says otherwise. These replace the browser's `confirm()` and `prompt()`.

**`useSheetDrag.ts`.** Every bottom sheet (`Sheet`, `PickerSheet`, the session menu, dialogs) uses this hook. A touch that starts within the top 64 px of the sheet (the grip and title strip) drags it down. Releasing after more than 110 px, or faster than 0.5 px/ms with at least 30 px, slides it off and closes it after 160 ms; otherwise it springs back.

**`Screens.tsx` primitives.** `ScreenShell` is the frame of every full screen: top bar with the Back button (`aria-label` "Back", calls `closeScreen()` or the screen's own `onBack`), the title, optional action buttons, then the body. `Sheet` is the tall bottom sheet used by every form (grip, title, content; backdrop tap, grip drag and Android Back close it). `useLoader(load, deps)` runs an async load, keeps `data`, `error`, `loading`, `reload` and `setData`, and reloads when `deps` change. `Status` shows the shared states: an error notice, "Loading…" while loading with nothing yet, or the screen's empty text.

**`Linked.tsx`.** `Linked` renders plain text with web addresses as links that open through the `openExternal` bridge call (a tap on a link stops the message bubble's own tap). Tool cards and reasoning blocks in the chat use it.

**`theme.ts`.** See Appearance (3.15): `savedTheme`, `resolveTheme`, `applyTheme`, `setTheme`, `systemDark`.

**Hard UI rules (the owner rejected the alternatives):**
- No native form controls (`<select>`, checkbox, radio, date or time inputs) and no browser `confirm()`, `prompt()` or `alert()`. Use `SelectRow` / `PickerSheet`, `SliderRow`, `Toggle` / `ToggleRow`, `Segmented` from `ui.tsx` and `confirmDialog` / `promptDialog` from `dialog.tsx`. The only native-looking inputs are text fields, the password field for keys and the hidden file input behind the Upload button.
- All colours come from CSS variables, never hard-coded, because a Light theme exists (`data-theme="light"`).
- No messaging-channel UI (Telegram and the like). The app is the only front end; the Keys and Advanced settings pages hide those fields.
- Session list gestures stay as in 3.13: swipe right Archive, swipe left Delete with confirm, ⋮ menu, long-press-drag-release reorder with no mode or handles, drag into Pinned.
- No "update Hermes" button: Hermes updates ship with an app release.
- Store selectors must never return a fresh `[]` or `{}`; no periodic loop or wake lock without a bound.

**File index for sections 3.13 to 3.20** (bare file names; all under `web/src/`, the screens and sheets in `components/`):
| File | Role |
|---|---|
| `Drawer.tsx` | The drawer panel: profile switcher, New chat, tiles, search, hosts the session list |
| `SessionList.tsx` | The chat list: groups, swipe rows, long-press-drag reorder, item menu, search hits, archive |
| `chatorder.ts` | Pure ordering of the Chats list (`orderChats`, `recentIds`) |
| `order.ts` | Pins and custom order per profile, in `localStorage` and mirrored to the plugin |
| `Screens.tsx` | The hub and the Skills, Memory, Cron, Files and Projects screens, plus `ScreenShell`, `Sheet`, `useLoader`, `Status` |
| `Settings.tsx` | The Settings screen and its pages, the model picker, key and option sheets |
| `Bots.tsx` | The Bots screen and its sheets (create, bot, SOUL.md, rename) |
| `Providers.tsx` | The provider list, provider sheet and own-endpoint sheet |
| `providers.ts` | Pure provider catalog: merges Hermes's key list, sign-ins and saved endpoints into rows |
| `Connect.tsx` | The device-code sign-in sheet and the Welcome (model step) body |
| `SignIn.tsx` | The Claude sign-in sheet and the credential-pool sign-in check |
| `Linked.tsx` | Text with tappable web addresses |
| `Setup.tsx` | The Setup check screen, the first-run flow and its three step cards |
| `setupflow.ts` | Pure setup logic: the ordered rows, the next step, installer progress parsing |
| `statusrows.ts` | The Shizuku row of the Status sheet |
| `Uninstall.tsx` | The Danger zone section, the uninstall sheet and its resume at start-up |
| `uninstall.ts` | Pure uninstall logic and the shell calls |
| `update.ts` | The in-app app-update check and install request |
| `releasenotes.ts` | Pure version comparison (`isNewer`) and the What's new sections of the changelog (`notesSince`) |
| `hermes-update.ts` | The phone's Hermes version and its match with the version the app was made for |
| `theme.ts` | The four themes and how they reach the page and Android |
| `ui.tsx` | Sections, rows, switches, pickers, sliders, segmented control, `Collapse`, `Chevron` |
| `effort.ts` | `effortLevel`: reasoning level to 0-5 for the model chip's bars |
| `dialog.tsx` | `confirmDialog`, `promptDialog` and their host |
| `useSheetDrag.ts` | Drag-down-to-close for bottom sheets |
