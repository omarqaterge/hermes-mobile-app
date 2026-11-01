### 3.14 Hermes hub + Skills, Memory, Cron, Files, Projects

**Source files:** `web/src/components/Screens.tsx` holds `HubScreen`, `SkillsScreen`, `MemoryScreen`, `CronScreen`, `FilesScreen`, `ProjectsScreen` and the shared pieces `ScreenShell`, `Sheet`, `Status`, `useLoader` (see 3.20). `App.tsx` mounts the screen that matches the store's `screen` value (`hub`, `skills`, `memory`, `cron`, `files`, `projects`, `gallery`).

#### Hermes hub
**Opens from:** the ☤ Hermes tile in the drawer. **Closes with:** the Back arrow (`aria-label` "Back") or Android Back. **Source:** `Screens.tsx` `HubScreen`.

**Layout, top to bottom:** title "Hermes", then six cards in this order. Each card has a coloured icon chip, a title, a one-line summary and a › arrow.
| Card | Summary line | Tap | States |
|---|---|---|---|
| ✦ Skills | "N enabled" or "N enabled of M" (from `GET /api/skills`) | Opens Skills | |
| 🧠 Memory | "N notes · P% full · M about you", plus a thin meter bar that turns red at 90 % or more (from `GET /memory`) | Opens Memory | |
| ⏱ Scheduled jobs | "N active", then ", M paused" and " · next <time>" when known; "None yet" with no jobs (from `GET /api/cron/jobs`) | Opens the screen titled "Cron jobs" | |
| 📁 Files | Fixed text "Browse, open and upload on the phone" | Opens Files | |
| 🗂 Projects | "N project(s)" or "None yet" (from the `projects.list` RPC) | Opens Projects | |
| 🖼 Canvas gallery | "N document(s) · M categor(y/ies)" or "Every canvas shows up here" (from `GET /gallery`) | Opens the gallery (3.8) | |

Every card loads on its own, so a slow one does not hold the others: its summary says "Loading…" until it answers, or "Couldn’t load" if its call failed. The cards reload when the profile changes. A tap sets `screen` to the card and `screenBack` to `hub`, so Back from a page returns to the hub (`closeScreen` in the store).

#### Skills
**Opens from:** the hub's Skills card. **Closes with:** Back (returns to the hub). **Source:** `Screens.tsx` `SkillsScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Title | "Skills · N/M on" (the count is hidden until loaded) | | | |
| Search skills… | Text field | Filters by name, description and category | | |
| Enabled | Pill button; filled when on | Shows only enabled skills | | |
| Category groups | A heading with the category name (default group "general") and its count; groups are sorted A–Z | | | Empty text "No skills"; an error notice; "Loading…" |
| Skill row | Name, description | Opens the skill sheet | | |
| Switch (`aria-label` "Enabled") | Toggle on the right of the row | Flips the skill at once and calls `PUT /api/skills/toggle` with `{ name, enabled, profile }`; if the call fails the switch flips back and a toast shows the error | | |

Skill sheet (title = skill name): a dim line "<category> · <provenance, default local> · used N×", the skill's Markdown (from `GET /api/skills/content`; the YAML front matter is removed) and two buttons: Close, and Use in chat. Use in chat puts `/<skill name> ` into the composer (`onUse`) and returns to the chat.
**Data:** `GET /api/skills`, `PUT /api/skills/toggle`, `GET /api/skills/content` (Hermes dashboard, scoped to the profile).

#### Memory
**Opens from:** the hub's Memory card. **Closes with:** Back. **Source:** `Screens.tsx` `MemoryScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "Add") | Top-bar button | Opens the "New memory" sheet | | |
| Memory / About you | Two-segment switch | Chooses Hermes's notes (`memory`) or the notes about the user (`user`) | | |
| Usage bar | A bar, then "<used> / <limit> characters · N entries" | | | The bar turns red above 92 % |
| Entries | One button per saved entry; entries starting with "Mac:" or "Phone:" get a device style | Opens the "Edit memory" sheet | | "Nothing saved yet" when empty |
| Footnote | "Synced with your Mac. Start an entry with “Phone:” to keep it on this phone only." | | | |

Sheet ("New memory" / "Edit memory"): a text area, a live character count, and buttons. Delete (edit only) asks "Delete this memory?" ("Hermes will forget it.") and removes the entry. Save is disabled while the text is empty, unchanged, or a request is running. Saving calls `POST /memory` with `{ action: add | replace | remove, target, content, old_text }`; the plugin applies it to the profile's Hermes memory store and returns fresh snapshots. Toast "Saved" / "Removed"; if Hermes refuses, its error shows in a toast.
**Data:** `GET /memory` and `POST /memory` (plugin routes under `/api/plugins/hermes-mobile`).

