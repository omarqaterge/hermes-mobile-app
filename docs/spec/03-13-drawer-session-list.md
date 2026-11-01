### 3.13 Drawer + session list

The drawer is the left-hand panel with the profile switcher, the New chat button, three navigation tiles and the list of chats. It is always mounted (`App.tsx` renders `Drawer`); the `drawer` flag in the store (`web/src/store.ts`) slides it in.

**Source files:** `web/src/components/Drawer.tsx` (`Drawer`), `web/src/components/SessionList.tsx` (`SessionList`, `SwipeRow`, `useDrag`, `SessionMenu`), `web/src/chatorder.ts` (`orderChats`, `recentIds`), `web/src/order.ts` (`useOrder`, `updateOrder`), `web/src/unread.ts` (`ago`, `lastActive`; used here for the "time ago" text), `drawerdrag.ts` (the drawer following the finger on a swipe).

#### Drawer
**Opens from:** the Sessions button in the chat header (`aria-label` "Sessions", or "Sessions (unread chats)" when a chat finished while you were elsewhere); a swipe right on a chat, which slides it in under the finger (`web/src/swipe.ts`, `web/src/drawerdrag.ts`; 3.1 has the rules); switching profile closes it. **Closes with:** tapping the dimmed backdrop, a swipe left on the drawer (not on a chat row) or the backdrop, which pushes it back under the finger, Android Back (`App.tsx` handles Back: it closes the drawer first), opening a chat, New chat, or one of the three tiles. **Source:** `web/src/components/Drawer.tsx` `Drawer`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Profile switch | Round avatar with the first letter of the profile's display name (or id), the name, a dim line under it (the profile description, or "Main profile" for `default`), a ▾ / ▴ arrow | Opens / closes the profile list | none | Falls back to the profile id while the profile list has not loaded |
| Profile list (only while open) | One row per profile: small avatar, display name, ` · model` in dim text when the profile has a model. The current profile is highlighted | A profile: haptic, closes the list, calls `switchProfile(name)` (see Data) | none | — |
| ＋ New bot / manage bots… | Dim last row of the profile list | Closes the list and the drawer, opens the Bots screen (3.16) | none | — |
| ＋ New chat | Full-width primary button | `startDraft()`: opens the empty new-chat screen and closes the drawer. The chat is only created when the first message is sent | none | — |
| Navigation tiles | Three tiles in a grid: ☤ Hermes, 🤖 Bots, ⚙ Settings | Haptic, then opens the screen `hub`, `bots` or `settings` (clears `screenProfile` and `screenBack`) and closes the drawer | none | — |
| Search sessions… | Text field (placeholder "Search sessions…") | Filters the list below (see Session list) | none | — |
| Session list | Scrolling area, see below | | | |

**Data:** reads `drawer`, `profiles`, `profile` from the store. `switchProfile` (in `web/src/gateway.ts`) stores the id in `hm.profile`, resets the page size to 80 chats, shows the cached list for that profile (`hm.sessions.v1.<profile>`), then loads the list and the default model from Hermes. The profile list itself comes from the `profiles.list` RPC (`loadProfiles`).
**Rules:** the Hermes tile replaces five separate drawer entries: Skills, Memory, Cron, Files and Projects live on the Hermes hub (3.14). There is no messaging-channel entry anywhere.

#### Session list
**Opens from:** inside the Drawer. **Source:** `web/src/components/SessionList.tsx` `SessionList`.

**Layout, top to bottom** (each part only appears when it has content):
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| "Loading sessions…" / "No sessions yet" | Dim text | — | — | Loading shows while the first list loads; the empty text when Hermes has no chats |
| 📌 Pinned heading + pinned rows | Heading, then the pinned chats in the saved pin order. While a chat is dragged, the block is shown even if empty and says "Drop here to pin" | Row: open the chat | See "Row gestures" | While a pinned row is dragged below the block, the heading gains " · release to unpin" |
| Chats heading + "Sort by recent" | Plain "Chats" heading. Shown only when a custom order is active (after a manual drag). The mini button "Sort by recent" sits on it | "Sort by recent" replaces the custom order with the chats sorted by their last activity right now (one-time snapshot, it stays a custom order) | — | Hidden in the default order |
| Date headings + chat rows | In the default order: Today, Yesterday, This week (under 7 days), This month (under 31 days), Older. The day is the chat's creation day, never its last activity | Row: open the chat | See "Row gestures" | Rows in the default order are newest created first |
| In messages | Appears under the chats when the search text has 2 or more characters and Hermes found matches. Each hit: chat title and a one-line snippet with the matched words highlighted | Opens that chat, then scrolls to the match (`jump` in the store, `web/src/jump.ts`) | — | Search results come 350 ms after the last key press; an error shows no group |
| Show older chats | Button; label "Loading…" while loading | Raises the page size by 100 and reloads the list. Shown only when the list is as long as the current page (80 chats at first) | — | Disabled while loading |
| 🗄 Archived (n) ▸ | Toggle button, the count appears once loaded | Opens / closes the archived list and loads it | — | "Loading…", then the rows, or "Nothing archived. Swipe a chat right to archive it." |

