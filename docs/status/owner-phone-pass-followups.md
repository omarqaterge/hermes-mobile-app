# Follow-ups from the owner's phone pass of 2026-10-30

**State:** the fixes from that pass are on `main` (lock-screen safety, the Shizuku 90 s check, card date fields, the
longer /btw pull-up). Two items are open:
- **Swipe left on a chat to open the canvas** didn't work on the owner's phone, but works in headless Chrome and in
  the test app's WebView; not reproduced. The owner's answers decide what to try next.
- **A notice that came late after a reboot**: the fix assumes deep sleep delayed a timer; the emulator never showed the
  failure, so the cause is a guess until the owner's phone confirms it.

**Next:** ask the owner to retry both on the next build and report what they see.

**Needs a real phone:** both items.

**Links:** `web/src/swipe.ts` (the chat-screen swipes), `android/src/com/omarqaterge/hermesmobile/ShizukuKeeper.java`, [decisions](../decisions/no-actions-from-locked-phone.md).
