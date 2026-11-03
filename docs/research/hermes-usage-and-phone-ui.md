# How people use Hermes, and what that means for a phone app

> **Update 2026-11-03.** What has been built since this was written, item by item, is in
> [ui-revamp-overview.md](../status/ui-revamp-overview.md). That file also holds new findings and a proposed order of
> work. This file was corrected the same day:
> - the name clash in section 3 is settled: the app is now Hermux;
> - the context sheet already showed the session's cost when this was written (section 5, ranked change 4);
> - other apps are described by what they do instead of by name, per the project's rule. The source links stay.

Research for the planned [UI revamp](../status/ui-revamp.md), written 2026-11-02. It answers three questions:

- who uses the Hermes agent, and for what;
- which of our UI elements earn their place on a phone;
- what makes a phone agent app pleasant to look at and to use.

**How it was done.** Web research on the Hermes agent: its GitHub tracker, docs, reviews, and Reddit posts reached
through mirrors. Then the mobile apps of the leading AI assistants and of several remote clients for coding agents.
The results were compared with what Hermux has today
([spec section 3](../spec/03-00-screens-and-ui-elements.md), [feature index](../spec/08-feature-index.md)).

**How far to trust it.**
- **Tracker numbers.** The Hermes tracker had about 52,000 issues and the repo about 260,000 stars (checked with
  `gh api` on 2026-11-02). Many issues are filed by bots or agents, so counts of issue titles show *where activity
  goes*, not how many people want something. Reaction counts are low: the top items have 10 to 46 👍.
- **Sources on the newer apps.** Much of the coverage of the newer mobile agent apps is launch posts and blogs.
- **Judgement.** Where a point is our own judgement and not a source, it says **(judgement)**.

## 1. Who uses Hermes, and on what

