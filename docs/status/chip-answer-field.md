# Answer box on the question chip

**State:** done, on `main` once this PR merges. HyperOS (Android 16, Xiaomi) drops a `RemoteInput` field from the
promoted chip, while drawing plain buttons there, including ones with `setAuthenticationRequired`, and the same field
on the `Needs you` card. So the chip's card and its Answer button open `AnswerBox`. Seen on that phone: card tap, Answer
button, typed answer, choice, Back, Open chat with the typed text, Send staying in view with long choices.

**Next:** two things not seen on a phone. The locked-phone path: the unlock should come first. Choices over 80
characters: the plugin now keeps 400, but Hermes on the test phone was still running the old plugin code.

**Known limit:** the service keeps the open question in memory, so a restart (an app update) drops the chip until the
next question, while the app's own sheet still shows it.

**Needs a real phone:** yes, for those two checks.

**Links:** `android/src/com/omarqaterge/hermesmobile/AnswerBox.java`, `HermesService.askNotification`, spec section 4.3.
