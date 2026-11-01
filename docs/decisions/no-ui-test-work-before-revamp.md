# No separate UI-coverage project before the UI revamp (per-change browser checks still required)

**Decided:** 2026-10-23, by the owner.

A full UI revamp is planned, so broad screen or component test coverage would be rewritten soon.

**So:** Still add a browser check for each web change (`AGENTS.md`); don't start a separate UI-coverage project. Test work that doesn't touch the UI (service, plugin, mock drift) is welcome.