#### Cron jobs
**Opens from:** the hub's Scheduled jobs card. **Closes with:** Back. **Source:** `Screens.tsx` `CronScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "New job") | Top-bar button | Opens the "New scheduled job" sheet | | |
| Job card | Name (else the first 60 characters of the prompt, else the id), an "active" or "paused" tag, the schedule in monospace, "Next: … · Last: …" with the last status, and up to 240 characters of the prompt. A paused job is dimmed | | | Empty text: "No scheduled jobs on this phone yet. Tap ＋ to create one." |
| ▶ Run now | Card button | `POST /api/cron/jobs/<id>/trigger`, toast "Started" | | |
| Pause / Resume | Card button | `POST …/pause` or `…/resume`, toast "Paused" / "Resumed" | | |
| Runs | Card button | Opens the "Runs · <name>" sheet | | |
| Edit | Card button | Opens the sheet "Edit job" filled with the job | | |
| Delete | Red card button | Confirms `Delete “<name>”?` ("The scheduled job is removed."), then `DELETE /api/cron/jobs/<id>`, toast "Deleted" | | |

Create / edit sheet ("New scheduled job" / "Edit job"): fields Name, Schedule, a row of example chips (every 30m, every 2h, 0 9 * * *, 0 8 * * 1-5, tomorrow 9am) that fill the schedule, "What should Hermes do?" (the prompt) and the note "Runs on the phone. Results are saved locally and you get a notification." Buttons: Cancel, and Schedule / Save, disabled until the schedule and the prompt are filled. New jobs are sent with `POST /api/cron/jobs` and `deliver: "local"` (toast "Scheduled"). Edit uses `PUT /api/cron/jobs/<id>` with `{ updates }` (toast "Saved"); when the dashboard answers 404 or 405 it creates a new job and deletes the old one (toast "Saved as a new job"; the old run history stays with the old id).

Runs sheet ("Runs · <name>", `GET /api/cron/jobs/<id>/runs?limit=20`): one card per run with title / status, start time and a preview or "N msgs · reason". "No runs yet" when empty. Tap a run: if it has a chat (the dashboard lists runs as chats with source `cron`) the screen closes and that chat opens; otherwise a sheet shows its saved output (inline text, else the file read through `GET /api/files/read`, else the preview or "This run saved no output.").

#### Files
**Opens from:** the hub's Files card. **Closes with:** Back. Android Back first goes up one folder; at a root chip or `/` it leaves the screen (when a preview or the new-folder field is open it closes that first). **Source:** `Screens.tsx` `FilesScreen`, `web/src/filekind.ts`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ⤒ (`aria-label` "Upload") | Top-bar button | Opens the Android file picker (a hidden file input, several files allowed). Each file is read as a data URL and sent with `POST /api/files/upload` (no overwrite); toast "Uploaded <name>" or the error. The list reloads | | |
| ＋ (`aria-label` "New folder") | Top-bar button | Shows the inline form | | |
| Root chips | Phone (`/sdcard`), Downloads (`/sdcard/Download`), Photos (`/sdcard/DCIM`), Documents (`/sdcard/Documents`), Hermes (`/root/.hermes`), Home (`/root`) | Jump to that folder | | The screen starts at `/sdcard` |
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

Files read into the page (everything except players) over 3 MB say "Too large to preview (<size>)." Buttons: Delete (confirms, then `DELETE /api/files`), Open with… (the `openFile` bridge call, which uses `termux-open`; outside the app the toast says "Open works in the phone app"), Open in canvas (documents read as text only: closes the screen and opens the file in the canvas, 3.7) and Ask Hermes (puts "Look at the file <path> and " into the composer and returns to the chat).
**Data:** `GET /api/files`, `GET /api/files/read`, `POST /api/files/upload`, `POST /api/files/mkdir`, `DELETE /api/files` (all sent without the profile scope).

#### Projects
**Opens from:** the hub's Projects card. **Closes with:** Back. **Source:** `Screens.tsx` `ProjectsScreen`.

**Layout, top to bottom:**
| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| ＋ (`aria-label` "New project") | Top-bar button | Opens the "New project" sheet | | |
| Project card | 📁 name, an "active" tag on the active project, the description, the folder in monospace | Opens the project sheet | | Empty text: "No projects yet. A project groups chats around a folder — tap ＋ to create one." |

"New project" sheet: Name, Folder (placeholder `/root/projects/<name as slug>`; empty uses that default), Description (optional); Cancel and Create (disabled until there is a name). Create makes the folder (`POST /api/files/mkdir`, errors ignored) and calls the `projects.create` RPC with `use: true`; toast "Project created".
Project sheet (title = name, folder path): a "Chats" list built from `projects.project_sessions` (30 chats, newest first, duplicates removed; "No chats in this project yet"); a chat opens when tapped. Buttons: Remove (confirms `Remove project “<name>”?`, "Its folder and chats are kept.", then `projects.delete`) and New chat here (`projects.set_active`, then a new chat whose working folder is the project's).
**Data:** RPCs `projects.list`, `projects.create`, `projects.project_sessions`, `projects.set_active`, `projects.delete`.

---
