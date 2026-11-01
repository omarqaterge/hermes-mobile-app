# Hermes driving apps on a hidden display: built after all

**Decided:** 2026-10-16 (not built), changed 2026-10-21 by the owner (build it).

**2026-10-16:** Delegated by the owner. It would need our own virtual display created through Shizuku, would show the
owner's real data in an invisible place, and apps with FLAG_SECURE render black; there was no concrete task for it
yet, so it was not built.

**2026-10-21:** The owner asked for Hermes to drive apps in the background, with its progress shown in the chip and
the app, which reversed the decision above. It shipped in 0.8.43 as the `phone_app` tool and the background-app card
(spec 5.2 and 3.10), with the owner's choices: ask once per app per chat (`/yolo` skips it), banking, payment,
password and 2FA apps off until the user allows them in Settings, and the chip saying "Using <app>".

**So:** background app control is a wanted feature: improve it, don't remove it. The 2026-10-16 concerns still
shape it: real data stays on the phone, sensitive apps are off by default, and secure (black) screens are read
through the element list instead of pictures.
