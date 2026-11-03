# UI and user experience: where it stands

**State** (2026-11-03): this is a map, not a plan in progress. Of the research's nine ranked changes, none is fully
built: four are partly built, four are not built and one was settled by the rename to Hermux. Most of the "keep"
items are in place, and the work since 2026-11-02 (PRs #60 to #105) moved several of them on: Auto beside the model
picker, plain-word tool lines, smooth collapse, fingerprint approvals, the live viewer from the status chip, Hermux
settings, Connectors, Report a problem, the "New Messages" divider and the title opening the status sheet. A
first-time-user read of the app found some new rough spots: accessibility, error wording, empty states, Settings
naming and Setup jargon.

**Next:** the owner picks the scope from the proposed order below (section 4) and answers the questions in section 5.
Nothing here has been started.

**Needs a real phone:** n/a for this file. Each piece of work it proposes says its own.

**Links:** [the research](../research/hermes-usage-and-phone-ui.md),
[showing agent work in chat](../research/chat-tool-visuals.md), [UI inventory](../design/ui-inventory.md),
[revamp status](ui-revamp.md), [tablet status](tablet-layout.md).

**How this was checked.** Every item was looked up in the code on `main` (commit `35bbff6`): `web/src`, `android/src`
and `hermes-plugin/`, through searches for the strings and functions involved, then by reading the code around each
hit. It was also compared with the changelog, `changes/` and `docs/decisions/`. Claims that mattered most were
re-checked by hand: tok/s in the live bar (`App.tsx`) and the reply line (`gateway.ts` `finishTurnStats`), Branch as
a reply icon (`ChatItems.tsx`), the hub order (`Screens.tsx` `HUB`), cost in the context sheet (`Sheets.tsx`), the
session row dots (`SessionList.tsx`), the WebView text zoom (`MainActivity.java`) and the light theme's colours
(contrast computed). The app was not run and no phone was used. "Not built" means there is no trace on `main`; an
unmerged branch could still have it.

## 1. The research's recommendations, one by one

### The nine ranked changes

| # | Change | State | What is there now |
|---|---|---|---|
| 1 | "Needs you" state on chat rows, badge and banner, with Allow/Deny from the list | **Not built** | Rows have only a working dot and an unread dot (`SessionList.tsx`). The Android side already has a "Needs you" notification channel. |
| 2 | Fold a finished turn's work into one line ("Worked 1 m 20 s · 14 steps"), and show the reasoning time | **Not built** | Runs of 3+ tool calls fold, now summed up in words ("Ran 2 commands and read 1 file", `toolsay.ts`, PR #73). The reasoning block still says "Thought process" with no time. |
| 3 | A "why" line on approvals, a sheet that shrinks to a bar, and a "sent" confirmation after answering from a notification | **Not built** | The sheet shows the tool, Hermes's warning, the command and the buttons (`RequestSheet.tsx`). Since PR #76 the first Allow in a chat needs the fingerprint ([decision](../decisions/approval-needs-fingerprint.md)). After a notification answer only a failure is reported ("Couldn't send your answer"); success says nothing. |
| 4 | Cost next to context; tok/s out of the live bar and the default reply line | **Partly built** | Correction to the research: the context sheet already showed the session's cost ("Cost: $…", `Sheets.tsx`) before it was written. Still to do: tok/s is in the live bar and under every reply, and there is no per-turn cost. |
| 5 | Two notification switches ("When a task finishes", "When Hermux needs me"); cron results open as a chat with an unread dot | **Not built** | Settings has no notification section. The channels are split on the Android side (needs you, jobs, learning) but can only be changed in Android's own settings. A cron run already opens its chat from the jobs screen. |
| 6 | A slimmer Settings top level with one Advanced row | **Partly built** | There is an Advanced settings row, but the main page has grown (Hermux settings, Connectors, PRs #72 and #78) and is not the short list proposed. |
| 7 | Hub: Scheduled jobs first, with next run and last result on its card | **Partly built** | The hub card shows the number of jobs and the next run, but not the last result; the order is still Skills, Memory, Scheduled jobs. |
| 8 | Quieter chrome: dim the green dot, Auto beside the model chip, Branch into a "more" menu | **Partly built** | Auto now sits beside the model chip (PR #69). The green dot and the Branch icon are unchanged. |
| 9 | Decide on the name clash with the agent maker's own app | **Settled** | The app is now Hermux ([decision](../decisions/hermux-where-it-shows.md), [update path](../decisions/hermux-name-update-path.md)). |

### The keep / move / drop / add table (research section 5)

| Element | Verdict then | State now |
|---|---|---|
| Chat list: search, pins, swipes, working and unread dots | Keep | In place ([decision](../decisions/session-list-gestures.md)). |
| Chat list: "needs your input" state | Add | Not built (ranked #1). |
| Header ☰, title, ⋮ | Keep | In place; the title now also opens the status sheet (PR #105). |
| Header status dot | Keep, quieter | Unchanged: green when all is well. |
| Auto button | Keep, consider moving | Moved beside the model chip (PR #69). |
| Canvas button and swipe | Keep | In place. |
| Connection banner | Keep | In place. |
| Reasoning block | Keep, show the time | No time yet. Its closed line now shows the thought's first sentence (PR #73). |
| Tool cards and folded runs | Keep, fold further | Runs summed up in words (PR #73), smooth open and close (PR #101). The whole finished turn doesn't fold yet. |
| Live status bar | Keep, trim tok/s | Not trimmed. |
| Reply stats line | Move to a tap, add cost | Not moved. |
| Reply actions | Keep, Branch into "more" | Unchanged. |
| Changed files card, file checkpoints | Keep | In place. |
| Context ring, sheet, compress hint | Keep, add cost, hint says what is kept | Cost was already there. The hint still says only "Compress older turns so Hermux keeps up?". |
| Composer: model chip, `+`, `/`, Live, Dictate, Send / Steer / Stop | Keep | In place. |
| Queued messages, stash, quotes, drafts, outbox | Keep | In place. |
| Chat scrubber | Keep | In place. |
| Approval sheet | Keep, add "why", shrink to a bar, sub-agent approvals | Only the fingerprint check was added. Whether a sub-agent's approval reaches the sheet was not checked. |
| Approvals from the notification | Keep, confirm it was sent | Unlock rule and fingerprint in place; no confirmation on success. |
| Status chip, Done chip, badge | Keep | In place; tapping the chip now opens the live viewer (PRs #63, #88). |
| Background app card | Keep | In place. |
| Activity banner | Keep, later show only chats that need you | Unchanged. |
| By the way pull-up | Keep | In place, with a longer pull (PR #60, [decision](../decisions/btw-pull-up-harder.md)). |
| Hub order, cron card | Reorder | Not reordered. |
| Settings | Slim the top level | Partly (ranked #6). |
| Notification settings | Add | Not built (ranked #5). |
| Bots | Keep | In place. |
| Messaging-gateway screens | Leave out | Left out ([decision](../decisions/app-is-the-only-front-end.md)). |

### The principles (research section 6)

| Principle | State | Notes |
|---|---|---|
| Show progress, not machinery | Partly | Plain-word tool lines and the elapsed time are there; no step count, no folded finished turn. |
| The answer is the hero | Partly | Only runs of 3+ tools fold. |
| Ask rarely, clearly, and say why | Partly | Per-chat modes, the exact command and an always-visible Deny are there; no "why" line. |
| Never leave the person guessing | Partly | Failures are reported; a successful answer from a notification isn't. |
| Notify for outcomes and blockers only | Partly | The channels are split that way, but there is no in-app switch. |
| Cost and context visible but quiet | Partly | The ring and the sheet are there; tok/s is still loud. |
| Never fight the reader | Built | The chat follows new text only while you are within 80 px of the end. |
| One-handed first | Mostly | Model, Auto, Stop, Steer and Live sit in the composer. |
| Voice first, and written down too | Built | Live mode, dictation, read-aloud. |
| Fewer, calmer controls | Not started | No controls were removed. |
| Typography over boxes | Partly | Replies are full width, tool lines are thin; sub-agent and open tool cards are still boxes. |
| Colour means state | Partly | Theme colours for ok, warning and error exist; amber isn't used for "needs you" yet. |
| Motion explains; haptics only to confirm | Partly | Smooth collapse is in. Haptics fire on ordinary taps too: about 160 calls in 35 files. |
| Readable first (16 px body, contrast in every theme) | Not met | Body text is 15 px by default, and much text is 10 to 12 px. The light theme's accent fails contrast (section 3). |
| Phone-native | Partly | No system dialogs or native form controls (decisions [1](../decisions/no-browser-dialogs.md), [2](../decisions/no-native-form-controls.md)). Touch targets are mixed (section 3). |

## 2. Everything else the research found

**Complaints from the Hermes tracker, and where Hermux stands on each:**

- **One agent from several devices.** The most-reacted theme upstream. Hermux runs the agent on the phone, so this is
  mostly not our problem; "continue this chat on my computer" is not offered.
- **Setup is hard.** True for us too: Setup is long and full of terms like Shizuku and Wireless debugging (section 3).
- **Cost and tokens you can't see.** Mostly covered: the context ring, the context sheet with cost, and stats per
  reply.
- **Approvals: safety and rationale.** Covered better than upstream (per-chat modes, the dangerous-command block,
  fingerprint), except the agent's reason.
- **Compaction hides history, notices pile up.** We show one compress hint; it doesn't say what is kept.
- **Unread and "needs input" markers, notifications too quiet, cron results as a chat.** Unread is covered;
  "needs input" and the in-app switches aren't.
- **"Hard to read" themes.** One real gap: the light theme's gold text (section 3).

**Patterns the big assistant apps have that Hermux doesn't** (described, not named, per the project's rule):

- A finished turn folds to one "worked for N s" line, and reasoning shows how long it took.
- An "approve from the chat list" flow, and a list marker for chats that wait for you.
- Two simple notification switches inside the app.
- Notification permission asked when it first matters, for example on the first scheduled job. Hermux asks as soon as
  the app opens (`MainActivity.requestRuntimePermissions`, from `onCreate`).
- A switch to turn haptics off.
- `@` to mention a file in the composer, prompt history inside the composer, and a pinnable row of quick actions.
- A diff viewer where tapping a line sends a comment about it to the agent.
- Press-and-hold to talk.

**"Add" ideas that never made the ranked list:** the compress hint saying what is kept; sub-agent approvals reaching
the sheet (not checked); the activity banner showing only chats that need you; a visible confirmation for every tap
that sends something to Hermux; one Advanced row for the rarely used settings.

## 3. New findings from reading the app

Each finding is marked **[code]** (seen in the code, with where), **[source]** (backed by the spec, a decision or the
research) or **[judgement]**.

**Accessibility**

- **The phone's own font size is ignored.** The WebView fixes text zoom at 100 % (`MainActivity.java`,
  `setTextZoom(100)`), so someone who set large text in Android gets normal text. They have to find Appearance → Text
  size in the app. **[code]**
- **Light theme: gold text fails contrast.** `--accent` `#b57a10` on white is 3.65:1, below the 4.5:1 that small text
  needs. It is used for 12 px text such as gallery categories, the "latest" mark and the scrubber's number. Dim text is
  5.1:1 (fine), but about 20 rules lower it further with opacity. The dark and OLED themes pass. **[code]**
- **Small text.** The default body is 15 px. About 55 rules are below 12 px (0.65 to 0.78 rem, about 10 to 11.7 px
  at 100 %); message times and queued headers are 11 px. The Text size setting does scale all of it. **[code]**
- **Small touch targets.** Header and composer icon buttons are 40 px. The attachment ✕ is 20 px, the compress ✕ 32
  px, the canvas tools 34 to 36 px, and reply actions are text with 4 px padding. The project's own design notes ask
  for 44 px. **[code]** **[source: UI inventory]**
- **Emoji as icons.** Settings rows use about 36 emoji icons (🔐 ✨ 🔊 ⚕️…). They look different on every phone maker,
  and screen readers may read them out. **[judgement]**
- **Labels are good.** No icon-only button without an accessible name was found. **[code]**

**First run and Setup**

- **Long and full of jargon.** Four helper apps, then Shizuku through Developer options, Build number ×7, Wireless
  debugging and a pairing code, then a paste-in install of about 15 minutes. The reason a phone needs "debugging"
  comes only in a long paragraph. Shizuku is required by [decision](../decisions/shizuku-is-required.md), so the fix
  is wording and a sense of progress, not fewer steps. **[source: spec 3.18]** **[judgement]**
- **The step count can change.** "Step N of M" counts only the steps that were missing, so M can change while you go.
  **[source: spec 3.18]**
- **Leaving by accident.** Back on the first page closes the flow, and it doesn't reopen until the app restarts. The
  way back, Settings → Setup check, isn't shown. **[source: spec 3.18]**
- **Skipping the model step leaves no hint.** After "Skip for now", the empty chat doesn't say that no model is set.
  **[judgement]**
- **A failed app install says only "Not installed: tap Retry."**, with no reason. **[code: `Setup.tsx`]**

**Empty states**

- **Mixed quality.** Some lists explain themselves ("Tap ＋ to create one" for jobs and projects; the gallery). Others
  only say "No skills", "Nothing saved yet" (memory), "No servers yet" (Connectors) or "Nothing to show yet.", with no
  word on what the thing is or how to get one. **[code: `Screens.tsx`, `Connectors.tsx`, `Sheets.tsx`]**
- **First suggestions need access nobody gave yet.** The empty chat's built-in suggestions (today's calendar, unread
  email) need access the person hasn't set up. **[judgement]**

**Errors**

- **Raw error text reaches people.** `errText` (`gateway.ts`) passes the error's own message, or its JSON, straight
  into dozens of toasts (about 70, in more than 20 files) and into the offline banner. Most say nothing about what to do next ("Send failed: …",
  "Couldn't send the report"). Good examples to copy exist: Setup's toasts give the command to run, and the voice
  errors name the Settings path. **[code]**
- **Mixed punctuation.** "Couldn’t" (curly), "Couldn't" (straight) and "Could not" all appear. **[code]**

**Settings**

- **Long main page, overlapping names.** About 25 rows. The section "Hermux" holds a row "Hermux settings" next to
  "Advanced settings" ("every Hermux option"). About has both "App" and "Hermux agent" versions. Nothing tells a
  newcomer which one to open. **[judgement]**
- **Four places for models.** Default models, Model providers, API keys and Connectors are split, plus the setup
  flow's model step. **[judgement]**
- **Developer rows among everyday ones.** Last start-up timings and Remote debugging sit in About with Check for
  updates. **[judgement]**

**Wording after the rename**

- On-screen text is consistent: the web interface, the Android strings and the plugin's messages say Hermux, as the
  [decision](../decisions/hermux-where-it-shows.md) asks. The real-phone pass for leftovers is still open
  ([status](hermux-wording.md)). **[code]**

**Tablets and wide screens**

- **Sheets and pages stretch to the full width.** Bottom sheets and Settings pages have no maximum width on a tablet.
  This is already listed as revamp work. **[source: [tablet status](tablet-layout.md)]**
- **Not tried on a real tablet,** and there are no landscape rules for phones. **[source: tablet status]**

## 4. Proposed order of work

Sizes: S = a day or less, M = a few days, L = a week or more. Big shared files are named so that two pieces touching
the same one run one after the other (AGENTS.md, "Working in parallel"). Every piece needs its spec update, a browser
check and a `changes/` entry.

**Track 1: the chat's look** (shares `styles.css` and `App.tsx`; one piece at a time)

| Order | Piece | Size | Main files |
|---|---|---|---|
| 1a | **Fold a finished turn into "Worked N s · N steps", and show "Thought for N s".** This is the first piece to start: the biggest calm-down, low risk, and builds on PR #73. Re-sized from the research's S–M, since PR #73's run summaries have to fold into it. | M | `ChatItems.tsx`, `fold.ts`, `toolsay.ts`, `styles.css` |
| 1b | Quieter chrome: reply stats on tap, tok/s out of the live bar, Branch into a "more" menu, dim green dot | S | `App.tsx`, `ChatItems.tsx`, `styles.css` |
| 1c | Accessibility: light accent contrast, 44 px touch targets, a floor for the smallest text, start Text size from the phone's font size | S–M | `styles.css`, `MainActivity.java` |
| 1d | Tablets: maximum width for sheets and pages | S | `styles.css` |

**Track 2: waiting, approvals and notifications** (shares `gateway.ts` and `HermesService.java`; one piece at a time;
the small CSS each needs lands between Track 1 pieces)

| Order | Piece | Size | Main files |
|---|---|---|---|
| 2a | "Needs you": amber row dot, badge and banner for chats waiting on an approval or question | M | `SessionList.tsx`, `activity.ts`, the plugin's `/activity`, `HermesService.java` |
| 2b | Approvals: "sent" confirmation in the notification, sheet that shrinks to a bar, then a "why" line (may need Hermes to send its reason: a patch) | M | `RequestSheet.tsx`, `HermesService.java`, plugin |
| 2c | Errors in plain words with a next step: the most common messages first (there are about 70) | M–L | `gateway.ts` `errText` and its callers |
| 2d | Settings: shorter main page, clearer names, two notification switches | M–L | `Settings.tsx`, `HermesService.java` |

**Track 3: no big shared files** (can run beside the others, one piece at a time within the track)

| Order | Piece | Size | Main files |
|---|---|---|---|
| 3a | Setup: one plain sentence per step on why it is needed, a stable step count, and a visible way back | M | `Setup.tsx` |
| 3b | Hub: Scheduled jobs first, and the last result on its card | S | `Screens.tsx` |
| 3c | Empty states that say what the thing is and how to start (after 3b, same file) | S | `Screens.tsx`, `Connectors.tsx`, `SessionList.tsx` |

Bigger revamp items (L, after the owner sets the revamp's scope): drawn icons instead of emoji, asking for
notification permission in context, a haptics switch, `@` file mentions and prompt history in the composer.

## 5. What the owner has to decide

1. **Scope:** which pieces to do now, and which wait for the full revamp.
2. **Folding finished turns:** OK to hide a finished turn's tool calls behind one line by default?
3. **tok/s:** OK to take it out of the always-visible lines (it stays in the context sheet)?
4. **Settings:** may rows be regrouped and renamed (Hermux settings and Advanced settings, and the duplicate "Read
   every reply aloud" on the main page and in Voice)?
5. **Text size:** should the app follow the phone's own font size by default?
6. **Icons:** move from emoji to a drawn icon set, as part of the revamp?
7. **Notification switches:** which should be on by default?