A session row shows, from left to right:
- a working dot (`aria-label` "Working") while the chat is running (the open chat's own turn, or any chat in the plugin's activity feed; a background memory/skills review does not count);
- an unread dot (`aria-label` "Finished, not opened yet") when the chat has more messages than you last saw, it is not the open chat and it is not working;
- 📌 for a pinned chat;
- the title (via `Title`, which also renders the branch marker), else the first-message preview, else "Untitled";
- under it, in dim text: time since last activity (now, N min, N h, N d, N wk, or a date after about two months), then ` · N msgs`, then ` · <source>` when the chat did not come from this app (`source` other than `mobile`);
- a ⋮ button on the right (`aria-label` "Chat options") that opens the item menu. It stops the pointer from starting a swipe or drag.

**Row gestures** (a row is a `SwipeRow`; touch only, no handles, no edit mode):
| Gesture | What happens |
|---|---|
| Tap | Haptic, `resumeSession(id)` opens the chat. A toast shows any error. A tap that moved more than 6 px is ignored. |
| Swipe right | The row slides and a blue "Archive" strip (🗄) shows behind it (label "Unarchive" in the archived list). Past 30 % of the row width the strip is armed and the phone ticks. Release past it: the row slides out and the chat is archived (toast "Archived"; "Restored" when unarchiving). Release earlier: it springs back (220 ms). |
| Swipe left | A red "Delete" strip (🗑) shows. Past 30 % of the width it is armed. Release past it: the row springs back and a confirmation dialog asks `Delete “<title>”?` ("The whole conversation is removed. This cannot be undone.", red Delete button). Only after the user confirms is the chat deleted (toast "Deleted"). |
| Swipe detection | A horizontal move of more than 10 px that is at least 1.3 times the vertical move starts the swipe (the pointer is captured). A vertical move of more than 10 px is a scroll. The row follows the finger up to 90 % of its width. |
| Long-press, then move | After 450 ms without moving, the phone vibrates and the row lifts. Keep the finger down and move: the row follows the finger, the others slide aside to show the gap, and the list auto-scrolls when the finger is within 72 px of the top or bottom edge of the list. Release to drop it in place. Nothing is saved while dragging: the new order is committed on release. A long-press released without moving does nothing. |
| Drag a chat up into Pinned | Drag past the bottom edge of the Pinned block (the block is highlighted and a gap opens where it will land). Release: the chat is pinned at that spot (toast "Pinned"). |
| Drag a pinned chat down out of Pinned | Drag below the block (the heading says "· release to unpin"). Release: the chat is unpinned and lands at that spot in the Chats list (a custom order is created if there was none; toast "Unpinned"). |
| Drag inside a list | Pinned: sets the pin order. Chats: while the drag is lifted the date groups merge into one flat "Chats" list so a chat can cross days; on release the new order is stored as the custom order. Dropping it back where it was restores the date groups. |

Reordering is switched off while the search field has text, and archived rows cannot be dragged. Dragging a chat to Pinned works only from the Chats list.

**Item menu** (⋮ button): a bottom sheet (`SessionMenu`, dismissable by the grip like every sheet) with the chat title and these entries:
| Entry | What it does |
|---|---|
| Rename | Swaps the list for a field "Chat title" and a Save button. Saving calls `renameStored` (`PATCH /api/sessions/<id>`), keeps any branch marker in the title (`keepBranch`) and toasts "Renamed". |
| Pin to top / Unpin | Not shown for archived chats. Pin puts the chat first in Pinned (toast "Pinned"); Unpin removes it (toast "Unpinned"). |
| Archive / Unarchive | Archive calls the `session.set_hidden` RPC with `hidden: true` (the same flag Hermes Desktop uses), drops the chat from Pinned, and starts a new draft if it was the open chat. Unarchive sets it to false. |
| Delete | Same confirmation as the left swipe. Deleting closes the chat's live sessions first (Hermes refuses to delete a live one), calls `session.delete`, removes it from Pinned and the custom order, and asks the plugin to clean up the chat's attachments (`POST /cleanup`). |

**Order and pins.** `web/src/chatorder.ts` `orderChats` sorts the unpinned chats: with no custom order, newest created first (`started_at`); with a custom order, the saved positions, and any chat missing from it goes on top, newest first. A message sent or received never moves a chat. `recentIds` builds the "Sort by recent" snapshot from `lastActive` (the time the chat's message count last changed, tracked in `hm.seen.v1.<profile>`, else its start time). `web/src/order.ts` keeps `{ pinned, manual, at }` per profile under the key family `hm.order.v1` (stored as `hm.order.v1.<profile>`), and mirrors it to the phone with `PUT /prefs` (debounced 1 s). Once per profile and run it reads `GET /prefs`: the copy with the newer `at` wins (the local copy is uploaded when it is newer). Both are routes of the Hermes Mobile plugin under `/api/plugins/hermes-mobile`.

**Search.** The field filters chats by title and first-message preview (case-insensitive substring). With 2 or more characters it also calls `GET /api/sessions/search?q=…&limit=25` after a 350 ms pause for the "In messages" group.

**Data:** RPCs `session.list` (page of 80, then +100), `session.set_hidden`, `session.delete`; archived list = `session.list` with `include_hidden` minus the normal list (limit 200 each); `GET /prefs` / `PUT /prefs`; local keys `hm.order.v1.<profile>`, `hm.seen.v1.<profile>`, `hm.sessions.v1.<profile>`.
**Rules (owner decisions, do not undo):** swipe right = Archive, swipe left = Delete with a confirm, the ⋮ menu has Pin / Archive / Delete (and Rename), reorder is long-press-drag-release with no mode and no handles, pinning is dragging into Pinned. Pin-by-swipe, long-press menus and a rearrange mode were rejected.

---
