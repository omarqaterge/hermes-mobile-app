# How Hermux compares

Other open-source projects tackle the same idea from different sides. Grouped by kind (from their public READMEs, checked
2026-11-04, not tested by us), here is where each kind stops and Hermux does not:

| | Hermes packaged for Termux | Termux script agents | Screen-tapping phone agents | Phone apps for desktop coding agents | Companion apps for a self-hosted gateway | **Hermux** |
|---|---|---|---|---|---|---|
| The agent runs on the phone | ✅ | ✅ | ✅ or a PC over ADB | ❌ laptop or server | ❌ computer | ✅ |
| Real chat app (history, search, edit, branch) | ❌ terminal | ❌ terminal | Mostly a task box | ✅ | ✅ | ✅ |
| Approvals and replies with the app closed | ❌ | ❌ | ❌ | Alerts only | In the app | ✅ chip and notifications, fingerprint-confirmed |
| Uses other apps without taking your screen | ❌ | ❌ | ❌ takes the screen | ❌ | ❌ | ✅ hidden screen, Take over |
| Sensitive apps (banking, passwords, 2FA) blocked by default | ❌ | ❌ | Rarely | n/a | n/a | ✅ |
| Canvas, interactive cards, equations, diagrams | ❌ | ❌ | ❌ | Code views | Basic canvas, foreground only | ✅ versions, diffs, gallery |
| Voice: offline dictation, Live mode, power-button assistant | ❌ | ❌ | Basic dictation | Some | Talk mode | ✅ |
| Subscription sign-in and fallback models | ❌ | Keys only | Keys only | Via the desktop agent | Via the gateway | ✅ ChatGPT, Claude, Grok, Nous, any Hermes provider |
| No computer, relay or gateway needed | ✅ | ✅ | ❌ often | ❌ | ❌ | ✅ |
| Spec and tests kept in step by CI | ❌ | ❌ | Rarely | Varies | Varies | ✅ |

**What no other project here does in one app:** a full agent on your phone *and* a proper chat app *and* answers from the
lock screen *and* apps used out of sight *and* a shared canvas. Pick any one of those elsewhere; Hermux has all five,
and the guard rails (per-chat access levels, fingerprint on the first Allow, sandboxed pages) that an agent with this
much reach needs.

**Where others go further, and what we want next**: a home-screen widget and Quick Settings tile, opt-in notification
summaries, a wake word, and an offline local model. Hermux does not do encrypted
multi-device sync or multiplayer sessions: your data stays on one phone on purpose.
