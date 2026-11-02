# Usage stats are opt-in only

**Decided:** 2026-11-02, by the owner.

The owner asked for stats, unique-user counts and "How did you hear about us?", on one condition: only for people who
say yes.

**So:** Off by default, no free-text answers, one switch to leave, and leaving forgets the install ID. Don't turn it on
by default or add fields without asking; what is sent is the list in `web/src/stats.ts` (spec 2.3).
