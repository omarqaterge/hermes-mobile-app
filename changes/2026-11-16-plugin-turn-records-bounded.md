---
rank: small
---
- **Long-running Hermes no longer forgets a turn's start or grows its notes.** The plugin's per-chat records (turn starts, sub-agent ids, last turn ends) are now bounded, a running turn keeps its start time when many other chats start, and a background "Learning" label can no longer replace a chat's live status. Tested with the plugin's status-chip checks; not tried on a phone.
