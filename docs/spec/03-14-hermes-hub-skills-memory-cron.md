### 3.14 Skills, Memory, Scheduled, Files, Projects (and the Library page)

**Source files:** `web/src/components/Screens.tsx` holds `SkillsScreen`, `MemoryScreen`, `CronScreen`, `FilesScreen`, `ProjectsScreen` and the shared pieces `ScreenShell`, `EmbeddedShell`, `Sheet`, `Status`, `useLoader` (see 3.20). `web/src/components/Library.tsx` holds `LibraryScreen`. `App.tsx` mounts the screen that matches the store's `screen` value (`skills`, `memory`, `cron`, `library`). Skills, Memory and Scheduled apply to the open bot: with more than one bot their top bar names it (`BotTag`, 3.20); with one bot it shows nothing. Each empty list is an empty state (`EmptyState`, 3.20): what the thing is and how to start, with one gold button. On wide screens the content keeps a centred maximum width, list rows and card buttons are at least 44 px tall, and Light text reaches 4.5:1 (`web/src/pages.css`). The Hermux hub page that once listed these (one card each, with a summary) is gone: the side panel's rows (3.13) open Scheduled and Skills, the Library row opens the Library, and the bot sheet opens Memory (decision: [side-panel-layout.md](../decisions/side-panel-layout.md)).

#### Library
**Opens from:** the side panel's Library row; the Canvas panel's "Open a file from the phone…" (3.7; opens it on Files). **Closes with:** the Back arrow or Android Back (to the chat; in Files Android Back first goes up one folder). **Source:** `Library.tsx` `LibraryScreen`, `web/src/library.ts` (`openLibrary`, `savedPart`, `savePart`).

**Layout, top to bottom:** title "Library"; a three-way switch (`Segmented`, each button `aria-pressed`): **Canvases**, **Files**, **Projects**; the chosen part's content. A part is the page it was before shown without its own title bar (`ScreenShell` inside `EmbeddedShell` draws only its children): its top-bar buttons move into the Library's bar (`.lib-actions`): Files has Upload and New folder, Projects has New project, Canvases has none. The last part is remembered in `localStorage` `hm.libraryPart` (`canvases`, `files` or `projects`; written when the part changes or the canvas panel opens Files; unknown or absent = Canvases). Canvases is the gallery (3.8), Files is the file browser and Projects the project list, both below.

#### Skills
**Opens from:** the side panel's Skills row (value "N on"). **Closes with:** Back (to the chat). **Source:** `Screens.tsx` `SkillsScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Title | "Skills · N/M on" (the count is hidden until loaded) | | | |
| Search skills… | Text field | Filters by name, description and category | | |
| Enabled | Pill button; filled when on | Shows only enabled skills | | |
| Category groups | A heading with the category name (default group "general") and its count; groups are sorted A–Z | | | With no skills at all, the empty state "No skills yet": "Skills teach Hermux how to do a job. Ask Hermux to make one, or turn on one it comes with." and the button "Ask Hermux to make one", which puts "Make a skill that " into the composer and returns to the chat; "No skills match" when the search or Enabled hides every skill; an error notice; "Loading…" |
| Skill row | Name, description | Opens the skill sheet | | |
| Switch (`aria-label` "Enabled") | Toggle on the right of the row; it takes taps over 44 px of height | Flips the skill at once and calls `PUT /api/skills/toggle` with `{ name, enabled, profile }`; if the call fails the switch flips back and a toast shows the error | | |

Skill sheet (title = skill name): a dim line "<category> · <provenance, default local> · used N×", the skill's Markdown (from `GET /api/skills/content`; the YAML front matter is removed) and two buttons: Close, and Use in chat. Use in chat puts `/<skill name> ` into the composer (`onUse`) and returns to the chat.
**Data:** `GET /api/skills`, `PUT /api/skills/toggle`, `GET /api/skills/content` (Hermes dashboard, scoped to the profile).

#### Memory
**Opens from:** the bot sheet's row "What <bot> remembers" (3.13); Settings → Behaviour → Memory → "See what Hermux remembers" (3.15), where it shows inside Settings (its own bar dropped through `EmbeddedShell`, its Add button in the Settings top bar). **Closes with:** Back (to the chat; from Settings, back to Behaviour). **Source:** `Screens.tsx` `MemoryScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "Add") | Top-bar button | Opens the "New memory" sheet | | |
| Memory / About you | Two-segment switch | Chooses Hermux's notes (`memory`) or the notes about the user (`user`) | | |
| Usage bar | A bar, then "<used> / <limit> characters · N entries" | | | The bar turns red above 92 % |
| Entries | One button per saved entry; entries starting with "Mac:" or "Phone:" get a device style | Opens the "Edit memory" sheet | | Empty: the empty state "No notes yet" ("Hermux keeps notes here as it learns how you work. Add the first one yourself.") or, on About you, "Nothing about you yet" ("Hermux keeps notes here as it learns about you. Add the first one yourself."), each with the button "Add a memory", which opens the "New memory" sheet |
| Footnote | "Synced with your Mac. Start an entry with “Phone:” to keep it on this phone only." | | | |

