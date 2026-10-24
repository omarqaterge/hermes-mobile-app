# Third-party code

- `web/vendor/hermes-shared/`: client code copied from NousResearch/hermes-agent (`apps/shared`), pinned in `.hermes-commit`.
  Licensed MIT, Copyright (c) Nous Research. Source: https://github.com/NousResearch/hermes-agent
- `hermes-plugin-extras/antigravity/`: Hermes plugins from https://github.com/mrhisyammm/hermes-antigravity-auth (MIT, Copyright (c) 2026
  mrhisyammm; licence in that folder), with a small login change. Optional, see its README.
- `web/vendor/desktop-slash-registry.json`: derived from Hermes Desktop's slash command registry (same project, MIT).
- OpenUI (`@openuidev/react-lang`, `@openuidev/lang-core`, `@openuidev/react-ui`, `@openuidev/react-headless`), which draws the
  cards in replies: MIT, Copyright (c) Thesys Inc. Source: https://github.com/thesysdev/openui. It and the parts it uses of
  these libraries are built into the app's lazy OpenUI bundle: Radix UI primitives, Floating UI, TanStack Table, react-day-picker,
  date-fns, d3 (scale, selection, shape), lodash-es, react-markdown with remark/rehype plugins and KaTeX,
  react-syntax-highlighter with refractor/Prism and lowlight, zod, zustand, its own copy of React and `@ag-ui/core` (all
  MIT), lucide-react icons (ISC), highlight.js (BSD-3-Clause), tslib (0BSD) and highlightjs-vue (CC0-1.0).
- npm dependencies (React, KaTeX, Mermaid, highlight.js, rehype/remark plugins, Vite, vitest) keep their own licenses, see `web/package.json` and `web/package-lock.json`.
