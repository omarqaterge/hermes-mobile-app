# What's new

User-facing changes, newest first. Each release section collects what shipped since the previous tag.

## Unreleased

- A reply in a chat with a photo no longer leaves "Thinking…" showing for about 3 minutes after it finished (Hermes's
  memory-and-skills review after the reply now shows as "Learning" and clears when it ends).

## v0.8.40 (2026-10-20)

- **Approval buttons are always reachable**: a very long warning no longer pushes Allow/Deny off the screen (the text
  scrolls, the buttons stay), and a security warning Hermes repeats many times shows once with a count (×20; not yet
  seen on a real phone).
- Leaving the app with an approval or a question still unanswered puts its buttons on the status chip (before, the chip
  only had them when the request arrived while the app was closed).

## v0.8.39 (2026-10-16)

Everything since v0.8.9.

### Notifications and the status chip
- **Tap the status chip to see the progress**: the chat's name, what Hermes is doing right now, the task it is on,
  "2 of 5 tasks" with a bar of one segment per task (when Hermes keeps a task list; otherwise the number of steps),
  how long the turn has been running, and any other chat that is busy. A **Stop** button ends the turn.
- The Done chip shows the start of the reply, the number of steps and how long it took.
- A sticky green **Done** chip lists the chats that finished while the app was closed ("✅ 3 chats finished", one tap to clear).
  It goes away by itself once you open the app on that chat.
- **App-icon badge** with the number of unseen chats (works on Xiaomi/HyperOS launchers).
- **Read-aloud player** in the notification shade: pause, back 10 s, forward 10 s, stop; media keys work too.
  The reply being read keeps playing when you leave the app.
- Approvals answered from a notification apply only to the request they show.

### Chat
- **Library**: keep canvas documents in categories; Hermes can save into it on request.
- **Photo viewer**: pinch and double-tap zoom, save to Pictures/Hermes, share, open with another app.
- **Edit and Retry keep your photos and files**: they are sent again with the edited message.
- **Links work everywhere**: in your messages, tool cards, thinking, sheets and the canvas; they open in your default app.
- **Favourite models**: star a model in the model picker and it shows in a Favourites section at the top.
- **/yolo** and **/fast** switch instantly for the current chat (YOLO chip above the composer).
- A photo attached in a new chat before Hermes restarted is no longer lost: the chat is made again with the same
  model and the photo, instead of the message failing with "session not found".
- Photos and files you attached survive a dropped connection, and go along with a message queued while offline.
- **File checkpoints**: see every folder a chat changed, the diff per file, and restore a folder or a single file (undoable).
- Canvas: "Saved ✓" turns back into "<when> · You/Hermes".

### Voice / Live mode
- Approvals in Live mode are a short spoken question ("Hermes needs your permission. Allow or deny?"), answered by voice (tested in the browser, not yet with a voice on a phone).
- Leaving the app closes the microphone but lets Hermes finish reading.

### Models and setup
- **Subscription sign-ins** and a first-run "connect a model" screen.
- The model picker renews an expired Claude login so new models show up (not yet seen with a really expired login).
- **One-tap app update** from Settings → About (downloads the latest release and opens the installer). It shows the latest release's number and says so when you already have a newer build.
- **Hermes can use the phone** out of the box (files, Termux:API, Shizuku, no root), with a Setup check that fixes what's missing.

### Faster and lighter
- **Faster start-up**: opening the app after the phone has been idle no longer waits seconds for the chat (a Hermes fix
  shipped with the app: skill scans 1.8 s → 0.5 s; the app asks for less at start-up).
- Coming back to the app no longer drops the connection or repeats the last turn.
- The "reviewing" banner after a reply shows right away (it could lag up to 3 s).
- Battery: no permanent wake lock, far fewer background polls; the phone reaches deep sleep.
- Fixes to Hermes itself ship with the app (e.g. a message lost after switching models).
