---
rank: small
---
- **Settings pages no longer get stuck on “Loading…”.** Model providers → Fallback models says “No fallback models yet” when the list is empty instead of loading forever, and a settings page that gets no answer from Hermux within 20 seconds shows the error with a Try again button (Model providers, API keys, Advanced settings, Hermux settings, Connectors). Connectors also shows when its server and tool lists are loading, empty or failed. Tested in the browser against the test Hermux; not yet on a phone.
