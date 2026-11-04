# Phone data for the agent is read-only, off by default, and gated by the app

**Decided:** 2026-11-04, by the owner.

The agent should be able to read the phone's contacts, calendar, call log, messages, location and latest photos, but this
data is sensitive, it goes to the model provider, and messages can contain text written by strangers. The agent also runs
in Termux, where it can read the key the plugin uses and edit any plugin setting, so nothing stored or decided on that
side can protect this data.

**So:**

- **Off by default.** One master switch plus one switch per kind in Settings. Turning any of them on asks for the phone's
  biometric or screen lock every time, enforced in the app, not the page. A phone with no screen lock can't turn them on.
  Turning off is instant.
- **Read-only.** No write or send permission is declared, so no sending messages and no changing contacts or calendar.
- **The app is the gatekeeper.** The switches live in the app. A read goes through only with a one-use grant from a real
  tap on Allow in the app, or because the user put that chat in Full access in the app. Hermes saying "approved" doesn't
  count: it says so with no prompt under `/yolo` or `approvals.mode: off`, and the agent can edit that setting.
- **Every read asks**, with wording the app writes from what it will actually read, and only Allow once or Deny. The
  chat's first Allow needs the fingerprint, as in [approval-needs-fingerprint](approval-needs-fingerprint.md).
- **Full access skips the ask, by the owner's choice.** The switches, permissions, limits and locked-phone refusal still
  apply, and each read still shows in the chat. The accepted risk is that text the agent reads can steer it into reading
  more with no prompt.
- **Auto access can't read.** Hermes shows no prompt there, so the tool says to use Off or Full access.
- **Nothing from a locked phone** ([no-actions-from-locked-phone](no-actions-from-locked-phone.md)).
- **Limited and marked.** Results are capped in size and marked as untrusted data, never instructions. Location is coarse,
  with no Termux:API fallback. Photos are metadata only: no image, EXIF or GPS.
- **Never logged.** No names, numbers, message text, queries or coordinates in logs, the diagnostic log or Report a problem
  ([diagnostic-log](diagnostic-log.md), [report-a-problem](report-a-problem.md)). Results do stay in the chat history.

## The limit of this gate: Shizuku

**Decided:** 2026-11-04, by the owner: the fingerprint stays on the chat's first Allow only, not on every read.

Shizuku is required ([shizuku-is-required](shizuku-is-required.md)), and it lets the agent act as Android's shell user. So
the switches and approvals protect the `phone_data` tool, but they don't fully stop an agent that misuses Shizuku:

- `phone_app` can open Messages or Contacts and read the screen, after its own once-per-app ask.
- A shell command could tap Allow with `input tap`. It can't fake a fingerprint, but after a chat's first one, later Allows
  don't ask for it.
- A shell command might read some of this data directly with `content query`. This has not been tested.

**So:** Say this plainly in the privacy doc. Don't describe the gate as stopping everything the agent can do on the phone.
