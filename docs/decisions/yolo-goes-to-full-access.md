# /yolo goes to Full access

**Decided:** 2026-11-02, by the owner.

A bare `/yolo` used to toggle: from Auto access it turned approvals back on, so a chat that started in Auto access (Settings
→ Auto for all chats) went the wrong way and "still asked" after `/yolo`.

**So:** From Off or Auto access, a bare `/yolo` switches the chat to Full access. From Full access it goes back to the mode
the chat was in before (Off when the app doesn't know it, for example after a restart). `/yolo on` and `/yolo off` stay
explicit. The notice always names the mode the chat is in now. A `/yolo` typed while the chat is still being switched
(its start-up mode) wins over that older switch instead of waiting for it to finish (spec 3.2).
