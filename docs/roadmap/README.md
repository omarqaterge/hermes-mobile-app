# Roadmap designs

Features Hermux doesn't have yet, each designed far enough that an agent new to the idea can build it once the
owner says go. **Nothing here is decided or scheduled.** A file in this folder is a design, not a task: build one only
when the owner asks for it, and settle its "Owner decisions needed" first.

Written 2026-11-16 against Hermux `main` and the pinned Hermes (0.21.5, `web/vendor/hermes-shared/.hermes-commit`).
Where a design leans on something in Hermes, it was checked in the pinned build's source, and the file says so. What
could not be checked is listed under "Check first" in each file: do those checks before writing code, and fix the
design in the same PR when one turns out wrong.

## The designs

Effort: S under a day, M a few days, L a week or more. "Phone" means it can only be judged on a real phone.

| # | Design | Effort | Areas | Depends on | Phone |
|---|---|---|---|---|---|
| 01 | [Morning brief](01-morning-brief.md) | L | plugin, web, a little Java | job kinds (below) | yes |
| 02 | [Watch list (a standing checklist)](02-watch-list.md) | M | plugin, web | job kinds | yes |
| 03 | [Follow-ups (open loops)](03-follow-ups.md) | M | plugin, web | none | no |
| 04 | [Night shift](04-night-shift.md) | L | Java, plugin, web | device triggers (below) | yes |
| 05 | [Weekly journal](05-weekly-journal.md) | M | plugin, web | none (better after 01–04) | no |
| 06 | [Inbox](06-inbox.md) | L | Java, web, plugin | none | yes |
| 07 | [Tags you tap (NFC)](07-nfc-tags.md) | M | Java, web | none | yes |
| 08 | [Health data for the agent](08-health-data.md) | M | Java, plugin, web | the phone-data contract | yes |
| 09 | ["Your turn" steps](09-your-turn.md) | M | plugin, Java, web | none | yes |
| 10 | [App list and a cap on apps per reply](10-app-list-and-cap.md) | S–M | plugin, web | none | yes |
| 21 | [Background tasks](21-background-tasks.md) | M | Hermes patch, plugin, web | sub-agent rows (built) | no |
| 11 | [Second opinion](11-second-opinion.md) | M | web | none | no |
| 12 | [Export](12-export.md) | M | Java, web | none | yes |
| 13 | [Task board](13-task-board.md) | M–L | web | none (most useful with connections) | no |
| 14 | [Push for a Hermes that runs elsewhere](14-remote-push.md) | L | Java, plugin, web | **connections** (not designed here) | yes |
| 15 | [Handing work between the phone's agent and another](15-agent-link.md) | M | plugin, web | 14 is not needed; connections for the reverse way | no |
| 16 | [Sources under web answers; real-time voice](16-sources-and-voice.md) | S–M | web | none | no |
| 17 | [Skills: browse, install, write](17-skills-hub.md) | L | web, plugin | none | no |
| 18 | ["Better at a desk" for big changes](18-desk-review.md) | S–M | web | none | no |
| 19 | [Test results and screenshots as cards](19-result-cards.md) | M | web | none | no |
| 20 | [Apps' own actions (AppFunctions): a spike](20-app-functions.md) | S (spike) | Java, plugin | none | yes |

## Suggested order

1. **Small and safe, visible daily:** 16 (sources), 19, 18, 12, 10.
2. **The "comes to you" group:** 03, then 02, then 01 (01 reuses 03's list and 02's silent-run rule), then 05.
3. **Phone-side reach:** 06, 07, 09, 04, 08.
4. **Hermes already has it:** 17, 13, 11.
5. **Remote:** 14 and 15 wait for the connections work; 20 is a spike to run whenever a phone with Android 16 is free.

## Shared building blocks

Several designs need the same three things. Build each once, in the first PR that needs it, and put it in the spec
then. Later designs reuse it and say so.

### Job kinds

Designs 01, 02, 04 and 05 run as Hermes scheduled jobs (`POST /api/cron/jobs` with `deliver: "local"`, as the Cron
screen does today), so they get the ticker, the wake alarm and the wake lock that already exist (spec 2.5, 6.1). What
they add is a **kind**, so Hermux can treat a brief differently from a plain job.

- The plugin keeps `~/.hermes/mobile/jobs.json`: `{ "<job id>": { "kind": "brief" | "watch" | "night" | "journal",
  "made": <epoch s> } }`. A new module `hermes-plugin/hermes-mobile/jobkinds.py` owns it (`kind_of(job_id)`,
  `set_kind`, `forget`, and `prune()` which drops ids Hermes no longer has). Atomic writes (temp file, then rename),
  as the other plugin stores do.
- Routes under `/api/plugins/hermes-mobile`: `GET /jobkinds` and `PUT /jobkinds/{id}`. The page creates the Hermes job
  first, then records its kind.
- The plugin's `on_session_end` hook already sends the `cron` event for a finished job (`__init__.py`, the
  `platform == "cron"` branch). With kinds it looks the job up and lets the kind decide the title, the body and
  whether to notify at all (02 stays silent when nothing needs the user).
- The Cron screen (`CronScreen` in `Screens.tsx`) hides jobs that have a kind: each kind has its own screen.
- **Unattended runs.** A scheduled job runs with no one to approve. Hermes then follows `approvals.cron_mode`, and the
  app's phone-data gate refuses every read (no tap, no grant; decision
  [phone-data-read-only](../decisions/phone-data-read-only.md)). No design here weakens that. A design that would
  like phone data in a job says so under "Owner decisions needed" and works without it.

