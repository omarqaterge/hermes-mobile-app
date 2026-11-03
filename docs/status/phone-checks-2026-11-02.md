# Four reported issues checked on the phone (2026-11-02)

**State:** the owner reported four things; each was looked at on the owner's Android 16 phone (app 0.8.69) and in
the code.

- **A. "Launch is slow to load and connect Hermes."** Not reproduced while Hermes runs. Five cold starts (force stop,
  start, read Settings → About → Last start-up): `am start -W` `TotalTime` 129–146 ms; `script` 0.1 s, `painted`,
  `token`, `socket`, `sessions` 0.2 s, `chat-live` 0.2–0.3 s. Opening the app again after 9 minutes in the background
  with the screen off: `HOT` start in 37 ms, no "Connecting" or "Reconnecting" label at any point. Hermes had been up
  3 days, so a start that must also start Hermes was not measured. In that case the page retries with backoff
  (`scheduleReconnect` in `gateway.ts`: 0.6, 1.2, 2.4, 4.8, 9.6, then 15 s apart, so attempts at about 0.6, 1.8, 4.2,
  9.0, 18.6, 33.6 s), so it can notice a Hermes that became ready up to about 15 s late. The phone also had about
  300 MB free memory and 2.6 GB in swap, which fits the earlier "slow first answer after the phone idled" rows in
  [performance-history.md](../performance-history.md).
- **B. "After /yolo I still got asked."** A bare `/yolo` toggles (`setYolo(a, null)` in `gateway.ts`): from **Auto
  access** it goes to Off, by design of the Auto button commit (2026-10-22). With chats starting in Auto (Settings →
  Auto for all chats), typing `/yolo` therefore turns approvals back on; the only sign is the notice "Full access off:
  Hermes asks before risky commands again". "Takes time to activate": `setAccess` runs one at a time, so a `/yolo`
  typed right after a chat opens waits behind that chat's own start-up access switch (a plugin `PUT` plus
  `config.set`). Not tried on the phone (it asked for its screen lock).
- **C. "The Done chip should stay until the chat is opened."** Cause found and fixed (#67): the page counted the open
  chat as read even with the app in the background, and reported that to the service, which removed the chip. Not
  reproduced on the phone, and the fix is not installed there yet.
- **D. "Turn on Autostart for Termux and Hermes Mobile, but there is no Autostart option."** Detection works: the
  phone's `AutoStartManagementActivity` resolves and is exported, and the step opens the Background autostart list,
  which shows Termux, Termux:Boot, Shizuku and the app, all allowed. The app is listed as "Hermes", and App info has no
  Autostart switch on this phone. Fixed in #66 (the step says "Hermes").

**Next:**
- A: fixed in code: the service tells the page as soon as Hermes's dashboard answers (bridge `watchHermes`,
  `window.__hmHermesReady`) and the page reconnects then; the backoff stays as the fallback. Measured on the phone on
  2026-11-03: it connects as the dashboard answers, about 18 s after a restart (`docs/performance-history.md`).
- B: decided and done (`docs/decisions/yolo-goes-to-full-access.md`): `/yolo` from Off or Auto goes to Full access,
  from Full access back to the previous mode; the notice names the mode; the newest access switch wins. Still to see
  on the phone.

**Needs a real phone:** yes. C with a build that has #67 (send a prompt, press Home, the chip stays until the app is
opened); B on the phone.

**Links:** #66, #67, `docs/spec/03-06-approvals-and-questions.md`, `docs/spec/04-03-notifications.md`,
`docs/spec/04-07-shizuku-keeper-autostart-uninstall-updatenotice.md`.
