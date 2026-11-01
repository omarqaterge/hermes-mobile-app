### 3.11 Read-aloud player (and the web side of voice input and Live mode)

**Files:** `TtsPlayer.tsx` (the player), `voice.ts` (read-aloud, dictation, voice settings, shell events), `live.ts` (the Live mode loop).

Android does the speaking and listening (TextToSpeech, SpeechRecognizer; see section 4.6, `Voice.java`). The web side is `web/src/voice.ts` (read-aloud, dictation, voice settings), `web/src/live.ts` (Live mode loop) and `web/src/components/TtsPlayer.tsx`. In a plain browser read-aloud falls back to the Web Speech API (`speechSynthesis`); dictation and Live mode need the phone app.

#### Reading a reply aloud

- Each assistant message has an icon button (label "Read aloud", "Stop reading" while it is the one being read) calling `toggleSpeak`. `speak(id, markdown)` turns the Markdown into plain speech first (`speakable`): code blocks become "(code omitted).", OpenUI cards "(card shown in the app).", `MEDIA:` lines, images, link targets, markup, list and heading marks, tables and emoji are dropped, bare links are read as "link".
- `say` sends the text to the shell with `speak(text, cfg)`; `cfg` is JSON: the voice settings, `base` (where in the text this stretch starts), `notify` (true except for the Settings voice test; it makes the "Reading aloud" notification card with pause, back/forward 5 s and stop), the chat title and the stored chat id.
- Read-aloud mode: on for every chat (Settings → Voice page, Section Read aloud, row Read every reply aloud), or for one chat (chat ⋮ menu, row "Read every reply aloud", with sub-line On/Off and " · this chat only" or " · all chats"). A per-chat choice wins over the global one; choosing what the global setting already is clears the override. The empty new-chat screen remembers the choice (`setDraftRead`) and gives it to the chat when it gets its id (`applyDraftRead`). Keys: `hm.autoread` (global, "1" or "0") and `hm.autoread.chats` (map from stored chat id to true/false). A 🔊 badge in the header shows when the open chat reads aloud.
- When a turn ends without error, the page reads the reply itself if read-aloud is on for that chat, Live mode is off and the app is on screen. With the app in the background the Android service reads it instead, so replies are read with the phone locked. For that, `syncReadAloud` copies the mode, the per-chat map and the voice settings to the shell (`setReadAloud`) at load and after every change.
- Voice settings, `hm.tts`: `engine` (package name, empty = default engine), `voice` (empty = default for the language), `rate` and `pitch` (0.5 to 2). Edited on the Settings → Voice page (Sections Voice and Sound; `loadVoices` asks the shell with `listVoices`; the answer arrives as the `voices` event and fills `catalog`; the row "Test voice" plays a sample sentence).

#### Read-aloud player (screen block)

**Opens from:** appears above the composer whenever a reply (not Live mode, not the Settings voice test) is being read. **Closes with:** the ✕ button, reading to the end, or stopping from the notification. **Source:** `web/src/components/TtsPlayer.tsx` `TtsPlayer`; state `player` in `web/src/voice.ts`.

**Layout, left to right (`role="region"`, aria-label Reading aloud):**

| Element | Looks like | Tap | Long-press / swipe | States |
|---|---|---|---|---|
| Pause / Resume | Round button with a pause or play icon (aria-label Pause reading / Resume reading) | `pauseSpeaking` / `resumeSpeaking` | | Pause keeps the place; Resume reads on from it |
| Back 5 seconds | Button (aria-label Back 5 seconds) | `jumpSpeaking(-1)`, and the label shows "-5 s" for 700 ms | | |
| Forward 5 seconds | Button (aria-label Forward 5 seconds) | `jumpSpeaking(1)`, label "+5 s" | | |
| Position slider | Range 0 to the text length in characters (aria-label Reading position), with a time label under it: `0:12 / ~1:40` (read so far / estimated total; the `~` marks an estimate from the reading pace) | | Drag to seek (`seekSpeaking`): while playing it re-speaks from there; while paused it only moves the place | |
| Speed | Pill showing `1×`, `1.25×` and so on (aria-label "Reading speed 1×, tap to change") | Cycles to the next of 0.75, 1, 1.25, 1.5, 1.75, 2 (back to 0.75 after 2). Saved like the Settings slider; re-speaks from the current place if playing. | | |
| Close player | ✕ (aria-label Close player) | `stopSpeaking` | | |

The player is skipped by the swipe gestures (`.tts-player` in `SKIP`).

**How position works:** Android's TextToSpeech cannot pause or seek, so the app speaks the rest of the text from a character position whenever you resume after a re-speak, seek or change speed. The shell reports events through `window.__hmVoice(kind, text)`:

