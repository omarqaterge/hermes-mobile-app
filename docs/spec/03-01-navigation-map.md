### 3.1 Navigation map

The page is one React tree (`web/src/App.tsx` `App`). There are no URLs or router. What is on screen is decided by a few fields of the store (`web/src/store.ts` `AppState`):

- `screen` (type `Screen`): a full-screen page drawn over the chat. `null` means the chat itself.
- `sheet` (type `Sheet`): one bottom sheet owned by the chat area.
- `drawer`: the side panel (the chat list, drawn as a sheet over the chat) is open.
- `requests`: the queue of questions Hermes asks the user (approval, clarify, password). The first one is drawn as a sheet that cannot be dismissed.
- `screenProfile`: the bot (profile) a Settings page is scoped to. `null` = the current profile.

The chat is never unmounted. Screens, the drawer and sheets are drawn on top of it, so the draft text, the scroll position and a running reply survive a trip to Settings.

```mermaid
flowchart TD
  Chat["Chat (screen = null)<br/>Header, banners, messages, Composer"]
  Drawer["Sessions drawer"]
  Skills["skills"]
  Memory["memory"]
  Cron["cron: Scheduled jobs"]
  Library["library: Canvases, Files, Projects"]
  Bots["bots"]
  Settings["settings"]
  Setup["setup: Setup check"]
  Welcome["welcome: setup flow"]
  Canvas["Canvas panel"]
  Btw["By the way sheet"]
  Req["Request sheet: approval, question, password"]

  Chat -->|"menu button, swipe right"| Drawer
  Drawer -->|"New chat, a session"| Chat
  Drawer -->|"Scheduled row"| Cron
  Drawer -->|"Skills row"| Skills
  Drawer -->|"Library row"| Library
  Drawer -->|"gear in the bar"| Settings
  Drawer -->|"bot sheet"| Memory
  Drawer -->|"bot sheet, Manage bots"| Bots
  Library -->|"Files: Use in chat"| Chat
  Skills -->|"Use in chat"| Chat
  Bots -->|"a bot's settings"| Settings
  Chat -->|"banner Check setup"| Setup
  Settings -->|"Setup check row"| Setup
  Chat -.->|"first run, or Hermes unreachable at start"| Welcome
  Chat -->|"canvas button, swipe left"| Canvas
  Canvas -->|"Open a file from the phone"| Files
  Chat -->|"pull up at the end of the chat"| Btw
  Chat -->|"Hermux asks the user"| Req

  subgraph Sheets["Chat sheets (store.sheet)"]
    Model["model"]
    ChatMenu["chat-menu"]
    DraftMenu["draft-menu"]
    Details["session-actions: Chat details"]
    Status["status: Backend status"]
    Rollback["rollback: File checkpoints"]
    Commands["commands (no control opens it)"]
  end
  Chat -->|"title, Chat options"| ChatMenu
  Chat -->|"Chat options on the empty screen"| DraftMenu
  Chat -->|"model chip, Add"| Model
  Chat -->|"status dot"| Status
  ChatMenu --> Details
  ChatMenu --> Rollback
  DraftMenu --> Model
  Status -->|"Setup check, Shizuku row"| Setup
```

#### Every `Screen` value

