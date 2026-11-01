### 3.8 Gallery

**Files:** `Gallery.tsx` (screen, viewer, item menu), `gallery.ts` (list, search, rename, delete, open the chat).

Every canvas document of every chat and every profile in one list. Nothing is copied: the plugin searches the canvas store. Old "Library" copies (saved by older app versions, nothing new is saved) are listed too.

#### Canvas gallery (screen block)

**Opens from:** Hermes hub → the row Canvas gallery (`HUB` in `web/src/components/Screens.tsx`; `Screen` value `gallery`). **Closes with:** Back in the top bar (`ScreenShell`). **Source:** `web/src/components/Gallery.tsx` `GalleryScreen`, state in `web/src/gallery.ts` (`useGallery`).

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Top bar | Back arrow and the title Canvas gallery | Back closes the screen | | |
| Search field | "Search titles and text…" | Typing searches on the server 300 ms after the last key: `GET /gallery?q=<text>`. Hermes searches titles and text. | | The box is empty each time the screen opens; the last search is not kept |
| Type chips | `All N` and one chip per type with its count (HTML, Markdown, Code…). With 3 or fewer chips they show as a segmented control, with more as a scrolling row of pills. | Filters the list to that type (client-side) | | Not shown without items. A filter on a type that has nothing left falls back to All. |
| Status text | Plain text line | | | "Loading…" until the first answer (an unreachable Hermes keeps the loading state and shows its error text, never "empty"); with no items: `Nothing matches “<query>”.` after a search, otherwise "Nothing here yet. Everything Hermes or you put on a chat’s canvas shows up here." |
| Cards | A grid. Each card: type icon, type name, title, a snippet when there is one, and a line "💬 <chat title> · <age>", or "Saved copy · <age>" for an old copy that never had a chat, or "Chat deleted · <age>" | Opens the viewer | | |

Viewer (`Viewer`, a tall sheet titled with the item's title):

| Element | Looks like | Tap | States |
|---|---|---|---|
| Info line | `<icon> <type> · from “Chat title” (archived) · <age>`; "saved copy" for old copies without a chat; "a deleted chat" when the chat is gone | | |
| Open canvas | Primary button | Switches profile if the chat belongs to another one, opens the chat, and opens its canvas on this document (side size) | Not shown for old copies or when the chat is gone |
| Go to chat | Button | Opens the chat the document was made in (same profile switch). If the chat no longer exists: error toast "The chat this was made in no longer exists". | Shown when the chat exists |
| ⋮ | Icon button, aria-label Item options | Opens the item menu | |
| Body | The document through `DocView` (HTML runs offline in the same sandbox as on the canvas, never with network) | | Spinner while loading; error box with the message if it fails |

Item menu (`ItemMenu`, a sheet titled with the item's title):

| Row | What it does |
|---|---|
| Rename | Asks "Rename" (field Title); `POST /canvas/rename`, or `PUT /library/item` for an old copy; then reloads the list |
| Section Share: Copy | Copies the text (shown once the text has loaded) |
| Share… | Android share sheet; in a browser it copies |
| Delete | Confirm `Delete “Title”?` with "This saved copy is removed. The chat is not touched." for an old copy, otherwise "It is removed from the canvas of “Chat title”. The chat itself is not touched." Then `DELETE /canvas/doc` (or `DELETE /library/item`), closes the viewer and reloads. |

**Data:** `GET /gallery` (optional `q`), `GET /library/item?id=` and `DELETE /library/item?id=`, `PUT /library/item` for old copies, plus the `/canvas` routes of 3.7. The list refreshes by itself when Hermes creates a document and the list is already loaded (`galleryToolDone`), and after rename or delete (also the open canvas's list if the item belongs to the open chat). If a newer search is typed while one is in flight, the older answer is dropped. After a search, opening the screen again starts from an empty box and an empty list (so the leftover search result is not shown as "everything").

**Rules:** no native `<select>`; the type filter uses `Segmented` or pills.
