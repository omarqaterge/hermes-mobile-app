# OpenUI cards render inline in chat

**Decided:** 2026-10-23, by the owner.

Interactive HTML belongs in the canvas, not in chat messages, with one exception: ```openui-lang blocks render inline as OpenUI cards (`web/src/components/OpenUIBlock.tsx`, own shadow root, lazy `hm-openui` bundle) with OpenUI's own library and look. The canvas is for things the user asks to build or write.

**So:** Never import `openui-lib` / `openui-entry` from app code (it would add about 4 MB to the main bundle); refresh Hermes's reference with `npm run gen:openui`. Keep `rehype-sanitize` in front of rendered Markdown.
