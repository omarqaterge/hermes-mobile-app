### 3.10 Background app card and viewer

**Files:** `BgApp.tsx` (card and viewer), `bgapp.ts` (state from the shell, the frame loop).

Hermes can drive an Android app on a hidden display (a "background app"). The shell (see section 4) owns the display and tells the page about it. The page shows a card above the composer and a live viewer.

#### Background app card (screen block)

**Opens from:** appears by itself when the shell reports a background app for the open chat. The viewer opens from the card. **Closes with:** the card disappears when the state is cleared (the turn ends, Stop, Take over); the viewer closes with Back, a drag down on its top strip, a tap outside, or the same events. **Source:** `web/src/components/BgApp.tsx` `BgApp`, `BgViewer`; state and frame loop in `web/src/bgapp.ts`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Card (between the read-aloud player and the composer) | A row: thumbnail (200 px wide frame, 📱 until the first picture arrives), "Using <app name>", the current action ("Working in the background…" when empty), a chevron › | Opens the viewer | | Aria-label "Using <app>. Open live view". Not rendered when there is no background app, or when it belongs to another chat (`bgForChat` compares the stored chat id; a chat that is still opening counts). |
| Viewer sheet | A tall sheet titled "Using <app name>": the live picture (alt "Live view of <app>"; "Waiting for the first picture…" before the first frame), the action text, and two buttons | | Drag the top strip down to close | |
| Take over | Primary button | Calls `bgAction('take_over')`: the app is brought to the real screen. Toast "<app> is on your screen now"; the viewer closes. | | |
| Stop | Red button | Calls `bgAction('stop')`: stops the background app. Toast "Stopped <app>"; the viewer closes. | | An error from the shell shows as an error toast (its text without the "error:" prefix, or "Could not do that") and the viewer stays open |

**Data:** bridge calls `bgState` (the state as JSON, without port or token; read at start and when the page resumes), `bgFrameAsync(id, maxWidth)` (answers by calling `window.__hmBgFrame(id, dataUrl)`) and `bgAction('stop' | 'take_over')` in `web/src/bridge.ts`; the shell pushes changes by calling `window.__hmBg(state)`. The state has `session` (stored chat id), `pkg`, `label` (falls back to the package name, then "an app"), `action` and `since`; a state without a `session` is ignored. The setting that allows banking, payment, password and 2FA apps is in Settings (`GET` and `PUT /bgapps`, field `allow_sensitive`); it is described in 3.15 (Section Background apps, row Allow banking, payment, password and 2FA apps).

**How frames flow (`bgapp.ts`):**
- One loop serves every consumer (card thumbnail at 200 px, viewer at 540 px); the widest consumer sets the size. Only one request is in flight; the next is scheduled so requests start at most every 500 ms (`FRAME_EVERY_MS`, `frameDelay`); a request not answered in 8 s is dropped and the loop goes on.
- The loop runs only while a consumer exists, the page is visible and a background app is set. It stops when the page is hidden and restarts when it is visible again.
- A frame is accepted only when it is a `data:image/` URL. A change of chat or app clears the old picture; an identical state does not re-render (`setBg`).

**Rules:** the card is a plain `button`; the viewer is a bottom sheet with `useSheetDrag` and `useBackHandler`, like every other sheet.
