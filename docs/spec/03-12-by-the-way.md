### 3.12 By the way (/btw)

**Files:** `Btw.tsx` (the sheet), `btw.ts` (side-chat state and calls), `pullbtw.ts` (the pull-up gesture).

A small side chat about the open chat, in a bottom sheet, that does not interrupt the main turn. Hermes sees the conversation so far.

**Opens from:** typing `/btw` or `/btw <question>` in the composer (handled in `sendPrompt` in `web/src/gateway.ts` before any other slash command, so it works while Hermes is answering; the question is asked at once); or the pull-up gesture below. **Closes with:** Back, a drag down on the top strip, or a tap outside. **Source:** `web/src/components/Btw.tsx` `BtwSheet`, `web/src/btw.ts` (`openBtw`, `askBtw`, `btwDone`, `closeBtw`, `clearBtw`), `web/src/pullbtw.ts` (`installPullToBtw`).

**Layout, top to bottom (sheet, 70 % of the screen height):**

| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Title | By the way | | Drag down closes | |
| Clear (right of the title, `btw-clear`) | A small pill button "Clear" | Asks "Clear this side chat?" in the app's own dialog (`confirmDialog`; Clear / Cancel); Clear calls `clearBtw`, which empties the side chat and leaves the sheet open | Its pointerdown is its own, so the sheet's drag-to-close doesn't take the tap | Off (dimmed) while the side chat is empty |
| Hint | "Ask about this chat without interrupting it. Hermes sees the conversation so far." | | | |
| List | Each exchange: your question as a bubble on the right, the answer under it as Markdown (cards are drawn but not interactive here) | | Scrolls; the newest scrolls into view | A spinner while the answer is pending; the error text in red when it failed |
| Input | A text area "Ask a quick question…" (focused on open) and a send button (aria-label Send, disabled while empty) | Send asks. Enter sends; Shift+Enter makes a new line. | | |

**How it works:**
- `askBtw` calls the gateway RPC `prompt.btw` with `{ session_id: <runtime id>, text }` and gets a `task_id`. The answer arrives later as the event `btw.complete` (handled in `gateway.ts`, which passes it to `btwDone`). A `btw.complete` that is not ours shows as a notice in the chat instead.
- Each question sees a fresh snapshot of the main chat. The last 6 earlier side answers (those without error) travel with the question as "Earlier side questions: Q/A…" followed by "New question: …", so follow-ups make sense.
- No answer within 180 s: the bubble shows "No answer came back." as an error. An empty answer shows "(empty answer)".
- The mini chat is kept per chat while the app runs: reopening it on the same chat shows the earlier exchanges; opening it on another chat starts empty. Asking needs an open chat.
- **Clear** (`clearBtw`) empties the exchanges, so the next question goes out with no "Earlier side questions". That is the whole reset: Hermes keeps nothing of the side chat between questions (each one is a fresh snapshot of the main chat; the plugin only remembers the turn ids to label the background work). An answer still on its way when Clear is pressed is dropped when it arrives: its task id stays known, so `btwDone` swallows it instead of showing it in the main chat.

#### Pull-up gesture (`web/src/pullbtw.ts`)

- Pull up past the last message of a chat: the list stretches like a rubber band, a hint "Release for a side question" fades in at the bottom, and a firm pull opens the sheet. Released early, the list springs back and nothing happens.
- **`PULL_TRIGGER_PX` = 230**: the finger must travel 230 px upward to arm the gesture (the owner asked for a firmer pull: `docs/decisions/btw-pull-up-harder.md`); at that moment the phone gives a haptic tap and the hint turns to the accent colour. Letting go while armed calls `openBtw()`. `PULL_MAX_PX` = 120 is the most the list ever stretches. `rubber(dy)` flattens the travel; `PULL_GIVE` = 0.4 is its stiffness, the share of the finger movement the list follows at first (lower is heavier), so the pull feels heavy and the list shows about 50 px of stretch when it arms. `shouldOpen` needs: the list was at its bottom when the touch began (within 2 px), a chat is open, and a travel of at least 230 px.
- The gesture starts after 8 px of upward travel. It is cancelled when the finger moves down (more than 8 px) or sideways more than 12 px and more than it moves up (that is the drawer swipe), and if the finger goes back below where it started normal scrolling resumes. It is ignored when the touch starts on an input, a dialog, an OpenUI card, a code block, a table, a formula, a diagram, a slider or the read-aloud player, or while the drawer, a screen, a sheet or the /btw sheet is open, or when no chat is open. `touchmove` is non-passive so the page does not scroll with the pull. `scrollTop` is never changed, so auto-scroll and the scroll-to-newest button are unaffected.
- Installed by the `Chat` list in `web/src/App.tsx`, and installed again when the list element changes (skeleton, empty and list states are different elements).

**Data:** gateway RPC `prompt.btw`, event `btw.complete`; no `localStorage` key.
