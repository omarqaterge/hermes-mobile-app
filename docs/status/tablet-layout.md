# Wide screens and tablets

**State:** on `main`: wide screens can hide the docked chat list (☰ / «, `web/src/sidepanel.ts`, `hm.sideHidden.v1`),
and docked pages sit above the list so their sheets cover it. In review (branch `feat/tablet-split`): from 700 px the
canvas is a column beside the chat with a draggable divider (snaps to full screen / closed, remembered as a share in
`hm.canvasSplit.v1`), a pull tab and swipe at the right edge bring it in, and the shell keeps Android's Back gesture off
that strip (`setEdgeGrab`, API 29+). Browser checks pass (`tools/web-e2e/checks/16-canvas-panel.cjs`). Not yet seen
on a real tablet or a large emulator.

**Next:** try it on a tablet or a large-screen emulator with gesture navigation (does the edge pull reach the app, does
Back still work on the rest of the edge). Visual polish is left for the planned UI revamp (`ui-revamp.md`): a sidebar
icon for the hide button instead of ☰, how the divider grip and pull tab look, bottom sheets and page content at a
centred maximum width on wide screens.

**Needs a real phone:** a tablet (or a large-screen emulator).

**Links:** `web/src/sidepanel.ts`, `web/src/splitview.ts`, `docs/spec/03-13-drawer-session-list.md`,
`docs/spec/03-07-canvas-panel.md`.
