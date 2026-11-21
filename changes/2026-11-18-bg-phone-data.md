---
rank: normal
---
- **Background tasks can't carry your phone data out.** Once a chat has read data from your phone, a background task started
  from it can't send anything out, because nobody can be asked first. The app also says so when you try `/bg`, a scheduled job
  or a board task from such a chat, and you can still start one from a new chat. Other chats keep these commands as they
  are. Checked against a test copy of Hermux in a desktop browser. Not yet tried on a phone.
- **Copies of a chat stay protected.** A branch of a chat that has read your phone data, and a chat that finds that chat's
  messages through a search, now ask before sending anything out, like the original. A branch made before the chat read
  anything, or a chat that only listed other chats' titles, is left alone. Checked against a test copy of Hermux.
  Not yet tried on a phone.
- **Over the lock screen, only commands that show something run.** `/help`, `/status`, `/usage` and a few others still
  work there; everything else, such as `/approvals off`, `/cron run` or a quick command, waits for you to unlock. `/yolo` can
  still turn Full access off. Checked in a desktop browser. Not yet tried on a phone.
- **Turning approvals off now asks first.** `/approvals off` and `/approvals smart` show the same warning as Full access,
  saying they apply to every chat of the bot. Checked in a desktop browser. Not yet tried on a phone.
- **A background task of a chat that has read your phone data can only read.** It can't run a script it wrote, start
  Hermes, use Shizuku's shell, use an app on the phone or change Hermes's files. Board commands that change a board are refused
  in such a chat too. Checked against a test copy of Hermux. Not yet tried on a phone.
- **Phone-data chats ask before changing what runs later.** In a chat that has read your phone data, writing into Hermes's
  or the app's folders, a shell start-up file such as `.bashrc` or a folder of programs now asks first. A background task of
  such a chat can only read: it has no terminal at all. Checked against a test copy of Hermux. Not yet tried on a phone.
- **Over the lock screen, quick commands and aliases wait for an unlock**, and a command already on its way stops if the
  phone locks while it waits (for example while the `/approvals off` warning is up). Checked in a desktop browser. Not yet
  tried on a phone.
- **Phone-data chats ask more often before touching what runs later.** In a chat that has read your phone data, a terminal
  command or a script now asks whenever it names Hermes's folders, a shell start-up file or a folder of programs, even just
  to read it, and whenever it writes to a file whose name is only known when it runs. Expect a few more questions in such a
  chat. Checked against a test copy of Hermux. Not yet tried on a phone.
- **Over the lock screen, `/yolo` only turns access off.** `/yolo on` and a bare `/yolo` wait for an unlock, and so do
  the side chat (`/btw`) and its pull-up gesture. A command also waits when Hermes can't fully list its own commands.
  Checked in a desktop browser. Not yet tried on a phone.
