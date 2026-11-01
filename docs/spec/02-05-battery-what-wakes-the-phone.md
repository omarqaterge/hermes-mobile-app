### 2.5 Battery: what wakes the phone

Hermes runs under proot, which roughly doubles the cost of anything that polls, so the design avoids polling and
holds the CPU only while there is work (measurements: `docs/battery.md`, `docs/battery-report.md`).

- **No permanent wake lock.** `hermes-services` releases a Termux wake lock left by older versions once per boot
  and removes `termux-wake-lock` from the boot script.
- **Working wake lock.** `HermesService.updateWake` holds one non-reference-counted partial wake lock
  (`hermes:working`) until the latest of: the last status beat + 55 s while a turn works, an approval's deadline
  + 5 s, the cron alarm's hold. A turn whose beats stop for 50 s (`WORKING_TTL_MS`) is treated as over.
- **Cron.** The ticker reports the next due job (`wake_at`); the service sets an exact (or inexact, if exact alarms
  aren't allowed) `RTC_WAKEUP` alarm, holds the CPU up to 150 s when it fires, pokes the ticker on 9122 and releases
  early on `cron_idle`. The alarm time is saved and re-armed after the app restarts.
- **Service timers** use `Handler.postDelayed` (no CPU wake): the update check every 12 h, the one Shizuku check at
  90 s, the bg-app card's 130 s expiry.
- **Page timers** stop or slow down when the page is hidden: the status line's elapsed-time ticker (`useElapsed` in `App.tsx`, 1 s) runs only while a turn runs and the page is visible, and clears itself on `visibilitychange` to hidden, when the turn ends and on unmount; socket beat 15 s (`gateway.ts`), health ping every
  minute while visible and the full `GET /api/status` (~0.26 s of dashboard CPU) every 10 minutes or when the
  status sheet opens (`health.ts`), activity poll 3 s while the banner shows something else 9 s (`activity.ts`),
  canvas list every 6 s only while the panel is open. Chromium freezes the hidden page about a minute in; the
  liveness logic treats that gap as a freeze, not a dead socket.
- **Termux loops:** the app-keeper probes 9121 every 300 s and only starts a Java VM (`am`) when the service is
  down; memory sync runs only if its script exists.
