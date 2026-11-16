# 10: App list and a cap on apps per reply

Read [README.md](README.md) first.

**Effort:** S–M. **Areas:** plugin, web. **Depends on:** none.

## Goal

Two small rules for the hidden screen, both taken from how a phone's own assistant framework limits itself:

1. **A list the user controls.** Settings shows every app Hermux has used, each with a choice: ask each chat (today's
   behaviour), always allowed, or never. "Never" is the new power: a way to say "not my photos app, not my chat app"
   that the built-in sensitive-app pattern can't guess.
2. **A cap.** One reply may use at most 6 different apps. A runaway turn can't wander through the whole phone.

## What exists today

- `phone_app` asks once per app per chat through Hermes's approval gate; `/yolo` skips it. Sensitive apps are refused
  unless `allow_sensitive` is on (`GET`/`PUT /bgapps`, `bgapps.json`). One app at a time (spec 5.2).
- Settings → Background apps has that one switch (spec 3.15).

## Owner decisions needed

1. **Is "always allowed" wanted?** It removes the once-per-chat question for that app. Recommended: yes, but never
   for an app the sensitive pattern matches, and it does not skip design 09's "your turn" steps.
2. **The cap's number.** Recommended 6 per reply; Full access does not lift it.

## The honest limit

Shizuku is required and makes the agent Android's shell user. These rules live in the plugin, which the agent could
edit, and an agent that wants to misuse Shizuku can start an app without `phone_app` at all. So this is a guard rail
for a well-behaved agent that was steered wrong, in the same sense as the phone-data decision's "limit of this gate".
Say so in the Settings text and the security docs; don't describe it as a lock.

## Design

### Data

`bgapps.json` gains `apps`: `{ "<package>": { "label", "rule": "ask" | "always" | "never", "uses", "last" } }`. An app
is added with `ask` the first time it is opened. At most 200 entries; the least recently used `ask` entries are
dropped first, never an `always` or `never`.

### Rules in `phone_app.py` (in `open`, and the resolved app of a link, share or intent)

Checked in this order:

1. `never`: refused with "The user doesn't let Hermux use <label>." No approval is shown.
2. Sensitive and not allowed: today's refusal.
3. The cap: a per-turn set of packages (cleared in `end_session`). The 7th different app is refused with "This reply
   has used 6 apps already. Ask the user before going on." A new reply starts fresh.
4. `always` and not sensitive: no question.
5. Otherwise: today's once-per-chat question.

`list_apps` leaves out `never` apps, so the model doesn't plan around them.

### Settings (Background apps section, `Settings.tsx`)

- Under the existing switch, a row **Apps Hermux has used · N** opens a page:
  - A search field and the apps, most recently used first: label, "used 12 times · yesterday", and a `Segmented`
    control **Ask | Always | Never**. For a sensitive app "Always" is disabled with the note "Sensitive apps always
    ask".
  - **Add an app** opens a `PickerSheet` filled from a new `GET /bgapps/installed` (the labels and packages
    `list_apps` already gets from the host), so the user can put an app on "Never" before Hermux ever tries it.
  - Footnote: "This guides Hermux. It is not a lock: Hermux runs with developer access on this phone (see Security)."
- `PUT /bgapps` accepts `{ apps: { "<package>": { rule } } }` changes; the route validates the rule and that an
  `always` is not sensitive.

## Build steps

1. `phone_app.py`: the store functions (`rule_for`, `note_use`, pruning), the order of checks, the per-turn set, the
   `installed` route's helper. Extend `tools/test_phone_app.py`.
2. The routes in the plugin's dashboard module; `tools/test_phone_access.py` if the routes are tested there.
3. `Settings.tsx`: the row and the page; `settings-search.ts` entries.
4. Mock (`GET /bgapps` with three apps) and e2e at the end of the settings check file that covers Background apps.

Shared files touched: `Settings.tsx`, `mock.cjs`.

## Tests

- Plugin: the order of the five checks; `never` wins over Full access and `/yolo`; the cap counts different apps,
  not opens; the cap resets at turn end and after an error (`api_request_error` calls `end_session`); `always` on a
  sensitive app is refused by the route; pruning keeps `always` and `never`.
- E2E: the list, changing a rule calls `PUT /bgapps`, the disabled "Always" on a sensitive app, adding an app from
  the picker.
- Phone: one pass with a `never` app and with 7 apps in one request.

## Spec and changes

Spec 5.2 (rules, cap, `list_apps`), 5.4 (routes), 5.5 (`bgapps.json` fields), 3.15 (the page), 2.3 (the limit).
`docs/security.md`. `changes/` file.

## Check first

- Where the per-turn state should live so sub-agents share their parent's cap (the taint code already links
  sub-agents to parents: `phone_taint.ancestors`).
- That `list_apps` data is available without opening the host again (cache its last answer for the picker).

## Out of scope

Moving these rules into the app (would need the host to enforce them and still wouldn't bind a shell user), time
limits per app, a per-app list of allowed screens.
