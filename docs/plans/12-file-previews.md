# 12: More file previews in Files

Read [README.md](README.md) first. Build [04](04-inline-html-preview.md) first if you want HTML pages to preview
with the shared `HtmlFrame` (otherwise import it from `Canvas.tsx`, where it lives today).

## Goal

Tapping a file in **Files** shows it the way the canvas would: tables for CSV/TSV, highlighted code, pretty JSON,
rendered Mermaid, a running (offline, sandboxed) HTML page, and a player for audio and video. Today only plain text,
Markdown and images preview.

T3 Code: `apps/web/src/components/files/*` (`DelimitedTablePreview`, `ReadOnlySourcePreview`, `MermaidFilePreview`,
`AudioPreview`, `PdfViewer`, `OfficeViewer`…). We take the cheap ones; PDF and Office stay with **Open with…**.

## What exists today

- `web/src/components/Screens.tsx`, `FilesScreen`: `open(e)` decides `canText` (`TEXT_EXT` or `text/*` MIME) and
  `canImg` (`IMG_EXT` or `image/*`), refuses files over `PREVIEW_MAX` (3 MB), reads the file with
  `GET /api/files/read?path=…` (answer `{ data_url }`), and shows it in a `Sheet`: `<img>`, `Markdown` for
  `.md`/`.markdown`, else `<pre>`. Actions: Delete, **Open with…** (`openFile`, Android's chooser), and for text an
  "open in canvas" button (`openFileInCanvas`).
- `web/src/components/Canvas.tsx`, `DocView({ doc, text, network })`: renders by `doc.type`:
  `markdown`, `html` (`HtmlFrame`), `code` (fenced Markdown with `doc.lang`), `json` (pretty), `mermaid`, `csv`
  (`CsvTable`), `svg`, else plain text. Exactly the renderers we want.
- `web/src/components/Media.tsx`, `Media({ src })`: plays audio/video/images from a phone path (it streams through the
  plugin; see `mediaKind`/`useSrc`). Media does not need the file read as a data URL.

## Design

| Files with | Preview |
|---|---|
| `.csv`, `.tsv` | table (`csv`; TSV parsed with tabs) |
| `.json` | pretty JSON (`json`) |
| `.mmd`, `.mermaid` | diagram (`mermaid`) |
| `.html`, `.htm` | the page, offline sandbox, network off (`html`) |
| `.svg` | the image (as today) |
| code extensions in `TEXT_EXT` (`py`, `js`, `ts`, `tsx`, `jsx`, `sh`, `java`, `kt`, `c`, `h`, `cpp`, `rs`, `go`, `rb`, `css`, `xml`, `sql`, `yaml`/`yml`, `toml`) | highlighted code (`code`, language from the extension) |
| `.md`, `.markdown` | Markdown (as today) |
| other text | plain text (as today) |
| `.mp3`, `.m4a`, `.ogg`, `.wav`, `.flac`, `.mp4`, `.webm`, `.mov`, `.mkv` | player (`Media`), no size limit (it streams) |
| `.pdf`, `.docx`, `.xlsx`, `.pptx`, others | note `No preview here. Use Open with… to view it in another app.` |

- Size limit stays 3 MB for everything that is read into the page.
- The sheet keeps its actions. For HTML, the canvas button opens it in the canvas, where network can be allowed.

## Implementation steps

1. **Export `CsvTable` and `DocView`** from `Canvas.tsx` (or move them to `web/src/components/DocView.tsx` together
   with `fenced` and `CsvTable`, and import them in both places; prefer the move: `Canvas.tsx` is long). Give
   `CsvTable` a `sep` prop (`','` default, `'\t'` for TSV) and check its parser handles quoted fields; if it doesn't,
   don't change its behaviour for the canvas: add the TSV path only.
2. **New pure function** `previewKind(name: string, mime?: string): { kind: 'doc'; type: DocType; lang?: string } | { kind: 'image' } | { kind: 'media' } | { kind: 'none' }`
   in `web/src/filekind.ts`, with the table above. `DocType` is the canvas's doc type union (import it from
   `web/src/canvas.ts`). The language for code is the extension, mapped where highlight.js names differ
   (`yml` → `yaml`, `kt` → `kotlin`, `rs` → `rust`, `rb` → `ruby`, `sh` → `bash`, `h` → `c`, `tsx` → `typescript`,
   `jsx` → `javascript`).
3. **`FilesScreen.open`**: use `previewKind`.
   - `media`: `setPreview({ entry, media: e.path })` without reading the file; render `<Media src={path} />`.
   - `doc`: read as today (size check first), then render
     `<DocView doc={{ id: '', title: e.name, type, lang, ... }} text={text} network={false} />`. Build the minimal
     `doc` object `DocView` needs (check its type; if it needs many fields, change `DocView`'s props to
     `{ type, lang, title, text, network }` and update the canvas call).
   - `none`: the note above.
4. Keep the Markdown and image branches working as today (they become `doc`/`markdown` and `image`).

## Tests

**Unit** (`web/src/filekind.test.ts`): `previewKind` for each row of the table, upper-case extensions (`A.CSV`),
names without an extension, a `text/plain` MIME with an unknown extension (text), `application/pdf` (none).

**Mock**: `mock.cjs` serves `GET /api/files` (every folder lists folders `a`, `b` and `note.txt`) but has no
`/api/files/read` handler yet. Add entries `table.csv` (`a,b\n1,2`), `page.html` (`<h1>Hi</h1>`), `code.py`
(`print("x")`), `song.mp3`, `doc.pdf` to every listing (keep `note.txt` and the folders: other checks use them), and
a `GET /api/files/read` handler that answers `{ data_url: 'data:text/plain;base64,…' }` for the text ones (log the
call like other HTTP routes so the test can check that `song.mp3` was never read).

**E2E**:
1. `table.csv` → the sheet contains a `<table>` with a cell `2`.
2. `code.py` → highlighted code (a `.hljs` element or whatever class `rehype-highlight` adds; check what the canvas
   code view produces).
3. `page.html` → an iframe whose frame contains `Hi`; `sandbox` without `allow-same-origin`.
4. `song.mp3` → an `<audio>` element, and **no** `/api/files/read` call for it.
5. `doc.pdf` → the `No preview here…` note and the Open with… button.
6. The existing Files checks (Back goes up a folder, etc.) still pass.

## Spec and changelog

- `docs/SPEC.md` 3.14 "Files" (the preview table), 3.7 if `DocView` moves (`web/src/components/DocView.tsx`), source
  map (`web/src/filekind.ts`).
- `CHANGELOG.md` entry.

## Out of scope

PDF and Office rendering in the page (large libraries; Android apps do it better through Open with…), editing files
from the preview, previews in chat attachments.
