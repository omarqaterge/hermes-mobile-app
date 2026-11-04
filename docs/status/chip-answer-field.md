# Answer field on the question chip

**State:** on branch `claude/chip-answer-field`. On an Android 16 Xiaomi phone (HyperOS) the expanded chip and the
shade's chip card draw no field for a question, although the notification carries the action. Moving the chip to
`ProgressStyle` did not help (seen on that phone). The same `answerAction` does draw on the `Needs you` card, so the
promoted card is what drops it. Whether HyperOS drops only `RemoteInput` actions or every action on this card is not
established. The chip now opens `AnswerBox` when tapped, which doesn't depend on that.

**Next:** on a phone, tap the expanded chip with a question open: the box opens, a typed answer and a choice reach the
chat, Back leaves the question open. Note whether the Answer button is drawn on the chip. Check a locked phone asks for
the unlock first.

**Needs a real phone:** yes. Installs from adb failed on that phone with `INSTALL_FAILED_USER_RESTRICTED: Invalid apk`;
the owner installs test builds from File Manager.

**Links:** `android/src/com/omarqaterge/hermesmobile/AnswerBox.java`, `HermesService.askNotification`, spec section 4.3.