| Value | What it is | Opened from | Closes with | Described in |
|---|---|---|---|---|
| `null` | The chat (no page on top). | Start-up; Back from any screen. | Not closable. | 3.2 to 3.6 |
| `skills` | Skills list and viewer. | Side panel row Skills. | Back: chat. The button "Use in chat" fills the composer with `/<skill> ` and returns to the chat. | 3.14 |
| `memory` | Hermux's memory notes. | The bot sheet's row "What <bot> remembers" (side panel, bot at the bottom). | Back: chat. | 3.14 |
| `cron` | Scheduled jobs. | Side panel row Scheduled. | Back: chat. | 3.14 |
| `library` | The Library: Canvases (the gallery, 3.8), Files (the phone's file browser) and Projects (chat folders), behind a switch; the last part is remembered in `hm.libraryPart`. | Side panel row Library; Canvas panel row "Open a file from the phone…" (closes the canvas first; opens on Files) (`openLibrary` in `web/src/library.ts`). | Back: chat. In Files, Android Back first goes up one folder. The preview button "Use in chat" fills the composer with "Look at the file <path> and " and returns to the chat. | 3.14, 3.8 |
| `bots` | Bots (profiles) list and editor. | The bot sheet's row "Manage bots" (side panel). | Back: chat. | 3.16 |
| `settings` | Settings. Keyed by `screenProfile`, so opening it for another bot rebuilds it. | The gear in the side panel's bottom bar; a bot's page in Bots (sets `screenProfile`). | Back: chat. | 3.15 |
| `setup` | Setup check: permissions, background running, the plugin, Shizuku. | Connection banner button Check setup (shown after 10 s offline); Backend status sheet (button Setup check, and the Shizuku row when it says to set up); Settings row Setup check. | Back: chat. | 3.18 |
| `welcome` | The setup flow (first-run wizard). | `main.tsx` calls `openFirstRun` before the first paint on a fresh install; `watchFirstRun` opens it when Hermes stays unreachable on a first run (after 15 s, at once when Termux is missing or the installer is running); `checkSetupFlow` resumes it after connecting when something is missing. | Finishing or leaving the flow. | 3.18 |

`closeScreen` (`store.ts`) is the one way Back leaves a screen: it sets `screen` to `null`, so every page goes back to the chat (there is no way back to another page).

#### Sheets, panels and overlays

| Name | Kind | Opened from | Closes with | Section |
|---|---|---|---|---|
| `model` | `Sheet` value, `ModelSheet` | Model chip in the composer; the "Add" picker's first row. | Drag down on the top strip, tap outside, Android Back. Picking a model closes it. | 3.5 |
| `chat-menu` | `Sheet` value, `ChatMenuSheet` (`ChatMenu.tsx`) | Header Chat options button. | Same. | 3.5 |
| `draft-menu` | `Sheet` value, `DraftMenuSheet` (`ChatMenu.tsx`) | Chat options on the empty new-chat screen. | Same. | 3.5 |
| `session-actions` | `Sheet` value, `SessionActionsSheet` ("Chat details") | Chat menu row Chat details. | Same. | 3.5 |
| `status` | `Sheet` value, `StatusSheet` ("Backend status") | The header title, the line under it and its status dot; Settings row Status. | Same. | 3.5 |
| `context` | `Sheet` value, `ContextSheet` ("Context window") | The context ring in the composer's model row. | Same. | 3.5 |
| `rollback` | `Sheet` value, `RollbackSheet` ("File checkpoints") | Chat menu row File checkpoints. | Same. Inside it, Back first steps from a snapshot to the list. | 3.5 |
| `commands` | `Sheet` value, `CommandsSheet` | No control sets it in the current code. The composer's "/" button opens the inline autocomplete instead (3.4). The sheet is still mounted by `App` if `sheet` is ever `commands`. | Same. | 3.5 |
| Request sheet | `RequestSheet`, driven by `requests[0]` | Hermux asks (approval, question, password, code). | Only by answering (or Skip/Cancel). Not dismissible by tap or drag. | 3.6 |
| Side panel | `Drawer`, `drawer` flag; a glass sheet over the chat (a docked column on wide screens) | Header menu button; swipe right on the chat (it follows the finger). | Tap the dimmed chat beside it, swipe left on the panel or beside it, Android Back, picking a chat or New chat. | 3.13 |
| Bot sheet | `BotSheet` in `Drawer.tsx`, over the chat after the panel has closed | The bot at the bottom of the side panel. | Same as sheets; a tap on a bot switches to it. | 3.13 |
| Canvas panel | `CanvasPanel` | Header canvas button; swipe left on the chat or the empty new-chat screen; chat menu row Canvas; code-block button Canvas. | Close canvas (✕), swipe right on its top bar (phones), Android Back (from full size Back first returns to the side size). Not by a tap outside. | 3.7 |
| By the way | `BtwSheet` | Pull up past the end of the chat; the `/btw` command. | Drag down on the top strip, tap outside, Android Back (it has no close button). | 3.12 |
| Read-aloud player | `TtsPlayer` | Starts when something is read aloud. | Close player. | 3.11 |
| Background app card | `BgApp` | Hermux drives an app on the hidden display. | Its own buttons. | 3.10 |
| Dialogs | `DialogHost` (`dialog.tsx`) | `confirmDialog` / `promptDialog` calls. | Cancel, tap outside, Android Back. | 3.20 |
| Picker sheets | `PickerSheet` (`ui.tsx`) | Auto button, Add, Copy reply. | Same as sheets. | 3.20 |
| Lightbox, diagram viewer | `Lightbox` (`Media.tsx`), `DiagramViewer` (`Markdown.tsx`) | Tap an image / a drawn diagram. | Close button, tap the dark area, Android Back. | 3.3 |
| Toasts | `toast()` in `store.ts`, drawn by `Toasts` in `App.tsx` | Any code. | Time out after 3.5 s (default). At most three are shown; a toast with the same text as one on screen is dropped. Under Full a toast that times out leaves softly (240 ms). | 3.20 |

#### The Android Back button

The Android shell calls `window.hermesBack` (`App.tsx`). It returns `true` when the page took the press. Order:

1. `backTop()` (`web/src/backstack.ts`): the top layer that registered with `useBackHandler`. Dialogs, picker sheets, the find bar, the lightbox, the diagram viewer, the Rollback snapshot view, Settings sub-pages, the canvas.
2. An open `sheet`: closed.
3. The open drawer: closed.
4. An open `screen`: `closeScreen()`.
5. Otherwise `false`, and the shell does its own thing (leave the app).

`useBackHandler(onBack, active)` pushes a handler on a stack while `active`; later registrations sit on top of earlier ones.

#### Gestures that move between layers

`web/src/swipe.ts` `installSwipeToDrawer` listens on the whole document (started once by `App`):

- Swipe right: pulls the drawer in under the finger. As soon as the finger has moved more than 10 px to the right, and more than 1.5 times as far across as down, `web/src/drawerdrag.ts` takes over (`drawerDragStart`, `drawerDragTo`, `drawerDragEnd`): the panel's right edge follows the finger, measured from where the touch began, and the backdrop darkens with it. The panel is a sheet 8 px from the left edge (`.drawer`, `web/src/panel.css`), so "closed" is its width plus 8 px to the left; with Full animations the chat behind (`.stage`) steps back by the same share (`scale` from 1 to 0.965), nothing but transform and opacity moves. While the finger is down the drawer and backdrop are moved by inline styles, with no React render per frame. On release the drawer never stays half open: a flick faster than 0.3 px/ms (over the last 100 ms) goes the way it was flicking, and a slower release goes to whichever side is nearer (past half the drawer's width opens). The drawer then animates the rest of the way with its usual transition, the `drawer` flag is set to match, and the inline styles are dropped once it has settled. A second finger or a cancelled touch (`touchcancel`) returns it to where it started. `drawerSlides` is false while the chat list is docked (wide screens, 840 px and up, column not hidden): then a swipe right past 70 px, more than twice as far across as down, only sets the `drawer` flag, as before.
- Swipe left on the open drawer or on its backdrop: pushes the drawer back the same way (`drawerDragging` tells the listener a drag is under way), with the same rules on release. It does not start on the chat rows (they have their own swipes: archive and delete, 3.13), text fields, dialogs or sliders, and a mostly vertical move there scrolls the chat list instead. A tap on the backdrop still closes the drawer.
- Swipe left (finger moves more than 70 px, and more than twice as far across as down): opens the chat's canvas when it is closed, through `openChatCanvas` like the header canvas button: on the empty new-chat screen that starts the chat first, so a swipe left there opens a canvas for notes or a draft.
- A move that goes more than 40 px down or up before it qualifies counts as scrolling and cancels the gesture.
- Apart from closing the drawer, nothing happens while a drawer, screen or sheet is open, with more than one finger, or when the touch starts inside inputs, dialogs, sheet backdrops, the canvas, the drawer, the lightbox, sliders, the chat scrubber rail, the read-aloud player, code blocks, tables, wide formulas, diagrams, OpenUI cards, or any element that scrolls sideways.
- `openChatCanvas` (also used by the header canvas button) opens the canvas. With no chat and none opening it first creates a new chat, because a canvas belongs to a chat. While a chat is still opening (cold start) it does not create one.

