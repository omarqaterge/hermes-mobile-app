# The /btw pull-up needs a longer pull

**Decided:** 2026-10-30, by the owner. **Raised again:** 2026-11-02, by the owner ("swipe up a bit harder").

Pulling up past the last message opened the /btw side chat too easily at 110 px, and still too easily at 160 px.

**So:** The threshold is 230 px now (`PULL_TRIGGER_PX`), and the rubber band is stiffer (`PULL_GIVE` 0.4, was
0.55): the list follows less of the finger, so the pull feels heavier but still shows clearly when it arms. Don't
lower either without asking the owner.
