# Hermes Mobile: full specification

The specification describes what the code of Hermes Mobile does: the architecture, every feature, every screen and
every UI element, the Android shell, the Hermes plugin, the phone-side scripts, and how the app is built, tested and
released. This file is its index; the text is in [docs/spec/](spec/), one file per section below (`NN-MM-name.md`), so
parallel changes to different areas don't touch the same file. Read the contents list, then only the files for the
area you work on.

**How to read this.** Sections 1 and 2 give the big picture: what the app is, which processes run where, and how a
message, an approval or a notification travels between them. Section 3 walks every screen, sheet and panel of the app
(what each element looks like, what a tap, long-press or swipe does, and its empty, loading, error and disabled
states). Sections 4 to 6 describe the parts outside the page: the Android shell, the Hermes plugin, and the scripts on
the phone. Section 7 covers build, tests, CI and releases. Section 8 is a feature index that points to the section
describing each feature; section 9 is a glossary. Identifiers are written in backticks exactly as in the code
(`speak`, `GET /canvas/doc`, `hm.yolo.v1`, `MainActivity`); text the user reads on screen is written as shown, without
backticks (Danger zone, Auto for all chats). References name a file and a symbol (`web/src/components/Composer.tsx`
`Composer`), never a line number.

**How to keep it current.** Everyone who changes the repository, person or coding agent, updates the spec file for
the area they changed, in the same commit as the code change ([AGENTS.md](../AGENTS.md) says so for every agent;
`CLAUDE.md` imports it). A new area gets a new file in `docs/spec/` and a line in the contents list below. Before
pushing, run `python3 tools/check_spec.py`: it pulls the names out of the code (files, bridge methods, plugin routes,
hooks and tools, gateway RPCs, `localStorage` keys, screens, Settings sections and row titles, aria-labels, service
events, notification channels, manifest permissions) and fails when no spec file mentions one. CI runs it on every
push. Give each new name a sentence saying what it does; a bare list of names passes the checker but helps nobody.

**Where status lives.** This file says what the code does, not whether it was tested on a phone. What was verified
where, and what is still open, is in [docs/improvements.md](improvements.md) and
[docs/manual-tests.md](manual-tests.md).

## Contents

- [1. What it is](spec/01-what-it-is.md)
- 2. Architecture
  - [2.1 Processes and ports](spec/02-01-processes-and-ports.md)
  - [2.2 Data flows](spec/02-02-data-flows.md)
  - [2.3 Security model](spec/02-03-security-model.md)
  - [2.4 State and storage](spec/02-04-state-and-storage.md)
  - [2.5 Battery: what wakes the phone](spec/02-05-battery-what-wakes-the-phone.md)
  - [2.6 Core web files](spec/02-06-core-web-files.md)
- [3. Screens and UI elements](spec/03-00-screens-and-ui-elements.md)
  - [3.1 Navigation map](spec/03-01-navigation-map.md)
  - [3.2 Chat screen](spec/03-02-chat-screen.md)
  - [3.3 Messages](spec/03-03-messages.md)
  - [3.4 Composer](spec/03-04-composer.md)
  - [3.5 Chat sheets](spec/03-05-chat-sheets.md)
  - [3.6 Approvals and questions](spec/03-06-approvals-and-questions.md)
  - [3.7 Canvas panel](spec/03-07-canvas-panel.md)
  - [3.8 Gallery](spec/03-08-gallery.md)
  - [3.9 OpenUI cards](spec/03-09-openui-cards.md)
  - [3.10 Background app card and viewer](spec/03-10-background-app-card-and-viewer.md)
  - [3.11 Read-aloud player (and the web side of voice input and Live mode)](spec/03-11-read-aloud-player.md)
  - [3.12 By the way (/btw)](spec/03-12-by-the-way.md)
  - [3.13 Drawer + session list](spec/03-13-drawer-session-list.md)
  - [3.14 Hermes hub + Skills, Memory, Cron, Files, Projects](spec/03-14-hermes-hub-skills-memory-cron.md)
  - [3.15 Settings](spec/03-15-settings.md)
  - [3.16 Bots](spec/03-16-bots.md)
  - [3.17 Model providers + sign-in](spec/03-17-model-providers-sign-in.md)
  - [3.18 Setup flow + Setup check + Welcome](spec/03-18-setup-flow-setup-check-welcome.md)
  - [3.19 Uninstall](spec/03-19-uninstall.md)
  - [3.20 Shared UI kit + hard UI rules](spec/03-20-shared-ui-kit-hard-ui.md)
- [4. Android shell](spec/04-00-android-shell.md)
  - [4.1 Every Java class](spec/04-01-every-java-class.md)
  - [4.2 Manifest: components and permissions](spec/04-02-manifest-components-and-permissions.md)
  - [4.3 Notifications](spec/04-03-notifications.md)
  - [4.4 Service events](spec/04-04-service-events.md)
  - [4.5 Bridge methods](spec/04-05-bridge-methods.md)
  - [4.6 Voice, read-aloud, Live mode, phone assistant](spec/04-06-voice-read-aloud-live-mode.md)
  - [4.7 Shizuku keeper, Autostart, Uninstall, UpdateNotice, BgHost and the rest](spec/04-07-shizuku-keeper-autostart-uninstall-updatenotice.md)
- [5. Hermes plugin](spec/05-00-hermes-plugin.md)
  - [5.1 Hooks (12)](spec/05-01-hooks.md)
  - [5.2 Tools (4)](spec/05-02-tools.md)
  - [5.3 System-prompt sections (4)](spec/05-03-system-prompt-sections.md)
  - [5.4 Dashboard routes (all 46)](spec/05-04-dashboard-routes.md)
  - [5.5 Files the plugin writes and reads](spec/05-05-files-the-plugin-writes.md)
- [6. Phone side and install](spec/06-00-phone-side-and-install.md)
  - [6.1 Every `phone/` script (11)](spec/06-01-every-phone-script.md)
  - [6.2 `hermes-services`: the supervisor loops](spec/06-02-hermes-services-the-supervisor-loops.md)
  - [6.3 Install routes](spec/06-03-install-routes.md)
  - [6.4 Hermes pin and patches (3)](spec/06-04-hermes-pin-and-patches.md)
  - [6.5 Uninstall (`phone/uninstall.sh`)](spec/06-05-uninstall.md)
- 7. Build, test, CI, release
  - [7.1 Build commands](spec/07-01-build-commands.md)
  - [7.2 Every `tools/` file](spec/07-02-every-tools-file.md)
  - [7.3 Browser e2e (`tools/web-e2e/`)](spec/07-03-browser-e2e.md)
  - [7.4 Workflows (`.github/workflows/`)](spec/07-04-workflows.md)
  - [7.5 Versioning and releases](spec/07-05-versioning-and-releases.md)
  - [7.6 Docs for contributors and agents](spec/07-06-docs-for-contributors-and-agents.md)
- [8. Feature index](spec/08-feature-index.md)
- [9. Glossary](spec/09-glossary.md)