Pulling the chat up past its end opens the By the way sheet (`web/src/pullbtw.ts`). The chat view arms that gesture; 3.12 describes it.

#### Wide screens (tablets, unfolded foldables, landscape)

Two CSS blocks in `web/src/styles.css` turn the layout into columns. From `@media (min-width: 700px)` (upright tablets, unfolded foldables) an open canvas is a column beside the chat with a draggable divider, and a pull tab and swipe at the right edge bring it in (3.7, `web/src/splitview.ts`); the chat list stays a slide-over there. From `@media (min-width: 840px)` the chat list docks too. The panel becomes a docked 320 px column on the left (`--side`), full height and not a sheet (no rounded corners, blur, backdrop or step back) and full-screen pages (`screen`) open to the right of that column, above it (z-index 22 over the drawer's 21), so a sheet or dialog a page opens (they sit inside the page's stacking context, e.g. Settings → Uninstall Hermux) covers the whole width instead of being cut off by the column. The user can hide the column: the menu button `☰` (`aria-label` "Hide chat list" / "Show chat list" on wide screens) toggles it, and a `«` button at the top of the docked column (`aria-label` "Hide the chat list", class `side-hide`, shown only while docked) hides it from any page. `web/src/sidepanel.ts` (`setSideHidden`, `toggleSide`, `useSidePanel`) keeps the choice in localStorage `hm.sideHidden.v1` and sets `html[data-side="hidden"]` at start-up, before the first paint; every docked rule is scoped to `html:not([data-side='hidden'])`, so a hidden column means the phone layout (swipe right opens the panel over the chat as the same floating sheet as on a phone, the dimmed chat beside it closes it). The setup flow ("Set up Hermux", class `takeover`) still covers the whole width. While docked, `--side-w` is the column's width (0 otherwise); the canvas width is computed from the room beside it. The chat's text column is kept at about 820 px, with at least 52 px on the right so the scrubber stays out of the 24 px edge strip. An open canvas at its side size becomes a right-hand column (`--canvas-w`, 3.7 "Divider and width on wide screens"); full size still covers everything.