- **Technical solo founders, operators and hobbyists**, plus small businesses and some teams. The official
  [user stories](https://hermes-agent.nousresearch.com/docs/user-stories) range from a drainlayer doing quotes and
  invoices from job sites over Telegram, to a physician with about 94 skills, to a company giving each of 220+
  employees their own agent. A [review](https://preuve.ai/blog/hermes-agent-review) calls it a poor fit for
  non-technical users. It also says most people do their coding in a dedicated coding agent and run Hermes beside it
  as an assistant.
- **It most often runs on a cheap always-on server** (a VPS), then on home hardware such as a Mac mini, a Raspberry Pi
  or an old laptop ([setup guide](https://medium.com/@0xmega/hermes-agent-the-complete-setup-guide-telegram-discord-vps-no-mac-mini-required-dda315a702d3),
  [VPS hosting](https://blog.ishosting.com/en/hermes-on-vps)).
- **The official Desktop app is now the busiest surface** on the tracker: about 5,900 issue titles mention "desktop",
  against about 1,000 each for "tui" and "dashboard".
- **Running on the phone itself (Termux) is a small but real group**, with 82 issue titles. The
  [official Termux page](https://hermes-agent.nousresearch.com/docs/getting-started/termux) currently says the package
  doesn't work.
- **The phone is mostly a remote control today.** The [messaging docs](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/)
  call Telegram "usually a mobile inbox". By default they hide per-tool progress there and send periodic "still
  working" messages instead.

**What this means for us.** Our users are a narrower group: people who want the agent *on* the phone, with the phone's
own apps, files and voice. Most will already know Hermes from Telegram or Desktop. So we should keep the words and
commands they know (`/model`, `/usage`, `/compress`, `/btw`, skills as `/commands`, "yolo"), but show them as phone UI
instead of text.

## 2. The top jobs

Ranked by how often each came up in the docs, the user stories, the community list
[awesome-hermes-usecases](https://github.com/aliaihub/awesome-hermes-usecases) (82 entries) and the reviews:

1. **A personal or business assistant you message:** quotes, invoices, email triage, family logistics. On the phone
   this means short requests, often by voice, often while doing something else.
2. **Scheduled reports and watching things (cron):** daily briefs, weekly reports, keeping an eye on competitors.
   There is an official [Daily Briefing Bot](https://hermes-agent.nousresearch.com/docs/guides/daily-briefing-bot)
   guide, and about 1,400 issue titles mention cron. What people want here is a result that arrives by itself and can
   be read later.
3. **Research and knowledge:** web research, self-improving notes and wikis, video summaries. These produce long
   answers that must be easy to read on a small screen.
4. **Business back-office:** invoicing, CRM and analytics queries through connected tools (MCP: about 1,000 titles).
5. **Coding:** real, but secondary to dedicated coding agents
   ([review](https://preuve.ai/blog/hermes-agent-review)).
6. **Home automation and devices:** a niche. Only 17 issue titles mention Home Assistant.

The features behind these jobs, by issue-title mentions:

| Feature | Issue titles (about) |
|---|---|
| skills | 1,500 |
| cron | 1,400 |
| kanban (a newer multi-agent task board) | 1,300 |
| memory | 1,000 |
| MCP | 1,000 |
| approvals | 600 |
| browser | 590 |
| voice | 400 |
| sub-agents | 300 to 360 |

## 3. What people complain about

These come from the Hermes tracker. The numbers are GitHub issues in
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/issues).

| Theme | What people say | Examples |
|---|---|---|
| Using one agent from several devices | The most-reacted theme: a thin client for a remote agent, and continuing the same chat from phone and desktop. | [#38602](https://github.com/NousResearch/hermes-agent/issues/38602), [#38519](https://github.com/NousResearch/hermes-agent/issues/38519), [#8366](https://github.com/NousResearch/hermes-agent/issues/8366), [#112028](https://github.com/NousResearch/hermes-agent/issues/112028) |
| Setup is hard | About 1,200 titles mention "install" and 1,900 "update". A non-developer needed about two weeks to set it up. | [#87093](https://github.com/NousResearch/hermes-agent/issues/87093), [#2825](https://github.com/NousResearch/hermes-agent/issues/2825) |
| Cost and tokens you can't see | "Burns through tokens". No usage footer in chat apps, cost shown as 0, no token or context display in Desktop. | [#11701](https://github.com/NousResearch/hermes-agent/issues/11701), [#18304](https://github.com/NousResearch/hermes-agent/issues/18304), [#78997](https://github.com/NousResearch/hermes-agent/issues/78997), [#4379](https://github.com/NousResearch/hermes-agent/issues/4379) |
| Approvals: safety, not just friction | People want per-tool rules and to be told *why* the agent wants something. Prompts cut off the command, and approvals from sub-agents go unseen. An automatic "smart approval" destroyed data. | [#33905](https://github.com/NousResearch/hermes-agent/issues/33905), [#27604](https://github.com/NousResearch/hermes-agent/issues/27604), [#38581](https://github.com/NousResearch/hermes-agent/issues/38581), [#133514](https://github.com/NousResearch/hermes-agent/issues/133514), [#141346](https://github.com/NousResearch/hermes-agent/issues/141346) |
| Context and compaction | Too many compaction notices. `/compress` times out. Compaction also hides history from the person. | [#47241](https://github.com/NousResearch/hermes-agent/issues/47241), [#88988](https://github.com/NousResearch/hermes-agent/issues/88988), [#70846](https://github.com/NousResearch/hermes-agent/issues/70846) |
| Notifications | People want unread and "needs your input" markers and badges. Notifications are too quiet. Cron output should show up as a chat with a dot. | [#50718](https://github.com/NousResearch/hermes-agent/issues/50718), [#55179](https://github.com/NousResearch/hermes-agent/issues/55179), [#75123](https://github.com/NousResearch/hermes-agent/issues/75123), [#5712](https://github.com/NousResearch/hermes-agent/issues/5712) |
| A real phone app | People want a native app with voice and push, and real-time voice. The most-reacted mobile item is a mobile shell for Desktop (46 👍). | [#11911](https://github.com/NousResearch/hermes-agent/issues/11911), [#35750](https://github.com/NousResearch/hermes-agent/issues/35750), [#52673](https://github.com/NousResearch/hermes-agent/issues/52673) |
| Readability | The most-reacted dashboard complaint: the themes are "hard to read". | [#18080](https://github.com/NousResearch/hermes-agent/issues/18080) |

**The name clash, now settled.** The agent's maker has its own official "Hermes Mobile" app in beta: iOS on
TestFlight, Android through Firebase ([page](https://hermes-agent.nousresearch.com/mobile),
[#147269](https://github.com/NousResearch/hermes-agent/issues/147269)). It is a client for an agent that runs
elsewhere. This app has since been renamed **Hermux**, which settles the clash
([decision](../decisions/hermux-where-it-shows.md)).

## 4. How the leading mobile AI apps do it

Each pattern is described by what the apps do. The source links name them.

### Chat layout

- **Bubbles only for the person.** The person's messages sit in a right-aligned bubble; the reply is full-width text
  with no bubble. All the leading assistants do this.
- **Reasoning folds away.** It shows as "Thinking…" while it streams, then folds to one line, "Thought for 12s", that
  can be reopened ([reasoning component](https://www.shadcn.io/ui/reasoning),
  [another kit](https://docs.copilotkit.ai/langgraph-fastapi/custom-look-and-feel/reasoning-messages)).
- **Long diffs are the weak spot.** A write-up on one coding agent's phone app calls more than about 80 lines
  "painful" ([write-up](https://dev.to/owen_fox/codex-mobile-app-monitor-control-your-ai-coding-agent-from-iphone-or-android-2026-3ah)).

### Agent steps

- **One short line per step**, such as "Confirming calendar events", with the raw detail hidden behind a tap
  ([one assistant's agent mode](https://www.itpro.com/technology/artificial-intelligence/everything-you-need-to-know-about-openais-new-agent-for-chatgpt-including-how-to-access-it-and-what-it-can-do)).
- **A to-do list.** One agent app turns a task into a to-do list it works through
  ([store page](https://apps.apple.com/us/app/id6740909540)).
- **Progress outside the app.** The closest app to ours is a phone maker's on-device assistant that drives apps on the
  phone. It shows progress in the chat *and* in an Android Live Update notification, with "View progress" to watch
  the virtual phone it is driving, and "Stop task" ([help page](https://support.google.com/gemini/answer/16940971?hl=en)).
- **What to avoid:** an agent that "thinks in circles" with no visible progress.

### Approvals

- **Big buttons and the exact operation.** Remote clients for coding agents show Allow/Deny with the exact operation;
  one uses buttons 48 px or larger ([features](https://happy.engineering/docs/features/),
  [code](https://github.com/musingfox/cc-mobile)).
- **Approve from the session list.** One client's author found approving is *the* most common thing done on a phone,
  so approvals are answered from the session list without opening each chat
  ([write-up](https://dev.to/k9i/i-built-a-mobile-app-to-control-claude-code-and-codex-from-my-phone-4d84)).
- **A few modes instead of more prompts.** One assistant's mobile app offers Manual, Accept edits, Plan and Auto, and
  leaves out "bypass everything" on the phone on purpose ([docs](https://code.claude.com/docs/en/mobile)).
- **Hand control back for sensitive steps.** Sign-ins, payments and final confirms go back to the person.
- **Approval fatigue is real:** people approve almost everything after the first few dozen prompts
  ([article](https://tessl.io/blog/claude-code-gets-auto-mode-to-cut-approval-fatigue/)).
- **Silent failure is a reported bug class:** an approval that looked sent but never arrived
  ([issue](https://claudeissues.com/issue/62553-remote-control-phone-app-approval-dismisses-popup-but-never-reaches-local-proces)).

### Background work

- **Two push switches.** One remote-control feature keeps push to two switches: "when the agent decides" (usually a
  long task finished) and "when action is required" ([docs](https://code.claude.com/docs/en/remote-control)).
- **Ask for notifications when it matters.** One assistant asks for notification permission only after you create
  your first scheduled task. A monitoring task notifies "only when there is something worth reporting"
  ([help page](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)).
- **Live Updates stay visible.** Android 16 Live Updates are the one kind of notification not folded into the
  lock-screen shelf ([Android developers](https://developer.android.com/develop/ui/views/notifications/live-update)).

### Chat list

- **A drawer is still the phone norm:** search, New chat, and pinned chats first
  ([redesign review](https://android.gadgethacks.com/news/google-gemini-android-app-gets-major-ui-overhaul/)).
- **Show which chats need you.** One app shows "which threads finished or need you".
- **Don't hide ordinary chats.** When one assistant hid them behind new concepts, daily users pushed back hard and the
  chats were restored ([forum](https://community.openai.com/t/feature-request-bring-back-the-classic-chat-history-sidebar/1390211)).

### Composer

- **One row that grows.** A recent redesign: one floating input row that grows, one "+" for attachments, the model
  picker at the bottom right of the input so it can change mid-chat, and one Tools button.
- **Don't take the model picker away.** When one assistant removed it from its Android chat, paid users called that
  "a serious UX regression" ([forum](https://community.openai.com/t/the-model-picker-disappeared/1389766)).
- **Help with typing.** Coding clients add `/` and `@` autocompletion, prompt history and pinnable quick actions,
  because typing long prompts on a phone is a pain.
- **Voice in the chat.** One assistant moved voice into the chat, so a spoken answer is also written down
  ([news](https://techcrunch.com/2025/11/25/chatgpts-voice-mode-is-no-longer-a-separate-interface/)).

### Settings

- **Short, grouped by what people think about:** model or mode (in the composer, not in Settings), notifications,
  memory, voice, appearance.
- **Permission modes are set per chat.** Memory sits under a personalisation page with two switches.

### Polish

- **Light haptics,** for example while text streams, with a switch to turn them off.
- **48 dp touch targets.**
- **Fewer controls on screen,** the stated goal of one redesign.
- **The composer and actions stay at the bottom,** within thumb reach (judgement).

### What users complain about

- Auto-scroll that snaps back while you read a streaming reply
  ([forum](https://community.openai.com/t/chatgpt-wont-let-me-scroll-down-while-its-writing/1130778)).
- Familiar controls moved without warning.
- Approvals that silently fail.
- Agents that spin with no visible progress.
- Costs that drain quietly.
- Android treated as the neglected sibling of iOS.

## 5. Keep, move, drop, add: our UI elements

Compared with what the app had on 2026-11-02 (the numbers in brackets are spec sections). Nothing here undoes an
owner decision. Where a row touches one, the decision is linked and the change is only a question for the owner.

| Element (spec) | Verdict | Why |
|---|---|---|
| Drawer with search, pinned chats, swipe archive/delete, working and unread dots (3.13) | **Keep** | The phone norm. The dots answer "which chats finished or need me". The gestures are an [owner decision](../decisions/session-list-gestures.md). |
| Drawer row: "needs your input" state | **Add** | We show working and unread, but not "waiting for you". Hermes Desktop has an amber "Needs your input" dot, one remote client answers approvals from its list, and Hermes [#50718](https://github.com/NousResearch/hermes-agent/issues/50718) asks for it. |
| Header: ☰, title, ⋮ (3.2) | **Keep** | Standard and expected. |
| Header status dot (3.2) | **Keep, quieter** | Useful when something is wrong, noise when everything is fine (judgement). Show it only when not green, or make green very dim. |
| Header Auto button: Off / Auto access / Full access (3.2) | **Keep, consider moving** | A few permission modes per chat is what the best apps do. It is per chat and changes mid-chat, like the model, so it could sit next to the model chip in the composer (judgement). |
| Canvas button and swipe-left (3.7) | **Keep** | Our answer to long output on a small screen. The [OpenUI decision](../decisions/openui-cards-inline.md) keeps interactive HTML there. |
| Connection banner (3.2) | **Keep** | Honest status beats a spinner: say what's wrong and offer the fix. |
| Reasoning block: "Thinking…" then "Thought process" (3.3) | **Keep, small change** | Matches the norm. Show the duration ("Thought for 12 s"). |
| Tool cards collapsed, runs of 3+ folded (3.3) | **Keep, fold further** | Matches the norm. When a turn ends, fold *all* its tool calls above the answer into one line ("Worked 1 m 20 s · 14 steps · 1 failed"), so a finished chat reads as questions and answers. |
| Live status bar: spinner, status, elapsed, tok/s, ctx %, goal, tasks (3.2) | **Keep, trim** | Elapsed time, the current step and the to-do list are what people watch. Tokens per second is a developer number (judgement): keep it in the reply stats and the context sheet, not in the live bar. |
| Reply stats line `~41 tok/s · 1m 23s · ctx 2%` (3.3) | **Move** | Cost and tokens are a top Hermes complaint, so the information stays. But a stats line under every reply is visual noise on a phone (judgement). Show it on tap, like the time, and add the turn's cost when Hermes knows it. |
| Reply actions: Copy, Read aloud, Retry, Branch (3.3) | **Keep, maybe slim** | Copy and Retry are used everywhere. Branch is a power feature and could go into a long-press or "more" menu, leaving three icons (judgement). |
| Changed files card, file checkpoints (3.3, 3.5) | **Keep** | The phone-sized answer to "what did it change?", since flat diffs are painful on a phone. |
| Context ring and context sheet, compress hint (3.4, 3.5, 3.2) | **Keep** | They answer the Hermes complaints about token visibility. The context sheet already shows the session's cost. The compress hint should say what is kept, because compaction hiding history is a complaint ([#70846](https://github.com/NousResearch/hermes-agent/issues/70846)). |
| Composer: model chip with reasoning level (3.4) | **Keep** | Removing the model picker drew complaints elsewhere, and the leading apps put it *in* the composer. |
| Composer: `+`, `/`, Live, Dictate, Send/Steer/Stop (3.4) | **Keep** | Matches the leading apps. Skills as `/commands` is how Hermes users already work. Live and dictation are the phone's advantage. |
| Queued messages, stash, quotes, drafts, offline outbox (3.2, 3.4) | **Keep** | Hermes's own `busy_input_mode` (interrupt / queue / steer) shows people want this. They stay quiet until used. |
| Chat scrubber (3.2) | **Keep** | Solves long agent chats on a small screen, and only appears in long chats. |
| Approval sheet, not dismissible (3.6) | **Keep, add** | Big buttons and the exact command match the best apps. Add a plain-language *why* line from the agent ([#27604](https://github.com/NousResearch/hermes-agent/issues/27604)). Let the person read the chat behind it by shrinking the sheet to a bar, not by dismissing it. Approvals from sub-agents must reach it too ([#133514](https://github.com/NousResearch/hermes-agent/issues/133514)). |
| Approvals from the notification, unlock required (3.6, 4.3) | **Keep** | Matches the remote clients. The unlock rule is an [owner decision](../decisions/no-actions-from-locked-phone.md). Make sure a tap visibly confirms it reached Hermes; silent failure is a known bug class elsewhere. |
| Status chip as a Live Update with Stop; Done chip; icon badge (4.3) | **Keep** | The same model as the on-device assistant closest to ours. |
| Background app card with thumbnail, Take over, Stop (3.10) | **Keep** | The same as "View progress" and "take over" in the leading agents. |
| Activity banner for other chats (3.2) | **Keep, merge later** | Useful, but it overlaps the drawer dots and the status chip (judgement). If the drawer gets a "needs you" state, the banner could show only chats that need you. |
| By the way pull-up (3.12) | **Keep** | Mirrors Hermes's `/btw`. The pull distance is an [owner decision](../decisions/btw-pull-up-harder.md). |
| Hermux hub: Skills, Memory, Scheduled jobs, Files, Projects, Canvas gallery (3.14) | **Keep, reorder** | Skills, cron and memory are three of the four most-used Hermes features. Put Scheduled jobs first, and let a cron run open as a chat with an unread dot ([#75123](https://github.com/NousResearch/hermes-agent/issues/75123)). |
| Settings (3.15) | **Keep, slim the top level** | The top level should read as Appearance, Voice, Notifications, Models, Permissions, Memory, Connection, About. Advanced settings, API keys and Last start-up are for the few: one "Advanced" row (judgement). |
| Notification settings | **Add** | We have no simple control in the app. The best model is two switches: tell me when a task finishes, and when Hermux needs me. |
| Bots (3.16) | **Keep** | Hermes profiles; heavy users have several. |
| Messaging-gateway UI (Telegram and the rest) | **Leave out** | The most-used Hermes surface, but the [owner decision](../decisions/app-is-the-only-front-end.md) is that this app is the only front end. |

## 6. Principles for an appealing phone agent app

**Functional**

1. **Show progress, not machinery.** One line for what Hermux is doing now, with the elapsed time and step count.
   Arguments, output and JSON stay one tap away. *Example:* "Searching the web · 0:42 · step 5"; when the turn ends,
   it folds to "Worked 1 m 20 s · 14 steps".
2. **The answer is the hero.** A finished chat should read like questions and answers, with the work folded above
   each answer. *Example:* a cron morning brief opens as a clean page, not 30 tool cards.
3. **Ask rarely, ask clearly, and say why.** Use per-chat modes instead of more prompts. When asking, give the plain
   action first, then the exact command, then the reason. Big buttons; Deny always visible. *Example:* "Delete 3 files
   in Downloads? Hermux: they are the duplicates you asked me to clean up." Allow once / Allow this chat / Deny.
4. **Never leave the person guessing.** Every tap that sends something to Hermux gets a visible acknowledgement, and
   every failure says what to do next. *Example:* after Allow in a notification, the chip changes to "Allowed ·
   running" at once.
5. **Notify for outcomes and blockers only:** finished, needs you, failed. Nothing for "still working"; that is what
   the ongoing chip is for. *Example:* "Morning brief ready", with the first line of the brief.
6. **Make cost and context visible but quiet.** One glanceable ring, with details on tap. *Example:* the ring turns
   amber at 80 %, and the sheet says "$0.42 this chat · 61 % context".
7. **Never fight the reader.** Stop auto-scroll when the person scrolls up; the newest-message button brings them back.
   We already do this; keep it through the revamp.
8. **One-handed first.** What you use while a reply runs (Stop, Steer, the model, Live) sits in the bottom third. The
   top of the screen holds things you use rarely.
9. **Voice is a first-class input, and every spoken answer is also written down.** Live mode already does both.

**Visual**

1. **Fewer, calmer controls.** Each screen has one obvious primary action; secondary actions go in ⋮ or a long-press.
   Count the always-visible icons in the header and composer, and remove one for every one added.
2. **Typography over boxes.** Full-width reply text with generous line height. Bubbles only for the person's messages.
   Tool runs as thin single lines, not cards with borders, until opened.
3. **Colour means state.** Green is working or ok, amber needs you, red is danger or failure, and the accent marks the
   next action. Nothing else is coloured. All colours come from the theme variables
   ([decision](../decisions/light-theme-colours.md)).
4. **Motion explains, never decorates.** Sheets slide from where they were opened and folded runs expand in place.
   Haptics only for confirmations: sent, allowed, picked.
5. **Readable first.** Body text at least 16 px, with contrast checked in Dark, OLED black and Light. The Hermes
   dashboard's most-reacted complaint is "hard to read".
6. **Phone-native, not a web page.** No system dialogs or native form controls
   ([decision](../decisions/no-browser-dialogs.md), [decision](../decisions/no-native-form-controls.md)), 48 dp touch
   targets, and Android Back always does the expected thing.

## 7. Recommended changes, ranked by value

As written on 2026-11-02. Their state now is in [ui-revamp-overview.md](../status/ui-revamp-overview.md).

| # | Change | Value | Effort |
|---|---|---|---|
| 1 | **"Needs you" everywhere**: an amber state on drawer rows, the icon badge and the activity banner for chats waiting on an approval or question, with Allow/Deny reachable without opening the chat. | Approvals are the most common thing people do with an agent on a phone, and today a waiting chat looks like a working one. | M |
| 2 | **Fold a finished turn's work into one summary line** ("Worked 1 m 20 s · 14 steps"), and show the reasoning time. | Makes chats readable: the biggest visual calm-down for the least risk. | S–M |
| 3 | **A plain-language "why" on approvals**, a sheet that shrinks to a bar so the chat stays readable, and a visible "sent" confirmation after answering from a notification. | Safety and trust; answers Hermes [#27604](https://github.com/NousResearch/hermes-agent/issues/27604) and [#133514](https://github.com/NousResearch/hermes-agent/issues/133514). | M |
| 4 | **Cost next to context**: the session cost is already in the context sheet; add per-turn cost on tap, and drop tok/s from the live bar and from the default reply line. | A top Hermes complaint, and less noise at the same time. | S |
| 5 | **Two notification switches** in Settings, "When a task finishes" and "When Hermux needs me", with cron results opening as a chat with an unread dot. | Matches the best apps, and fixes both "too quiet" and "too noisy" with one rule. | M |
| 6 | **A slimmer Settings top level**, with one Advanced row for everything Hermes-specific. | The first impression for new users, with nothing removed. | S–M |
| 7 | **Hub: Scheduled jobs first**, with the next run and last result on the card. | Cron is the second job people use Hermes for. | S |
| 8 | **Quieter chrome**: dim or hide the green status dot, consider moving the Auto mode next to the model chip, put Branch in a "more" menu. | Visual calm; each is a small change the owner should approve. | S each |
| 9 | **Decide on the name clash** with the agent maker's own app. | Settled: the app is now Hermux. | Done |

Items 1 to 3 change shared files (`web/src/App.tsx`, `web/src/styles.css`, `web/src/gateway.ts`), so they should go
one after the other, not side by side (see AGENTS.md, "Working in parallel").
