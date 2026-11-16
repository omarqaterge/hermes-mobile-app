# 11: Second opinion

Read [README.md](README.md) first.

**Effort:** M. **Areas:** web. **Depends on:** none.

## Goal

Under a reply, **Ask another model**: the same question goes to a model the user picks, and the two answers can be
compared on one screen. Hermux already signs in to many providers; this makes that breadth useful in the moment a
user doubts an answer.

## What exists today

- Reply actions: Copy, Read aloud, Retry, Branch (spec 3.3). `branchAt` calls `session.branch` with a message count
  and opens the new chat; `retryTurn` resends the user message.
- The model chip and its picker (`model.options`), per-chat model switching, default and fallback models.
- `session.set_hidden` hides a chat from the list. `llm.oneshot` exists in the contract (one model call, no chat).

## Owner decisions needed

1. **What about replies that used tools?** A second run would repeat the tool calls: run the commands again, use
   the app again. Recommended: offer the action only for turns **without tool calls**. Later, if Hermes lets one chat
   run with tools off, widen it.
2. **Keep the second answer?** Recommended: it lives in a hidden branch until the user chooses **Keep as a chat** or
   closes the sheet, which deletes it.

## Design

### Flow

1. The actions row of a finished reply gets **Ask another model** (icon ⚖, `aria-label` "Ask another model"), shown
   when the turn has no tool or sub-agent items and no reply is running.
2. A `PickerSheet` lists the models of the model picker, without the one that wrote the reply. The last choice is
   remembered (`localStorage` key `hm.second.model`).
3. On a choice the page:
   - calls `session.branch` with the message count **before** the user message of that turn, so the branch holds the
     conversation up to the question but neither the question nor the answer;
   - hides the branch (`session.set_hidden`) and titles it `⚖ <original title>`;
   - switches the branch to the chosen model (the same call the model chip makes for a chat);
   - sends the user's message there (with its attachments) and streams the answer.
4. The **Second opinion sheet** opens at once: a tall sheet with a `Segmented` switch **<first model> | <second
   model>** and the answer below, rendered by the same message component as the chat (Markdown, code, cards). While
   the second answer streams, its tab shows the spinner and the text as it arrives.
5. Buttons: **Keep as a chat** (unhide the branch, open it, toast "Saved as a chat"), **Copy**, and close (Back, drag
   down or ✕), which interrupts the run if needed, closes the branch's live session and deletes the branch.

### State

A new module `web/src/second.ts` holds one second opinion at a time: `{ fromChat, turnIndex, branchId, model,
status: "starting" | "streaming" | "done" | "error", text }`. The gateway already routes events by session id; the
module subscribes to the branch's events while the sheet is open and does not make the branch the active chat, so the
chat on screen is untouched.

If the app is closed mid-way, the hidden branch is left behind. On start, the page deletes hidden chats whose title
starts with `⚖ ` and that are older than a day (one `session.list` filter, no timer).

### Limits and wording

- One at a time; asking again replaces the previous one (after deleting its branch).
- An error (no key for that model, rate limit) shows in the sheet with **Try another model**.
- The cost of the second answer shows under it when Hermes reports usage, as for any reply.
- In a chat that has read phone data the action is still offered: the branch carries the same history to another
  provider, so the sheet's first line says "This sends the conversation so far to <provider>", and the branch id is
  reported as protected to the app like any child chat (Check first).

## Build steps

1. `second.ts` with the pure parts split out: `countBefore(items, turnIndex)`, `eligible(turnItems)`,
   `staleBranches(list, now)`. Unit tests `second.test.ts`.
2. The gateway work: start, stream into the module, cancel and clean up. Keep it in `second.ts` and call existing
   `gateway.ts` functions; add an export there only where one is missing.
3. `SecondOpinionSheet` in a new `web/src/components/SecondOpinion.tsx`; the action in the actions row
   (`App.tsx` / `ChatItems.tsx`, where `hasActions` is used).
4. Mock: a second model in `model.options`, `session.branch` answering with a new id, and the prompt text routed to
   a canned "second" answer when the chat is a branch. E2E in a new `35-second-opinion.cjs`.

Shared files touched: `App.tsx` or `ChatItems.tsx` (one action), `gateway.ts` (at most small exports), `styles.css`,
`mock.cjs`.

## Tests

- Unit: the count for a turn in the middle of a chat, for the first turn, after an edited message; a turn with a
  tool item is not eligible.
- E2E: the action is absent on a tool turn; pick a model, both tabs show their text; Keep opens the new chat and it
  appears in the list; closing deletes the branch (RPC log shows `session.delete`); an error state; Back closes the
  picker, then the sheet.

## Spec and changes

Spec 3.3 (the action), 3.5 (the sheet), 2.4 (`hm.second.model`), 2.2 (the hidden branch's lifetime), 2.6 or the RPC
table (calls used). `changes/` file.

## Check first

- That `session.branch` accepts a count that ends before a user message, and what it does with attachments of the
  message being resent.
- That a hidden chat can have a live session and stream without becoming the active chat in the page's store
  (sub-agent streams are a precedent).
- How a branch of a phone-data-protected chat is treated today (`phone_taint`): it should inherit the protection.

## Out of scope

Three or more models at once, a judge model that picks the better answer, second opinions on turns with tools.
