# OpenUI cards read no files

**Decided:** 2026-11-16, by the owner.

A card's `Query()` runs a tool by itself, when the card is drawn, with no approval, and can join one answer into the
next call's arguments (a file's text into `web_search`'s query) or into a picture's address. `read_file` and
`search_files` were on the card list. Hermes's read denylist (at the pinned build) blocks only its own credential files
(`auth.json`, `.env` files, the `mcp-tokens`, `vault` and `browser-profile` folders), not `~/.ssh` keys or the app's
key under `~/.hermes-mobile`, and Hermes itself calls it "not a security boundary".

Options weighed: drop the file tools from cards, ask with a tap before a card's first file read, or drop `web_search`
instead. The owner chose to drop the file tools.

**So:**

- Cards may call `web_search` and `find_chats` only (`hermes-plugin/hermes-mobile/openui_tools.json`). The model can
  still put what it read into a card as fixed values, from its own turn, where the usual approvals apply.
- `openui_query.py` refuses the file and command tools (`NEVER`) even if the list names them again.
- Don't add a tool that reads files, runs commands or changes anything to the card list without asking the owner.
