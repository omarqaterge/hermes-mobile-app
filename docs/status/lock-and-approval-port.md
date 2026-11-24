# Lock screen commands and per-session approval confirmation on main (2026-11-21)

Two security fixes from the `redesign` branch ported to `main`, so the released line has them too.

**State (2026-11-21):** done in one PR into `main`, waiting for the owner's merge.

1. Over the lock screen the lock is checked before a slash command is sent; only a short list of commands that only
   show something runs there (`lockSafeCommand`), and the lock is checked again after each wait. Unlocked,
   `/approvals off` and `smart` ask with the Full access warning (spec 3.4).
2. "Confirm approvals with fingerprint" files a confirmation under the live Hermes session (runtime id) instead of the
   stored chat; the notification's Allow always opens the app while the setting is on and the phone has a screen lock
   (spec 3.6, 4.3).

After the security review (2026-11-21), on the same PR: the command text sent to Hermes is the text judged
(`hermesBody`, so U+FEFF can't hide `/approvals off`); the side chat closes over the lock screen; Edit and Retry wait for
an unlock there (they were never checked, before the port too); the contract compares `slash.exec` and
`command.dispatch` for a quick command alias. The first three are fixed on `redesign` in a separate PR.

After the re-check (2026-11-21): a mix of slashes and spaces in front (`/ /approvals off`) no longer skips the warning.
One reading (`hermesSlash`) gives the judged words and the text sent, at every alias step and for `/yolo off`; a
generated-text test compares it with a port of Hermes's own steps (checked once against Python itself). Same fix on
`redesign`.

Not ported (not on `main`): the `/bg`, `/cron add` and board-command refusal in a chat that has read phone data, and the
sub-agent and kept-chat routing.

Brought up to date with `main` (2026-11-24): merged `origin/main` (keeping both the lock-screen mock hooks and `main`'s timer/delay bounds); `tools/check.sh` passed (spec, changelog, attribution, web typecheck, 809 unit tests, all 7 browser e2e shards, patches, and `tools/java-check.sh` including `tools/test_approval_lock.sh`; `tools/api-check.sh` skipped without Android SDK, no phone).

**Next:** the owner merges; then delete this file.

**Needs a real phone:** the checks listed in [docs/manual-tests.md](../manual-tests.md) under "Confirm approvals with
fingerprint" and "Slash commands over the lock screen".

**Links:** spec 3.4, 3.6, 4.3; decisions [approval-needs-fingerprint](../decisions/approval-needs-fingerprint.md) and
[no-actions-from-locked-phone](../decisions/no-actions-from-locked-phone.md).
