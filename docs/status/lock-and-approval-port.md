# Lock screen commands and per-session approval confirmation on main (2026-11-21)

Two security fixes from the `redesign` branch ported to `main`, so the released line has them too.

**State (2026-11-21):** done in one PR into `main`, waiting for the owner's merge.

1. Over the lock screen the lock is checked before a slash command is sent; only a short list of commands that only
   show something runs there (`lockSafeCommand`), and the lock is checked again after each wait. Unlocked,
   `/approvals off` and `smart` ask with the Full access warning (spec 3.4).
2. "Confirm approvals with fingerprint" files a confirmation under the live Hermes session (runtime id) instead of the
   stored chat; the notification's Allow always opens the app while the setting is on and the phone has a screen lock
   (spec 3.6, 4.3).

Not ported (not on `main`): the `/bg`, `/cron add` and board-command refusal in a chat that has read phone data, and the
sub-agent and kept-chat routing.

**Next:** the owner merges; then delete this file.

**Needs a real phone:** the checks listed in [docs/manual-tests.md](../manual-tests.md) under "Confirm approvals with
fingerprint" and "Slash commands over the lock screen".

**Links:** spec 3.4, 3.6, 4.3; decisions [approval-needs-fingerprint](../decisions/approval-needs-fingerprint.md) and
[no-actions-from-locked-phone](../decisions/no-actions-from-locked-phone.md).
