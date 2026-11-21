---
rank: normal
---
- **Over the lock screen, only commands that show something run.** `/help`, `/status`, `/usage` and a few others still
  work there; everything else, such as `/approvals off`, `/cron run`, a quick command or an alias, waits for you to unlock,
  and a command already on its way stops if the phone locks while it waits. `/yolo` can still turn Full access off;
  `/yolo on`, the side chat (`/btw`) and its pull-up gesture wait for an unlock. A command also waits when Hermes can't
  fully list its own commands. Checked in a desktop browser. Not yet tried on a phone.
- **Turning approvals off now asks first.** `/approvals off` and `/approvals smart` show the same warning as Full access,
  saying they apply to every chat of the bot. Checked in a desktop browser. Not yet tried on a phone.
- **Over the lock screen, Edit and Retry wait for an unlock.** The buttons aren't shown there, an edit left open
  closes, and the side chat closes when the phone locks; everything comes back after you unlock. Checked in a desktop
  browser. Not yet tried on a phone.
