# Answer field on the question chip

**State:** the code is on branch `claude/chip-answer-field`. On an Android 16 Xiaomi phone (HyperOS) the expanded chip
and the shade card drew no button or field for a question without choices, although the notification carried the
Answer action (`actions=1`). Why is not known. The change moves the chip to `ProgressStyle`, because the approval and
working chips use it and buttons were seen on the working chip, and adds the field to questions with choices.

**Next:** install a build and ask a question with no choices, then one with three. If the field still doesn't show,
compare a plain action, one with `setAuthenticationRequired` and one with a `RemoteInput`. If HyperOS draws no
`RemoteInput` on this chip, make Answer a plain button that opens a small answer box, still behind an unlock.

**Needs a real phone:** yes. The fix has not been seen working: adb installs failed on that phone with
`INSTALL_FAILED_USER_RESTRICTED: Invalid apk`.

**Links:** `android/src/com/omarqaterge/hermesmobile/HermesService.java` (`askNotification`), spec section 4.3.
