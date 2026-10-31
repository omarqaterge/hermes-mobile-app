# 04: HTML preview inside replies

Read [README.md](README.md) first.

## Goal

When Hermes's reply contains an ` ```html ` (or ` ```svg `) code block, the block's bar gets a **Preview** button. It
shows the page right there in the chat, in the same sandbox the canvas uses, sized to its content, with a
**Full screen** button. No need to open the canvas just to look at a small chart or widget.

T3 Code: `apps/web/src/components/chat/HtmlRenderFrame.tsx` and `HtmlRenderDialog.tsx` (inline sandboxed frame that
grows to its content, expandable to full screen), `apps/mobile/src/features/threads/HtmlRenderWebView.tsx`.
T3 also hosts MCP Apps (`McpAppFrame.tsx`); Hermes has no MCP-app support at the pinned commit
(`web/vendor/hermes-shared/.hermes-commit`), so that part is out of scope.

## What exists today

- `web/src/components/Canvas.tsx`, `HtmlFrame({ html, network })`: builds a `srcDoc` with a guard script first
  (removes `window.HermesAndroid`, reports errors, turns `alert()` into a toast, sends link clicks to the app which
  asks "Open link?"), an offline CSP when `network` is false, and renders
  `<iframe sandbox="allow-scripts allow-forms allow-modals" referrerPolicy="no-referrer" srcDoc=…>`. Note: **no
  `allow-same-origin`**. Keep it that way.
- `web/src/components/Markdown.tsx`, `CodeBlock`: the code block with its bar (`Wrap`, `Canvas`, `Copy`). `Mermaid`
  shows how a block can render something else, and `DiagramViewer` how a full-screen viewer is built.
- `Markdown` receives `streaming` (true while the reply is still arriving).

## Design

- The bar of an `html` or `svg` code block (language from `langOf`) with at least 3 lines gets **Preview**
  (toggle; label `Code` while the preview shows). It is disabled while the reply is still streaming.
- Preview replaces the `<pre>` with the frame. The frame starts at 160 px high and grows to the page's own height,
  capped at 60 % of the window height (`60vh`); taller pages scroll inside the frame.
- Preview is always offline (the strict CSP, `network = false`). The canvas stays the place to run a page with network
  access; the bar's `Canvas` button already opens it there.
- **Full screen** (button under the frame, aria-label `Open preview full screen`) shows the same page in a full-screen
  overlay with a ✕ (aria-label `Close preview`). Android Back closes it.
- `svg` blocks: preview as `<img src="data:image/svg+xml;charset=utf-8,…">` like `DocView` does for svg documents
  (no frame, no scripts).
- Errors from the page show as the canvas shows them (`⚠ message` above the frame).

## Implementation steps

1. **Move `HtmlFrame` to its own file** `web/src/components/HtmlFrame.tsx` and export it. `Canvas.tsx` imports it
   from there. Behaviour unchanged. Add two optional props:
   - `autoHeight?: { min: number; max: number }`: when set, the guard script also reports the document height:
     add to the guard string
     `new ResizeObserver(function(){parent.postMessage({hmFrameHeight:document.documentElement.scrollHeight},'*')}).observe(document.documentElement)`
     (wrap in `try{}catch(e){}` and also post once on `load`). The `message` handler (it already checks
     `e.source === frame.current?.contentWindow`) sets the iframe's height to `clamp(h, min, max)` px.
   - `className?: string` for sizing.
   Make sure the guard stays the very first script (the existing doctype logic).
2. **`CodeBlock`** (`Markdown.tsx`):
   - Add `const [preview, setPreview] = useState(false)`.
   - Know whether the reply is still streaming: create `const StreamingCtx = createContext(false)` in `Markdown.tsx`,
     wrap the rendered markdown in `<StreamingCtx.Provider value={streaming}>` inside `Markdown`, read it with
     `useContext` in `CodeBlock`. (Don't add it to `mdComponents`' memo keys: that would rebuild every block on each
     stream batch.)
   - For `lang === 'html' || lang === 'svg'` and `lines >= 3`: render the Preview button before `Canvas`.
   - When `preview`: render `<HtmlFrame html={code} network={false} autoHeight={{ min: 160, max: Math.round(innerHeight * 0.6) }} className="inline-frame" />`
     (or the svg `<img>`), and below it the Full screen button. Hide the "Show all N lines" button while previewing.
3. **Full-screen viewer** `HtmlViewer({ html, onClose })`: copy the structure of `DiagramViewer` (overlay element,
   close button, `useBackHandler(onClose, true)`), containing `<HtmlFrame html network={false} />` filling the
   overlay. Add the overlay's class to `SKIP` in `web/src/swipe.ts` and `web/src/pullbtw.ts` if it doesn't already
   match one there (it should, if it uses `role="dialog"`: give it `role="dialog"` and `aria-modal="true"`).
4. **CSS**: `.inline-frame` (width 100 %, border `1px solid var(--line)` or whichever border variable code blocks use,
   radius like `.codeblock`, background `var(--bg)`), `.html-viewer`. Variables only.
5. Speech and export: `speakable` (voice) already skips code blocks; nothing to do. `chatMarkdown` exports the code,
   which is right.

## Security checklist (must hold; test the first three)

- The iframe has `sandbox` **without** `allow-same-origin` and without `allow-top-navigation`.
- `window.HermesAndroid` is undefined inside the frame (the guard deletes it; the sandbox gives it an opaque origin
  anyway).
- The inline preview always uses the offline CSP: `fetch()` from inside fails.
- The `message` listener only reads messages whose `source` is this frame's `contentWindow`, and only the known keys
  (`hmCanvasError`, `hmCanvasAlert`, `hmCanvasLink`, `hmFrameHeight`); `hmFrameHeight` must be a finite number.

## Tests

**Unit**: if you extract the srcDoc building into a pure function (recommended: `frameDoc(html, network, autoHeight)`
in `HtmlFrame.tsx` or a small `web/src/htmlframe.ts`), test that the guard comes first with and without a doctype,
that the CSP meta is present when offline, and that the height reporter is only included with `autoHeight`.

**Mock**: prompt `/^show html$/` → reply
`'Page:\n\n```html\n<!doctype html>\n<h1 id="t">Hello frame</h1>\n<script>document.getElementById("t").textContent += " ok"</script>\n<div style="height:600px"></div>\n```'`.

**E2E**:
1. Send `show html`; click `Preview`. The `iframe.inline-frame` exists, has a `sandbox` attribute that doesn't
   contain `allow-same-origin`, and its height is > 160 and ≤ 60 % of the viewport (the page is 600 px tall).
2. Inside the frame (`page.frameLocator('iframe.inline-frame')`) `#t` has text `Hello frame ok` (scripts ran) and
   `await frame.evaluate(() => typeof window.HermesAndroid)` is `'undefined'`.
3. `Open preview full screen` opens `.html-viewer`; Android Back (`window.hermesBack()`) closes it.
4. During a streamed html reply the Preview button is disabled (optional: add `show html streaming` to the mock like
   `show ui streaming`).
5. The canvas's HTML documents still work: the existing canvas e2e checks pass unchanged.

## Spec and changelog

- `docs/SPEC.md` 3.3 "Markdown inside replies" (Preview, Full screen, offline only, aria-labels), 3.7 "HTML runs in a
  sandbox" (now shared by the chat preview; `web/src/components/HtmlFrame.tsx`), the source map and 2.6 core files.
- `CHANGELOG.md` entry.

## Out of scope

MCP Apps (`ui://` resources), previewing other languages, a network switch for the inline preview.