#### Entry points from outside the page

The Android shell and other code call these globals (declared in `App.tsx`, `share.ts`, `notif-answer.ts`):

| Global | Caller | What it does |
|---|---|---|
| `window.hermesBack()` | Android Back | See above. |
| `window.hermesResume()` | Shell, app returns to the foreground | Reconnects if the socket is not open (`reconnectNow`), refreshes the background-app card, and tells the open chat it is back (`noteBack`, for the "New Messages" divider). |
| `window.hermesPause()` | Shell, app leaves the foreground (`onPause`) | Notes that the open chat was seen until now (`noteAway`); messages arriving meanwhile get the "New Messages" divider on return. |
| `window.hermesOpenSession(id, draft?)` | Notification tap | `openSessionFromNotification`: remembers the chat, closes screens, sheets and drawer, resumes it (now, or right after connecting). A `draft` (an answer typed into a notification that could not be delivered) goes into the composer. |
| `window.hermesOpenBgView(id)` | Tap on the working chip while Hermux uses an app for that chat (called right before `hermesOpenSession`) | `wantViewer` in `bgapp.ts`: once that chat shows, the background-app card opens its live viewer (3.10, "Opened from the status chip"). |
| `window.hermesShared(count, text)` | Android share sheet | `receiveShare` in `share.ts`: see 3.4 "Share to Hermux". |
| `window.hermesShortcut(kind)` | Launcher shortcuts | Closes screens, sheets and drawer, starts a new chat; kind `live` also starts Live mode. |
| `window.hermesApprovalConfirm(id, result)` | `confirmApproval` or `confirmIdentity` finished | `approval-lock.ts`: the biometric or screen-lock answer (`ok`, `cancel`, `nolock`) for an Allow (3.6). |
| `window.hermesLockView(on)` | Assist gesture over the lock screen | `lockview.ts`: true while the app shows over a locked phone's lock screen (talking only, see 4.6 "Talking on the lock screen"); false once unlocked or hidden again. |
| `window.hermesAnswer(kind, session, text)` | Notification reply / question answer | `answerFromNotification` in `notif-answer.ts`: see 3.6. Returns `'y'` when the page took the answer, `'n'` otherwise. |

#### Layer order in `App`

Top to bottom in the DOM, which is also the paint order: `Header`, `LocalAlertBanner`, `ConnBanner`, `FindBar`, `Chat`, `ActivityBanner`, `StatusBar`, `CompressHint`, `TtsPlayer`, `BgApp`, `Composer`, `TrayHandle`, the open `screen`, `Drawer`, the open `sheet`, `RequestSheet`, `UninstallResume`, `CanvasPanel`, `BtwSheet`, `DialogHost`, toasts.

---
