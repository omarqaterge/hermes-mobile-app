# No separate UI-coverage project before the UI revamp (per-change browser checks still required)

**Decided:** 2026-10-23, by the owner.

A full UI revamp is planned, so broad screen or component test coverage would be rewritten soon.

**So:** Still add a browser check for each web change (`AGENTS.md`); don't start a separate UI-coverage project. Test work that doesn't touch the UI (service, plugin, mock drift) is welcome.

**Changed:** 2026-11-16, by the owner: the revamp has started (branch `redesign`), so this decision no longer holds. Its
first step was a safety net of browser checks that survive a change of look (each control found by its role and name,
its effect checked), a recorded list of the checks as they were, and fixed points the redesign may only improve
([status](../status/ui-revamp.md)). A browser check for each web change is still required.
