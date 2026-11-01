# This app is the only front end

**Decided:** 2026-09-30, by the owner.

The owner never uses Telegram or another messaging channel, so the app shows nothing about them: no Channels, gateway log or "Always on" switch in Bots, no messaging-gateway or platform rows in the Backend status sheet, the header dot ignores the dashboard's `overall` (it stayed amber because of a messaging poll conflict) and uses dashboard, storage and disk only, and Keys/Config hide messaging keys and groups (`MESSAGING_CATS`, `isMessagingField` in `web/src/components/Settings.tsx`). The bot keeper code in the plugin still exists but the UI doesn't use it and the supervisor doesn't start it (battery).

**So:** Don't add messaging-channel UI back. Never switch a bot on while testing: profiles can share one bot token with other machines.
