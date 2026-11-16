# 08: Health data for the agent

Read [README.md](README.md) first. Then read the decision
[phone-data-read-only](../decisions/phone-data-read-only.md) and the contract in
[docs/status/phone-data.md](../status/phone-data.md): this design adds one kind to that system and changes none of
its rules.

**Effort:** M. **Areas:** Java, plugin, web. **Depends on:** the phone-data contract. **Android:** 14 and later only.

## Goal

"How did I sleep this week?", "am I walking less than last month?" The agent can read daily totals from Android's
health store (steps, sleep, resting heart rate, exercise minutes), read-only, off by default, behind the same switch,
fingerprint and per-read approval as contacts or the calendar.

## What exists today

- `phone_data` with six kinds; the app (`PhoneData`, `PhoneDataRoute`, `PhoneDataGrants`, `PhoneDataWording`, the
  `phonedata` package) is the gatekeeper; chats that have read are protected afterwards (`PhoneDataChats`, the taint
  rules, spec 2.3).
- The app is built without Gradle or support libraries (`android/build.sh`: `aapt2`, `javac`, `d8`), so only
  framework APIs are available. The health store is a framework API from Android 14
  (`android.health.connect.HealthConnectManager`, API 34).

## Owner decisions needed

1. **Whether to add health at all.** It is the most sensitive kind so far and it goes to the model provider like the
   others. Recommended: yes, daily totals only, never single measurements.
2. **Which measures.** Recommended first set: steps, sleep duration, resting heart rate, exercise minutes. Not:
   weight, cycle tracking, blood values, location routes.

## Design

### The kind

`kind: "health"`. Arguments: `metric` (`steps`, `sleep`, `resting_heart_rate`, `exercise`), `from_ms`, `to_ms`
(default the last 7 days; at most 31 days apart). Unknown keys refused, as for the other kinds.

Rows, one per local calendar day, newest first:

| Metric | Fields |
|---|---|
| `steps` | `day` (`YYYY-MM-DD`), `count` |
| `sleep` | `day` (the day the sleep ended), `minutes` |
| `resting_heart_rate` | `day`, `bpm_avg`, `bpm_min`, `bpm_max` |
| `exercise` | `day`, `minutes`, `sessions` |

No source app names, no device names, no timestamps finer than the day, no notes. At most 31 rows, so the 16 KB cap
is never near.

### App side

- Manifest: `android.permission.health.READ_STEPS`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_EXERCISE`. An
  activity-alias for `android.intent.action.VIEW_PERMISSION_USAGE` with category
  `android.intent.category.HEALTH_PERMISSIONS`, which Android requires: it opens `MainActivity` on a short page
  saying what Hermux reads and why (the text of `docs/privacy.md`'s health paragraph).
- A new reader `phonedata/HealthReader.java`, all of it behind `Build.VERSION.SDK_INT >= 34`: one
  `aggregateGroupByPeriod` call per metric with a one-day period, on the reader thread, 10-second limit.
- `PhoneData.permission` and the status answer learn the kind; under Android 14 the kind reports `unsupported` and
  the switch is not shown.
- Settings → Phone data gets a switch **Health (daily totals)**. Turning it on asks for the fingerprint as the others
  do, then opens the health permission screen for the four read permissions
  (`HealthConnectManager.ACTION_REQUEST_HEALTH_PERMISSIONS` or the platform's contract: Check first). The switch is on
  only when at least one permission was granted; metrics without a permission answer `no_permission`.
- `PhoneDataWording` writes the approval text from what will be read: "Read your daily step counts for the last 7
  days?"
- Locked phone: refused, like every kind.

### Plugin side

`phone_data.py`: add the kind to the schema, `validate` (metric names, the 31-day limit, the same "measured from now"
margin), the label "Reading phone data: health", and the prompt section's list. Nothing else changes: nonce, approval
text, taint reporting and result cleaning are shared.

### The background-read question

The agent often reads while the app is not in front (an approval answered from the notification). The health store
may refuse reads from an app that is not in the foreground unless it holds the background-read permission
(`READ_HEALTH_DATA_IN_BACKGROUND`, API 35). The first version does **not** declare it: when a read fails for that
reason the tool answers "Open Hermux to let it read health data" (`needs_foreground`, a new outcome), and the
approval's Allow from a notification opens the app for this kind. Whether to declare the background permission is a
later owner decision.

## Build steps

1. Extend the contract section of `docs/status/phone-data.md` first (kind, args, rows, outcome), since app and plugin
   both build against it.
2. `HealthReader.java`, `PhoneData`/`PhoneDataRoute`/`PhoneDataWording` changes, manifest; extend
   `tools/test_phone_data_grants.sh` and the wording test.
3. `phone_data.py` and `tools/test_phone_data.py`.
4. The Settings switch (`Settings.tsx`), hidden when unsupported; `phone-data-request.ts` wording for the approval
   card; the privacy page.
5. E2E at the end of `29-phone-data.cjs`.

Shared files touched: `AndroidManifest.xml`, `MainActivity.java` (the permission result), `Settings.tsx`.

## Tests

- Java: argument checks (metric, ranges), day bucketing across a daylight-saving change, empty store, a metric
  without permission.
- Plugin: validation equals the app's; the new outcome; the result shape.
- E2E: the switch hidden on an unsupported phone (fake bridge status), the approval text for each metric.
- Phone, Android 14 or later with a health app that has data: each metric; a read with the app closed; revoking a
  permission in system settings and reading again; `tools/api-check.sh` clean.

## Spec and changes

Spec 4.1, 4.2 (permissions, the alias), 3.15, 5.2, 5.3, 2.3, `docs/android-versions.md` (Android 14), `docs/privacy.md`,
`docs/security.md`, the decision file (a short addition: health joins, daily totals only). `changes/` file.

## Check first

- The exact framework way to request health permissions without the support library on Android 14, 15 and 16.
- Whether a foreground service counts as "foreground" for health reads on each of those versions.
- Whether the store aggregates resting heart rate, or only raw heart rate (then compute min, max and average of the
  day's samples in the reader and drop "resting" from the name).
- That declaring health permissions has no effect on installs from outside an app store.

## Out of scope

Writing health data, single measurements, weight and medical values, a chart on Hermux's own screens.
