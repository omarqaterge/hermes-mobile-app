# 17: Skills: browse, install, write

Read [README.md](README.md) first.

**Effort:** L (three parts that can ship one at a time). **Areas:** web, a little plugin. **Depends on:** none.

## Goal

"It evolves with you" is the app's tagline, and today the Skills screen can only switch skills on and off. This
design lets the user **find and install** skills from Hermes's catalog, **write and edit** their own, and **turn a
chat into a skill**.

## What exists today

- `SkillsScreen`: list by category, search, an Enabled filter, a switch per skill, a sheet with the skill's text and
  "Use in chat" (spec 3.14). Data: `GET /api/skills`, `PUT /api/skills/toggle`, `GET /api/skills/content`.
- At the pinned build Hermes also has: `POST /api/skills` (create), `PUT /api/skills/content` (edit), the gateway
  call `skills.manage` with actions that include `list`, `search`, `browse` (paged), `inspect` and `install` (search,
  browse and inspect go to the shared hub; list and install use the profile's skills folder), and `skills.reload`.
- Vendored helpers in `web/vendor/hermes-shared/`: `catalog-install.ts` (the install identifier of a catalog skill),
  `skill-scaffold.ts`.
- A skill is instructions the agent will follow, and it may bring script files the agent will run. Installing one
  is closer to installing software than to saving a note.

## Owner decisions needed

1. **Installing asks for the fingerprint?** Recommended: yes, every install, like the phone-data switches. A new
   skill is installed **switched off** when the catalog's check of it is anything but clean, and the user turns it
   on after reading it.
2. **Skills with script files.** Recommended: installable, but the preview lists every file and shows scripts in
   full, with a plain warning line.
3. **"Make a skill from this chat": who writes it?** Recommended: the agent drafts it in the chat with Hermes's own
   skill-writing support, and the user reviews it in the editor before it is saved. Nothing is saved by the agent
   directly from this button.

## Part 1: write and edit

- Skills screen: ＋ (`aria-label` "New skill") opens the **editor** (`web/src/components/SkillEditor.tsx`): Name
  (lower case, digits, dashes; checked against existing names), Description (one line, required: it is what the
  agent reads to decide when to use the skill), Category (`PickerSheet` of existing categories plus "New…"), and the
  body as a Markdown text area with a Preview switch.
- Save builds the file (front matter with name and description, then the body) and calls `POST /api/skills`; then
  `skills.reload`. Errors from Hermes show in a toast and the editor stays open.
- The skill sheet gets **Edit** for local skills (provenance local): the same editor filled in, saving with
  `PUT /api/skills/content`. Built-in and installed skills show "Copy to edit" instead, which opens the editor on a
  copy named `<name>-mine`.
- **Delete** for local skills, with a confirm dialog (through the route Hermes offers; if there is none, the Files
  API on the skill's folder, which the skill list already reveals).
- A draft is kept in `localStorage` (`hm.skill.draft`) until saved or discarded, so leaving the app doesn't lose it.

## Part 2: browse and install

- The Skills screen gets a `Segmented` switch **Yours | Browse**.
- **Browse:** a search field (`skills.manage` `search`, sent 400 ms after typing stops), and without a query the
  catalog's pages (`browse`, "Load more" at the end, never automatic). Rows: name, one-line description, source, and
  an "Installed" tag when the name is already present.
- **Preview sheet** (`inspect`): the description, the full skill text rendered through the sanitized Markdown
  renderer, the list of files with sizes, each script openable as highlighted text, the source and author, and the
  result of the catalog's check (clean, warnings with their text, or "not checked").
- **Install:** a confirm dialog "Install <name>? Hermux will follow these instructions when it uses the skill."
  plus, when it has scripts, "It includes N script files Hermux may run." Then the fingerprint (`ApprovalLock`
  through the bridge call the approval lock uses), then `skills.manage` `install` with the identifier from
  `skillCatalogInstallIdentifier`. A spinner on the button; on success `skills.reload`, toast "Installed", and the
  switch state per decision 1.
- Installed skills show their source in the list ("from the catalog") and **Remove** in their sheet.
- Catalog text is outside text: it is shown, never sent into a chat by this screen, and links ask before opening.
- Offline or a hub error: "The catalog can't be reached. Your skills still work."

## Part 3: a skill from a chat

- Chat menu: **Make a skill from this chat**. It sends a fixed message in that chat (visible to the user): a request
  to write a reusable skill from what was done, as one fenced block in the skill file format, without saving
  anything. If `skill-scaffold.ts` offers the wording Hermes's own clients use, use it.
- When a reply contains exactly one fenced block that parses as a skill file (front matter with `name` and
  `description`), the block gets a button **Review and save**, which opens the editor from Part 1 filled with it.
  Saving is the user's tap there.
- The parse is strict and pure (`parseSkillFile` in `web/src/skillfile.ts`): unknown front-matter keys are kept as
  text, a missing name or description disables Save.

## Build steps

1. `skillfile.ts` (build and parse, name rules) with unit tests.
2. Part 1: the editor, the screen's ＋, Edit, Copy to edit, Delete.
3. Part 2: `web/src/skillhub.ts` (the calls and their result types, taken from the pinned contract in
   `gateway-contract.generated.ts`), the Browse tab, the preview sheet, install.
4. Part 3: the menu entry and the block button (`Markdown.tsx` code blocks have a button bar already).
5. Mock: `skills.manage` for each action, `POST /api/skills`, `PUT /api/skills/content`. E2E at the end of
   `10-hub-pages.cjs` (or a new `37-skills.cjs` if that file is long).

Shared files touched: `Screens.tsx` (the Skills screen: consider moving it to its own file first, in a commit that
changes nothing else), `Markdown.tsx`, `styles.css`, `mock.cjs`.

## Tests

- Unit: a name with spaces or capitals is refused; front matter with a colon in the description round-trips; a block
  with two front matters is not a skill.
- E2E: create, edit, delete; Copy to edit on a built-in; search and browse; preview shows files and the check
  result; install asks for the fingerprint (fake bridge), installs switched off when the check has warnings;
  the catalog unreachable; the chat button fills the editor.
- Against a real Hermes: the create and install calls with the real shapes; a skill with a script folder.

## Spec and changes

Spec 3.14 (Skills: both tabs, the editor, the sheets), 3.5 (chat menu entry), 3.3 (the block button), 2.4
(`hm.skill.draft`), 2.6 (new files), the RPC and REST tables, 2.3 (what installing a skill means; the fingerprint).
`docs/features.md`, `docs/security.md`. One `changes/` file per part, the first two `rank: big`.

## Check first

- The request and result shapes of every `skills.manage` action and of `POST /api/skills` at the pinned build, and
  whether `inspect` returns the file list and the check result or only the text.
- How to remove an installed skill (an action, a route, or the folder).
- Whether install works under proot without network tools Hermes expects (`git`).
- That the fingerprint can be asked from the page for a non-approval action (the phone-data switches do it natively;
  a small bridge method `confirmPresence(key, reason)` may be needed).

## Out of scope

Publishing a skill to the catalog, skill updates and version pinning, skills shared between phones.