Sheet ("New memory" / "Edit memory"): a text area, a live character count, and buttons. Delete (edit only) asks "Delete this memory?" ("Hermux will forget it.") and removes the entry. Save is disabled while the text is empty, unchanged, or a request is running. Saving calls `POST /memory` with `{ action: add | replace | remove, target, content, old_text }`; the plugin applies it to the profile's Hermes memory store and returns fresh snapshots. Toast "Saved" / "Removed"; if Hermes refuses, its error shows in a toast.
**Data:** `GET /memory` and `POST /memory` (plugin routes under `/api/plugins/hermes-mobile`).

#### Scheduled
**Opens from:** the side panel's Scheduled row (value: the next run). **Closes with:** Back (to the chat). **Source:** `Screens.tsx` `CronScreen`, `web/src/jobwords.ts` (`whenWords`, `nextRunWords`, `lastRunWords`, `lastFailed`, `jobPaused`). The page title is "Scheduled" (once "Cron jobs").

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "New job") | Top-bar button | Opens the "New scheduled job" sheet | | |
| Job card | Name (else the first 60 characters of the prompt, else the id) with an "active" or "paused" tag; then, leading, the next run in words (`nextRunWords`: "Next run today 09:00", "Next run tomorrow 09:00" or "Next run 3 Dec, 09:00"; "No next run planned"; for a paused job "Paused: it won’t run until you resume it"); the last result in words (`lastRunWords`: "Last ran yesterday 09:00: it worked", "…: it failed" in red, another status in plain words, or "Hasn’t run yet"); then the schedule in dim monospace and up to 240 characters of the prompt. A paused job is dimmed. The card's buttons are 44 px tall | | | Empty: the empty state "Nothing scheduled yet" ("A scheduled job runs a request on its own at the times you choose, on this phone, and tells you when the result is ready.") with the button "New scheduled job", which opens the "New scheduled job" sheet |
| ▶ Run now | Card button | `POST /api/cron/jobs/<id>/trigger`, toast "Started" | | |
| Pause / Resume | Card button | `POST …/pause` or `…/resume`, toast "Paused" / "Resumed" | | |
| Runs | Card button | Opens the "Runs · <name>" sheet | | |
| Edit | Card button | Opens the sheet "Edit job" filled with the job | | |
| Delete | Red card button | Confirms `Delete “<name>”?` ("The scheduled job is removed."), then `DELETE /api/cron/jobs/<id>`, toast "Deleted" | | |

Create / edit sheet ("New scheduled job" / "Edit job"): fields Name, Schedule, a row of example chips (every 30m, every 2h, 0 9 * * *, 0 8 * * 1-5, tomorrow 9am) that fill the schedule, "What should Hermux do?" (the prompt) and the note "Runs on the phone. Results are saved locally and you get a notification." Buttons: Cancel, and Schedule / Save, disabled until the schedule and the prompt are filled. New jobs are sent with `POST /api/cron/jobs` and `deliver: "local"` (toast "Scheduled"). Edit uses `PUT /api/cron/jobs/<id>` with `{ updates }` (toast "Saved"); when the dashboard answers 404 or 405 it creates a new job and deletes the old one (toast "Saved as a new job"; the old run history stays with the old id).

Runs sheet ("Runs · <name>", `GET /api/cron/jobs/<id>/runs?limit=20`): one card per run with title / status, start time and a preview or "N msgs · reason". "No runs yet" when empty. Tap a run: if it has a chat (the dashboard lists runs as chats with source `cron`) the screen closes and that chat opens; otherwise a sheet shows its saved output (inline text, else the file read through `GET /api/files/read`, else the preview or "This run saved no output.").

#### Files
**Opens from:** the Library's Files part. **Closes with:** Back (leaves the Library). Android Back first goes up one folder; at a root chip or `/` it leaves the screen (when a preview or the new-folder field is open it closes that first). **Source:** `Screens.tsx` `FilesScreen`, `web/src/filekind.ts`. A file's preview goes through `DocView` (or `HeldScope` for plain text) with an unknown chat: once the app has recorded any phone-data read (`phoneDataAnyRead`), an HTML file is not run (its source shows as text), remote images wait behind a tap and links ask first, and the shell's request filter is on while the preview is open (2.3).

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ⤒ (`aria-label` "Upload") | Top-bar button | Opens the Android file picker (a hidden file input, several files allowed). Each file is read as a data URL and sent with `POST /api/files/upload` (no overwrite); toast "Uploaded <name>" or the error. The list reloads | | |
| ＋ (`aria-label` "New folder") | Top-bar button | Shows the inline form | | |
| Root chips | Phone (`/sdcard`), Downloads (`/sdcard/Download`), Photos (`/sdcard/DCIM`), Documents (`/sdcard/Documents`), Hermux (`/root/.hermes`), Home (`/root`) | Jump to that folder | | The screen starts at `/sdcard` |
| Breadcrumbs | `/` (`aria-label` "Top folder") and one button per path part | Jump to that folder | | |
| New-folder form | Field "Folder name", Create button, ✕ button (`aria-label` "Cancel") | Create calls `POST /api/files/mkdir`; names containing `/` are ignored | | Enter also creates |
| ".." row | Shown when the folder has a parent | Goes up | | |
| File / folder rows | Icon (📁 folder, 🖼 image, 📄 document, 🎞 audio or video, 📦 other), name, then "Folder" or the size, plus the modified time | Folder: enter it. File: open the preview sheet | | "Empty folder", an error notice, "Loading…" |

