# 12: Export

Read [README.md](README.md) first.

**Effort:** M. **Areas:** Java, web. **Depends on:** none.

## Goal

Take things out of Hermux in the form other people and apps expect: a canvas page or a chat **as a PDF**, and a
single reply **as a picture**. Today a chat leaves as Markdown text and a canvas document as its source file.

## What exists today

- Chat menu → Share chat: Markdown through the share sheet (`chatMarkdown` in `web/src/export.ts`).
- Canvas: saving a document to a file on the phone (`POST /api/files/upload` with `overwrite: true`,
  `POST /canvas/save-file`), versions, the gallery (spec 3.7, 3.8).
- Files: "Open with…" through `termux-open` (`openFile` bridge call).
- No printing, no PDF, no image export.

## Owner decisions needed

1. **PDF through Android's print dialog?** It is the only way to make a PDF without bundling a library: the system
   dialog offers "Save as PDF" and real printers. Recommended: yes.
2. **A reply as a picture: include the question?** Recommended: the picture holds the reply only, with a small
   "Hermux" mark and the date at the bottom; a switch in the preview adds the question above it.

## Design

### PDF (native)

- Bridge `printHtml(key, title, html)`. `MainActivity` creates a **separate, throwaway `WebView`** (never the app's
  own), with JavaScript off, network blocked (`setBlockNetworkLoads(true)`, no file or content access), loads the
  HTML with `loadDataWithBaseURL(null, …)`, and on `onPageFinished` hands
  `webView.createPrintDocumentAdapter(title)` to `PrintManager.print`. The WebView is destroyed when the print job
  ends (a `PrintJob` state check on resume, and a 10-minute cap).
- The HTML is built by the page from already-rendered, sanitized content (below), at most 4 MB; larger is refused
  with a toast "Too long to export as one PDF".
- Remote pictures don't load (network is blocked): pictures that are already data URLs print, others print their
  alt text. In a chat that has read phone data this is the same rule the app applies on screen.

### What the page builds

A new module `web/src/printdoc.ts` (pure, unit-tested): `printDoc({ title, bodyHtml, kind })` returns a complete
HTML document with a small embedded print stylesheet (system fonts, black on white, code blocks that wrap, tables
that don't split rows, page margins). It never includes scripts and strips `on*` attributes and `javascript:`
addresses again as a second check, whatever the source.

- **Canvas page:** Markdown is rendered with the existing renderer and `rehype-sanitize` to a string; CSV becomes a
  table; code becomes a highlighted block; a Mermaid diagram prints from its rendered SVG. **HTML canvas pages are
  not printed through this path** (they are programs): for those the menu offers only "Save a copy" as today.
- **Chat:** title, date, then each turn: "You" and the text; "Hermux" and the rendered reply; tool lines as one dim
  line each (the words `toolsay.ts` shows). Attachments are named, not embedded. Cards print their current static
  rendering.

### Reply as a picture

No native code. `web/src/replyimage.ts` draws the reply to a canvas: the reply's DOM node is cloned into an SVG
`foreignObject` with the computed styles inlined, rendered to an `Image`, then to a `<canvas>` at 2× and exported
with `toBlob('image/png')`. Remote images in the reply are replaced by their alt text first (a canvas with foreign
pictures can't be exported, and they must not load anyway). Limits: 1,080 px wide, 12,000 px tall; longer replies
offer "Export as PDF instead".

The result opens in a preview sheet with **Share** (the share bridge call the chat export uses, with the file) and
**Save to Photos** (uploads to `/sdcard/Pictures/Hermux/` through `POST /api/files/upload`).

### Where the actions are

- Canvas panel menu: **Export as PDF** (not for HTML pages).
- Chat menu, next to Share chat: **Export as PDF**.
- Reply actions row overflow (long-press on Copy, or a "…" at the row's end if the row has room): **Share as
  picture**.
- Outside the app (a desktop browser) the PDF actions are hidden; the picture works everywhere.

## Build steps

1. `printdoc.ts` and tests; `replyimage.ts` with its pure parts tested (size limits, the alt-text replacement).
2. `MainActivity.Bridge.printHtml`, the throwaway WebView, `secure-bridge.ts`, `bridge.ts`.
3. The three menu entries and the picture preview sheet (`web/src/components/ExportSheets.tsx`).
4. E2E at the end of `16-canvas-panel.cjs` (canvas) and `09-chat-tools.cjs` (chat, reply), with a fake bridge that
   records `printHtml`'s arguments.

Shared files touched: `MainActivity.java`, `Canvas.tsx`, `Sheets.tsx` or wherever the chat menu is, `styles.css`.

## Tests

- Unit: `printDoc` output has no `<script>`, no `on*=`, no `javascript:`; a 5 MB body is refused; a reply taller
  than the limit offers the PDF.
- E2E: the entries appear where specified and not for an HTML canvas page; `printHtml` receives a document with the
  title; the picture preview shows and Share calls the bridge.
- Phone: the print dialog opens with "Save as PDF" on Android 8 and on the newest Android; a 30-page chat; a
  right-to-left text; a reply with a table and code as a picture in both themes (the picture is always light, for
  sharing).

## Spec and changes

Spec 4.5 (`printHtml`), 4.1 (the throwaway WebView and its settings), 3.7, 3.5, 3.3, 2.6 (`printdoc.ts`,
`replyimage.ts`), 2.3 (why printing uses its own WebView with no network and no scripts). `changes/` file.

## Check first

- That `createPrintDocumentAdapter` works on a WebView that is not attached to a window (it does in general; some
  WebView versions need a layout pass: attach it off-screen with zero alpha if so).
- That the SVG `foreignObject` route renders the app's fonts and KaTeX output in the Android WebView; if not, fall
  back to offering PDF only for replies with maths.
- Which share bridge call can carry a file (the chat export shares text today).

## Out of scope

Word or slide formats, exporting a whole project, scheduled exports, printing HTML canvas pages.
