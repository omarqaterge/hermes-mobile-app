# 16: Sources under web answers; real-time voice

Read [README.md](README.md) first. Two small topics that came from the same Hermes release notes. The first is ready
to build. The second turned out to be a watch item: read why before spending time on it.

## Part A: sources under web answers

**Effort:** S–M. **Areas:** web. **Depends on:** none.

### Goal

When a reply used a web search or read a page, show where it came from: a row of small source chips under the reply
(site name and title), each opening the page. Users can check an answer without digging through tool lines.

### What exists today

- Tool lines in plain words (`toolsay.ts`): a web search or page read shows as one line in the turn; its result can
  be opened (`GET /tool-result`).
- Links in replies go through the Markdown renderer; in a chat that has read phone data they ask first.
- At the pinned build some providers put private-use citation markers in the text (characters U+E200 to U+E202
  around ids such as `turn0search0`). Hermes's desktop app strips them because they can't be resolved to a source.
  **Hermes gives the client no structured list of sources**, so the chips are built from the turn's own web tool
  calls.

### Design

- `web/src/sources.ts` (pure): `sourcesOf(turnItems)` walks the turn's tool items for the web tools (`web_search`,
  `web_extract`, the `browser_*` navigation tools and any other the tool list marks as web) and collects
  `{ url, title, site }`: from a page-read tool's arguments (the address), and from a search tool's result (each hit's
  address and title, when the stored result is small enough to be on the item; never fetched just for this). It
  keeps `https` and `http` addresses only, removes duplicates by address without its fragment, keeps the order of
  first use, caps at 8 with "+N more".
- **Which sources count.** A search returns many hits the model never used. So: pages the model actually read always
  count; search hits count only when their address or site name also appears in the reply's text. If nothing
  qualifies, no row.
- `Sources` component (in `ChatItems.tsx` or its own file) under the reply's text, above the actions row: chips with
  the site's name (the host without `www.`) and the title cut to 40 characters. No favicons (they would be remote
  requests). A tap opens the address through the same path as a link in the reply, so the phone-data "Open this
  address?" rule applies unchanged.
- The same pass strips the citation marker characters and the id text between them from the reply
  (`stripCiteMarkers` in `text.ts`), so they never show as boxes.
- Stored chats get the row too, since it is computed from the items.

### Build steps, tests, spec

1. `sources.ts` and `sources.test.ts`: duplicates, fragments, a search with 10 hits of which 2 are named in the
   reply, a page read, a `javascript:` address dropped, the cap, the marker stripping (single id, id list, inside a
   table cell).
2. The component and CSS (`.sources`, `.source-chip`; variables only).
3. Mock: a prompt text `search the web` whose turn has a search tool item with three hits and a reply naming one.
   E2E at the end of `07-reply-rendering.cjs`.
4. Spec 3.3 (the row, the rule for which sources count, marker stripping), 2.6. `changes/` file.

### Check first

- The exact shape of the web tools' arguments and results at the pinned build, and how much of a result is kept on
  the chat item (`gateway.ts`).
- Whether the citation markers reach Hermux at all with the providers in use.

## Part B: real-time voice (watch item, nothing to build now)

### What was claimed, and what the pinned build has

Release coverage of Hermes 0.20 described "real-time voice with interruption". In the pinned build's source the only
real-time voice code is inside the meetings plugin (`plugins/google_meet/realtime/`), and the client contract's voice
calls are still `voice.record`, `voice.toggle` and `voice.tts`. There is no general speech-to-speech call a client
could use.

Hermux's Live mode already does the part users feel: it listens while speaking and stops speaking when the user
talks over it (`bargein` in `live.ts`, spec 4.6), with dictation on the phone.

### What would make this worth building

A speech-to-speech path removes the gap between the user finishing and the answer starting (today: dictation ends,
text goes to the model, the reply streams, the reader speaks). It would need a provider with a real-time voice model,
audio streamed from the phone to it, and tool calls bridged back to Hermes. That is a large design with a privacy
change (raw audio leaves the phone; today only text does).

### What to do

- At each Hermes upgrade (spec 6.4, "Moving to a newer Hermes"), search the new build for a general real-time voice
  call in `gateway-contract.openrpc.json`. If one appears, write a design then: where the audio goes, how Live mode's
  states (`off`, `listening`, `thinking`, `speaking`) map to it, the lock-screen rules, and the privacy page.
- Until then, improve what exists if wanted: measure Live mode's turn delay on a phone and list where the time goes
  (`docs/performance-history.md` has the method for start-up; do the same for a spoken turn).

### Owner decision needed (only if it comes up)

Whether raw audio may leave the phone for a real-time voice provider. Today it never does.
