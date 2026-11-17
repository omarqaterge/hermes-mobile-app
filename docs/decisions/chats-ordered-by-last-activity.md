# Chats are ordered by last activity, read when the panel opens

**Decided:** 2026-11-16, by the owner, for the interface redesign (built 2026-11-17). This replaces "a message never
moves a chat" (the list used to be in the order the chats were created).

Chats were grouped by the day they were made, and a message never moved one. A chat someone continued this morning
could sit under "Older", and they had to hunt for it. The line under each title said "22 h · 4 msgs": the message count
told nobody anything they act on, while whether the chat is working or finished does.

**So:**

- **The default order and the date groups** (Today, Yesterday, This week, This month, Older) follow each chat's last
  activity, newest first.
- **Rows never move while someone is looking at them.** The order is a snapshot of each chat's last activity, taken
  only when the side panel opens (before its rows come into view), when the bot changes, when a chat is created,
  deleted, archived or restored, and, while the list is docked on a wide screen, when another chat is opened or the
  app returns to the foreground. It is never taken while a finger is on the list, during a drag or a swipe (one asked
  for then waits until the finger lifts), and never just because a message arrived. Moving rows under the eye makes
  people tap the wrong chat; a reply landing elsewhere can wait for the next look at the list.
- **A custom order stays as it is.** After a drag the list keeps the person's order exactly as before; "Sort by recent"
  still sorts it once by activity and keeps it custom. Pinned chats keep their pin order.
- **The line under a title:** the time since last activity, then a state word when there is one ("Working" while the
  chat runs, "Finished" while it is unread; the title's band of light and the unread dot stay), then the source when
  the chat did not come from this app. A scheduled job's run shows the job's name with a clock instead of the word
  "cron". The state is text, so it never rests on a colour, and screen readers hear it once.
- **No message count.** The app no longer asks the plugin for it; the plugin keeps the route so an older app still
  works.
- Rows nested under a chat (sub-agents, background tasks, a later task) move with their chat: the order is of
  top-level chats.