Preview sheet (title = file name, path in monospace). What shows is decided by `previewKind` (`web/src/filekind.ts`) from the extension (upper case counts), then from the MIME type for unknown extensions:
| Files with | Preview |
|---|---|
| `.csv`, `.tsv` | Table (the same `DocView` as the canvas; the delimiter is read from the first line) |
| `.json` | Pretty-printed JSON |
| `.mmd`, `.mermaid` | Rendered diagram |
| `.html`, `.htm` | The page, in the offline sandbox (`HtmlFrame` with `network` off, no `allow-same-origin`); "Open in canvas" is where network can be allowed |
| code (`py`, `js`, `ts`, `tsx`, `jsx`, `sh`, `zsh`, `bash`, `java`, `kt`, `c`, `h`, `cpp`, `rs`, `go`, `rb`, `css`, `xml`, `sql`, `yaml`, `yml`, `toml`) | Highlighted code; the language is the extension, mapped to the highlight.js name (`yml` to `yaml`, `kt` to `kotlin`, `rs` to `rust`, `rb` to `ruby`, `sh` to `bash`, `h` to `c`, `tsx` to `typescript`, `jsx` to `javascript`) |
| `.md`, `.markdown` | Rendered Markdown |
| `.txt`, `.ini`, `.cfg`, `.conf`, `.log`, `.env`, `.gitignore`, or any `text/*` type | Plain text, up to 200,000 characters |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`, or any `image/*` type | The image inline |
| `.mp3`, `.m4a`, `.ogg`, `.wav`, `.flac`, `.mp4`, `.webm`, `.mov`, `.mkv` | A player (`Media`). The file is not read into the page (it streams from the phone), so there is no size limit |
| `.pdf`, Office files, everything else | "No preview here. Use Open with… to view it in another app." |

Files read into the page (everything except players) over 3 MB say "Too large to preview (<size>)." Buttons: Delete (confirms, then `DELETE /api/files`), Open with… (the `openFile` bridge call, which uses `termux-open`; outside the app the toast says "Open works in the phone app"), Open in canvas (documents read as text only: disabled when `canvasOpenBlockReason` flags a refused path — `/proc`/`/sys`/`/dev`, `proot-distro`/`chroot-distro`, `etc/ssh`, or secret/internal segments at any depth such as `.env*`, `.netrc`, `.ssh`, `.android`, `.gnupg`, `.aws`, `.termux`, `.hermes-mobile`, or Hermes/profile auth files and `mobile/`; otherwise awaits `openFileInCanvas` and closes the preview and Files screen only when it succeeds, leaving the user in Files on refusal, 3.7) and Ask Hermux (puts "Look at the file <path> and " into the composer and returns to the chat).
**Data:** `GET /api/files`, `GET /api/files/read`, `POST /api/files/upload`, `POST /api/files/mkdir`, `DELETE /api/files` (all sent without the profile scope).

#### Projects
**Opens from:** the Library's Projects part. **Closes with:** Back (leaves the Library). **Source:** `Screens.tsx` `ProjectsScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "New project") | Top-bar button | Opens the "New project" sheet | | |
| Project card | 📁 name, an "active" tag on the active project, the description, the folder in monospace | Opens the project sheet | | Empty: the empty state "No projects yet" ("A project keeps the chats about one folder together, and Hermux works in that folder.") with the button "New project", which opens the "New project" sheet |

"New project" sheet: Name, Folder (placeholder `/root/projects/<name as slug>`; empty uses that default), Description (optional); Cancel and Create (disabled until there is a name). Create makes the folder (`POST /api/files/mkdir`, errors ignored) and calls the `projects.create` RPC with `use: true`; toast "Project created".
Project sheet (title = name, folder path): a "Chats" list built from `projects.project_sessions` (30 chats, newest first, duplicates removed; "No chats in this project yet"); a chat opens when tapped. Buttons: Remove (confirms `Remove project “<name>”?`, "Its folder and chats are kept.", then `projects.delete`) and New chat here (`projects.set_active`, then a new chat whose working folder is the project's).
**Data:** RPCs `projects.list`, `projects.create`, `projects.project_sessions`, `projects.set_active`, `projects.delete`.

---