| Event | Meaning |
|---|---|
| `tts-seg` | A short stretch started playing: `at,length` in characters (offset by where this speech began). The position then moves at the measured pace until the next stretch, never past the end of the current one. |
| `tts-pace` | The shell's reading pace in characters per second (accepted from 2 to 120). The page uses it so the bar, the time label and the notification card agree. Without it the pace is 14 characters per second times the speed. |
| `tts-paused` | Voice.java paused (button, notification or headset) at this position; the page catches up even if it was frozen. |
| `tts-resumed` | Playing again. |
| `tts-seek` | The notification's back/forward 5 s moved the place. |
| `tts-done` | Finished. `stop` (the notification's ✕ or a headset stop) is final even while paused. A done event while the page itself paused, or right after a re-speak, is ignored. |
| `voices` | The engines and voices list (JSON). |
| `error` with `tts-…` or `voices-failed` | Read-aloud failure: toast with the reason (for `tts-unavailable`: no text-to-speech engine would start; install one and pick it on the Settings → Voice page). It is never passed to dictation. |

Back/forward 5 s use the shell's own path (`ttsControl('rew' | 'ff')`) so the notification and the page share one state; in a browser the page seeks by 5 s × pace. Pause uses `ttsControl('pause')`, resume `ttsControl('play')` when the place is unchanged, otherwise it re-speaks.

**Data:** bridge `speak`, `stopSpeaking`, `ttsControl`, `listVoices`, `setReadAloud`; keys `hm.tts`, `hm.autoread`, `hm.autoread.chats`.

#### Voice input (dictation)

- The composer shows a microphone button (aria-label Dictate) when the shell has speech recognition and the composer is empty. Tapping it calls `startListening(cb)`, which stops any reading aloud first and asks the shell to listen.
- It keeps listening until you stop it: each finished phrase (`final`) is inserted at the cursor, the phrase being recognised (`partial`) is shown there live. While listening the button changes to a stop square (aria-label Stop dictation, calling `stopListening`).
- Events through `__hmVoice`: `ready` (listening started, clears the partial text), `partial`, `final`, `quiet`, `error`, `end` (listening stopped). Errors become toasts (`voiceErrorText`): microphone not allowed ("Allow the microphone to dictate", or "…to use live mode"), no speech recognition on the phone (install the Google app), no internet or language pack, microphone busy, voice-input app lacks the microphone permission, language not downloaded, and a generic "Voice input failed (code)". The Android error codes come from `stt-<SpeechRecognizer error>`, `stt-start` and `stt-unavailable`.

#### Live mode (`web/src/live.ts`)

A hands-free conversation: listen → send what you said → wait for the reply → read it aloud → listen again, until you press End.

**Opens from:** the Live conversation button in the composer (shown when the composer is empty, nothing is running, not dictating, and the shell has voice); the launcher shortcut Live mode (`hermesShortcut('live')` in `web/src/share.ts`, which starts a new draft chat, waits up to 30 s for Hermes to be online, then starts Live; without voice features it toasts "Live mode needs the phone app’s voice features"). **Closes with:** the End button, a recogniser error, 5 minutes without speech, leaving the app, or opening another chat.

**The bar** (replaces the model row above the composer): a dot, the line "Live · Listening…" / "Live · Hermes is thinking…" / "Live · Hermes is speaking…" / "Live · Mic muted", a hint line (the words being recognised, or "Pause for 2 seconds to send", or "Replies are still read aloud" when muted), a mute button (aria-labels Mute microphone / Unmute microphone, `aria-pressed`) and a red End button.

**Loop:**
1. `startLive` sets the phase to listening and calls `listen`. Every `partial` result restarts the send countdown; a `final` result adds a phrase to the buffer.
2. The send countdown is the pause setting: key `hm.live` (stored as `hm.live.pause`), 2 s by default, accepted from 0.5 to 10 s, set with the slider "Pause before sending" in the Section Live mode of the Settings → Voice page (0.5 to 6 s). When it runs out, the phase becomes thinking, the microphone stops (so it never hears itself), and the text goes out through `sendPrompt`. A failed send toasts the error and goes back to listening. If the countdown ends while the last phrase is still only a `partial` (an on-device model finishes a phrase a moment after you stop, and its previews lag behind), Live mode waits up to 1.5 s (`FINAL_WAIT_MS`) for that phrase's `final` and sends as soon as it comes, or sends the preview after that; speaking again meanwhile restarts the countdown.
3. `liveBridge.onReply` (called from `gateway.ts` when a turn ends) moves to speaking and reads the reply with `speak('live', text)`. An empty or failed reply goes straight back to listening. If no reply comes within 10 minutes it listens again.
4. When the speech ends (`onTtsDone`), the phase goes back to listening. If the recogniser ends by itself it restarts after 400 ms.
5. The idle timer is 5 minutes without any recognised speech: toast "Live mode ended: no speech for 5 minutes", then Live ends (the app sends what it hears to an agent that can run commands).

**Mute:** `setLiveMute(true)` closes the microphone but keeps the session; what was said but not yet sent is thrown away; replies are still read aloud; unmuting while listening restarts the recogniser.

**Approvals by voice:** when Hermes asks for permission during Live mode (`liveBridge.onApproval`), the app says "Hermes needs your permission. Allow or deny?" and listens (the approval sheet stays on screen, so a tap works too). `voiceChoice` maps the answer: deny words (deny, no, nope, don't, stop, cancel, reject, never) → `deny`; allow words (allow, yes, yeah, yep, ok, okay, sure, approve, go ahead, do it, fine) → `once`, or `session` when it also says "this chat", "session", "for now" or "this conversation" and the request offers it. An unclear answer gets "Sorry. Say allow, or deny." once; after two unclear answers it toasts "Answer the approval on the screen". An answer sends the choice and toasts Denied / Allowed for this chat / Allowed once. If you answered on the screen meanwhile, the voice answer is dropped.

**Leaving the app** ends Live mode (the microphone cannot stay open off screen). A reply that is being read keeps playing; an approval question is cut. Opening another chat calls `liveBridge.stop`.

**Data:** bridge `startListening`, `stopListening`, `speak`, `stopSpeaking`; key `hm.live`.