### Device triggers

Designs 04 and 07 start work from something the phone notices (charger, Wi-Fi, a tag). The rule for all of them:
**the app decides, natively**. The agent runs in Termux and can edit any file there, so a trigger kept on that side
could be rewritten by the agent itself.

- A new plain-Java class `Triggers` (no Android classes in its rule logic, tested like `PendingAsk` with
  `tools/test_triggers.sh`) holds the rules in the app's own `SharedPreferences`.
- `HermesService` feeds it: a runtime receiver for `ACTION_POWER_CONNECTED` / `ACTION_POWER_DISCONNECTED` and one
  `ConnectivityManager.NetworkCallback` for an unmetered network, **registered only while a rule needs them** and
  unregistered when none does. No polling, no wake lock of its own (battery rule in `AGENTS.md`).
- When a rule fires, the service calls the plugin over the verified local connection it already uses for Approve and
  Stop (`LocalClient`, spec 2.3).

### A read-only device state for the plugin

Designs 02 and 04 want to know "charging? on Wi-Fi? battery level?" before spending tokens. The app answers a new
op on its listener (`POST /phonedata` is for private data; this is not private, so it gets its own path):
`POST /device` on 9121 with local authentication, answer `{ charging, unmetered, battery_pct, interactive }`. Nothing
else, no identifiers. The plugin reads it with the same `_post` helper the hooks use.

## Not designed here

These came up in the same review and other designs lean on them. They need their own design before 14, and parts
of 13, 15 and 18, can be finished:

- **Connections:** pairing with a Hermes on a server or computer, one chat list across machines, the capability check
  for a Hermes without the plugin, and splitting the plugin into a portable half and a phone half.
- **Activity record:** one list of what Hermux did across chats (commands, apps, phone-data reads, files). Design 05
  starts a small one (`activity.jsonl`).
- **Backup and restore, app lock, a spending cap, translations, a "what Hermux learned" screen.**

## Rules every design keeps

All of [AGENTS.md](../../AGENTS.md). The ones these designs touch most:

- **Spec in the same commit.** Each file names the `docs/spec/` sections to update. Run `python3 tools/check_spec.py`.
- **A `changes/` file** for what users notice, with what was tested on which Android.
- **No native form controls, no browser dialogs:** `web/src/components/ui.tsx` and `web/src/dialog.tsx`. Colours from
  CSS variables. Android Back closes whatever opens (`useBackHandler`).
- **Every bridge method** takes the per-page key first and is listed in `web/src/secure-bridge.ts`.
- **Every framework call above API 26** sits behind a `Build.VERSION.SDK_INT` check (`tools/api-check.sh`). A feature
  that needs a newer Android goes in `docs/android-versions.md` and spec 4.2.
- **No loop or wake lock without a bound.** Each design states its bound.
- **Nothing from a locked phone**, and the first Allow in a chat needs the fingerprint (decisions
  [no-actions-from-locked-phone](../decisions/no-actions-from-locked-phone.md),
  [approval-needs-fingerprint](../decisions/approval-needs-fingerprint.md)).
- **Text from outside is data, not instructions.** Anything a design feeds the model from a page, a share, a tag or
  another agent is wrapped and marked the way `phone_data` marks its results (spec 5.2).
- **Public repository:** no personal data in fixtures or docs, and no names of other apps or products: describe the
  idea in our own words.
- **Shared files** (`web/src/gateway.ts`, `App.tsx`, `styles.css`, `MainActivity.java`, `HermesService.java`,
  `tools/web-e2e/mock.cjs`): each design lists which it changes. Two designs that share one are built one after the
  other.

## What each PR must contain

1. The code, with the tests the design lists (unit tests for pure logic, a browser check in the feature's file under
   `tools/web-e2e/checks/`, plugin tests as `tools/test_<name>.py`, plain-Java tests as `tools/test_<name>.sh`).
2. The spec sections the design names.
3. A `changes/YYYY-MM-DD-<name>.md` file.
4. `docs/status/<design-name>.md` while the work is open (deleted in the PR that finishes it).
5. A decision file in `docs/decisions/` for each "Owner decisions needed" item the owner answered.
6. `tools/check.sh` passing, and a plain statement of what was and wasn't seen on a real phone.
