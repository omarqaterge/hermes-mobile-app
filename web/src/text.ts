// Pure text helpers (no DOM, no React): unit-tested in text.test.ts.

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

const EXT: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', heic: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', aac: 'audio'
}

export function mediaKind(src: string): MediaKind {
  if (src.startsWith('data:image/')) return 'image'
  if (src.startsWith('data:video/')) return 'video'
  if (src.startsWith('data:audio/')) return 'audio'
  const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || ''
  return EXT[ext] || 'file'
}


// ── text preprocessing ──────────────────────────────────────
const MEDIA_RE = /[ \t]*MEDIA:(\S+?)(?=[.,;:!?)\]]*(?:\s|$))/g

/** Outside code: MEDIA:<path> → media/file markdown, \( \) / \[ \] → $ / $$ for KaTeX. */
export function prepare(text: string): string {
  return obsidianFrontmatter(text)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part // code span / fence: untouched
      const media = (path: string) => {
        const name = path.split('/').pop() || path
        const target = `<${path}>`
        return mediaKind(path) === 'file' ? ` [📎 ${name}](${target})` : `\n\n![${name}](${target})\n\n`
      }
      return joinHtmlBlocks(part)
        // A MEDIA: line on its own owns the whole line, so paths with spaces survive.
        .replace(/^[ \t]*MEDIA:[ \t]*(\S.*?)[ \t]*$/gm, (_m, path: string) => media(path))
        .replace(MEDIA_RE, (_m, path: string) => media(path))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, m: string) => `\n$$\n${m.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, m: string) => `$${m.trim()}$`)
        // Obsidian notes: a block id after the closing fence (`$$ ^eq1`) is not a closing fence for remark-math,
        // so the formula never ended and swallowed the rest of the message (as red KaTeX errors).
        .replace(/^([ \t>]*\$\$)[ \t]+\^[\w-]+[ \t]*$/gm, '$1')
        // [[Note|shown]] / [[Note#Heading]] → plain text, ==highlight== → <mark>
        .replace(/\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target.replace('#', ' › '))
        .replace(/==(?![\s=])([^=\n]+?)(?<![\s=])==/g, '<mark>$1</mark>')
    })
    .map((part, i) => (i % 2 === 1 ? part : fixColorbox(splitMathFences(part))))
    .join('')
}

/** CSS colour names models use for backgrounds (and KaTeX's \\colorbox{yellow}). */
const NAMED: Record<string, string> = {
  white: 'ffffff', black: '000000', yellow: 'ffff00', gold: 'ffd700', orange: 'ffa500', red: 'ff0000', pink: 'ffc0cb',
  salmon: 'fa8072', green: '008000', lime: '00ff00', lightgreen: '90ee90', blue: '0000ff', lightblue: 'add8e6',
  cyan: '00ffff', aqua: '00ffff', teal: '008080', navy: '000080', purple: '800080', violet: 'ee82ee', magenta: 'ff00ff',
  fuchsia: 'ff00ff', lavender: 'e6e6fa', gray: '808080', grey: '808080', lightgray: 'd3d3d3', lightgrey: 'd3d3d3',
  silver: 'c0c0c0', beige: 'f5f5dc', khaki: 'f0e68c', lightyellow: 'ffffe0', brown: 'a52a2a', maroon: '800000', olive: '808000'
}

/** Mean relative luminance (0 dark … 1 light) of the colours in a style's background, or null if it sets none.
 *  Used to give a styled HTML card readable text: models paint a light card and leave the text colour to inherit,
 *  which is white in the dark theme. */
export function backgroundLuminance(style: string): number | null {
  const vals = style
    .split(';')
    .map(d => d.split(':'))
    .filter(([p]) => /^\s*background(-color|-image)?\s*$/i.test(p ?? ''))
    .map(([, ...v]) => v.join(':').toLowerCase())
  const lum: number[] = []
  const add = (r: number, g: number, b: number, a = 1) => {
    if (a < 0.5) return
    const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    lum.push(0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b))
  }
  for (const v of vals) {
    for (const m of v.matchAll(/#([0-9a-f]{3,8})\b|rgba?\(([^)]*)\)|\b([a-z]{3,20})\b/g)) {
      if (m[3]) {
        const c = NAMED[m[3]]
        if (c) add(parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16))
      }
      else if (m[2]) {
        const [r, g, b, a] = m[2].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
        add(r, g, b, a ?? 1)
      } else {
        let h = m[1]
        if (h.length <= 4) h = [...h].map(c => c + c).join('')
        add(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1)
      }
    }
  }
  return lum.length ? lum.reduce((a, b) => a + b, 0) / lum.length : null
}

/** remark-math only ends a $$ block at a line that is just `$$`. Models often write `$$\begin{aligned}` …
 *  `\end{aligned}$$`: the opening line's rest became fence "meta" and the block never closed, so the rest of the
 *  message (an HTML card, everything) rendered as one red KaTeX error. Put such fences on their own lines. */
export function splitMathFences(text: string): string {
  if (!text.includes('$$')) return text
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^([ \t>]*)\$\$(.*)$/.exec(lines[i])
    // `$$x$$` on one line is fine, and so is a bare `$$` whose block closes properly below.
    if (!open || open[2].includes('$$')) { out.push(lines[i]); continue }
    let end = -1
    for (let j = i + 1; j < lines.length && end < 0; j++) if (/\$\$[ \t]*$/.test(lines[j])) end = j
    if (end < 0) { out.push(lines[i]); continue }
    const pre = open[1]
    out.push(pre + '$$')
    if (open[2].trim()) out.push(pre + open[2].trim())
    for (let j = i + 1; j < end; j++) out.push(lines[j])
    const last = lines[end].replace(/\$\$[ \t]*$/, '')
    if (last.slice(pre.length).trim()) out.push(last)
    out.push(pre + '$$')
    i = end
  }
  return out.join('\n')
}

/** A raw HTML block (<div>, <table>, <details>…) ends at its first blank line in Markdown, and what follows is read as
 *  Markdown again, where 4+ spaces of indentation make code blocks: a nicely indented card with blank lines in it fell
 *  apart into the first div plus pieces of source code. Blank lines inside a balanced block are removed so it stays one
 *  HTML block (HTML ignores them anyway). Unbalanced blocks are left alone. */
export function joinHtmlBlocks(text: string): string {
  if (!text.includes('<')) return text
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; ) {
    const m = /^ {0,3}<(div|section|article|aside|details|table|figure|center|blockquote|ul|ol)\b/i.exec(lines[i])
    if (m) {
      const open = new RegExp(`<${m[1]}\\b(?![^>]*/>)`, 'gi')
      const close = new RegExp(`</${m[1]}\\s*>`, 'gi')
      let depth = 0
      let end = -1
      for (let j = i; j < lines.length && end < 0; j++) {
        depth += (lines[j].match(open)?.length ?? 0) - (lines[j].match(close)?.length ?? 0)
        if (depth <= 0) end = j
      }
      if (end >= 0) {
        for (let j = i; j <= end; j++) if (lines[j].trim() !== '') out.push(lines[j])
        i = end + 1
        continue
      }
    }
    out.push(lines[i++])
  }
  return out.join('\n')
}

/** Obsidian "properties": a leading --- YAML --- block would render as a rule and a heading; show it as YAML code. */
function obsidianFrontmatter(text: string): string {
  const m = /^---[ \t]*\n([A-Za-z_][\w-]*:[\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  return m ? '```yaml\n' + m[1] + '\n```\n' + text.slice(m[0].length) : text
}

/** Brace-balanced `{…}` argument starting at s[i] === '{'; returns [content, indexAfter] or null. */
function braced(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') j++
    else if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

/** \colorbox / \fcolorbox take TEXT in KaTeX (and LaTeX), so math inside them (\frac, \displaystyle…)
 *  errors and the whole equation turns into red source. Wrap such a body in \( \) so it renders. */
function fixColorbox(text: string): string {
  const re = /\\f?colorbox\s*/g
  let out = ''
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let i = m.index + m[0].length
    const nArgs = m[0].startsWith('\\f') ? 2 : 1
    let ok = true
    for (let k = 0; k < nArgs && ok; k++) {
      const a = braced(text, i)
      if (a) i = a[1]
      else ok = false
    }
    const body = ok ? braced(text, i) : null
    if (!body) continue
    const [inner, end] = body
    if (/\\[a-zA-Z]|[\^_]/.test(inner) && !/\$|\\\(/.test(inner)) {
      out += text.slice(last, i) + `{\\(\\displaystyle ${inner}\\)}`
      last = end
      re.lastIndex = end
    }
  }
  return out + text.slice(last)
}


/** Tool results are often JSON ({"output": …, "exit_code": …}); show the readable part. */
export function formatOutput(raw: string): { text: string; meta: string; diff?: string } {
  try {
    const o = JSON.parse(raw)
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const main = o.output ?? o.content ?? o.result ?? o.text ?? o.stdout
      const meta = [
        o.exit_code != null ? `exit ${o.exit_code}` : '',
        o.error ? `error: ${typeof o.error === 'string' ? o.error : JSON.stringify(o.error)}` : ''
      ].filter(Boolean).join(' · ')
      if (typeof main === 'string') return { text: main, meta }
      // patch & co. return {"success": …, "diff": "--- a/…"}: show the diff, keep the rest as JSON.
      if (typeof o.diff === 'string' && o.diff.trim()) {
        const { diff, ...rest } = o
        return { text: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '', meta, diff }
      }
      return { text: JSON.stringify(o, null, 2), meta }
    }
  } catch {
    /* plain text */
  }
  return { text: raw, meta: '' }
}


/** The `memory` tool's edits as a unified diff, built from its arguments and result (Hermes only
 *  sends `inline_diff` for file edits). replace/remove results carry the full old entry
 *  (`replaced_entry`/`removed_entry`, per op number in a batch's `replaced_entries`/`removed_entries`). */
export function memoryDiff(args: Record<string, unknown> | null | undefined, raw: string): string | undefined {
  if (!args) return undefined
  let res: Record<string, unknown> = {}
  try {
    const o = JSON.parse(raw)
    if (o && typeof o === 'object') res = o
  } catch {
    /* no result yet: fall back to the arguments */
  }
  if (res.success === false) return undefined
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const rows = (sign: string, t: string) => t.split('\n').map(l => sign + l)
  const target = str(args.target) || 'memory'
  const out: string[] = []
  const op = (o: Record<string, unknown>, oldFull: unknown, n?: number) => {
    const act = str(o.action)
    const content = str(o.content) || str(o.new_text)
    const old = str(oldFull) || str(o.old_text)
    if (act !== 'add' && act !== 'replace' && act !== 'remove') return
    out.push(`@@ ${target} · ${n ? `${n}. ` : ''}${act} @@`)
    if (act !== 'add' && old) out.push(...rows('-', old))
    if (act !== 'remove' && content) out.push(...rows('+', content))
  }
  if (str(args.action) === 'batch' && Array.isArray(args.operations)) {
    const rep = (res.replaced_entries || {}) as Record<string, unknown>
    const rem = (res.removed_entries || {}) as Record<string, unknown>
    args.operations.forEach((o, i) => o && typeof o === 'object' && op(o as Record<string, unknown>, rep[i + 1] ?? rem[i + 1], i + 1))
  } else {
    op(args, res.replaced_entry ?? res.removed_entry)
  }
  return out.length ? out.join('\n') : undefined
}

/** Markdown → readable plain text: no ** # ` markers, links keep their address. */
export function plainText(md: string): string {
  return md
    .replace(/^\s*MEDIA:.*$/gm, '')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, t, u) => (t === u ? t : `${t} (${u})`))
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?![*\w])/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^[-=*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


/** CSV or TSV (by the first line) → rows; quoted cells may hold commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = text.split('\n', 1)[0].includes('\t') ? '\t' : ','
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) (row.push(cell), rows.push(row))
  return rows.filter(r => r.some(x => x.trim()))
}

/** A bare session id in a reply (outside code and links) becomes a link that opens that chat. */
export const chatLinks = (md: string): string =>
  md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\](?:\([^)\n]*\))?)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(?<![\w-])(?:@session:[\w.-]+\/)?(\d{8}_\d{6}_[0-9a-f]{6})(?![\w-])/g, '[chat $1](hermes-chat:$1)')))
    .join('')

/** Hermes joins approval warnings with "; " and its security scan can repeat one finding many times
 *  ("Security scan — [HIGH] X; [HIGH] X; …"): show each warning once, with a count. */
export function tidyApprovalText(s: string): string {
  const key = (p: string) => p.replace(/^Security scan [—-] /, '').trim()
  const seen = new Map<string, { text: string; n: number }>()
  for (const part of s.split('; ')) {
    const k = key(part)
    const hit = seen.get(k)
    if (hit) hit.n++
    else seen.set(k, { text: part, n: 1 })
  }
  return [...seen.values()].map(v => (v.n > 1 ? `${v.text} (×${v.n})` : v.text)).join('; ')
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const count = (s: string, c: string) => s.split(c).length - 1
export type LinkPart = { text: string; href?: string }
/** Split plain text into text and web addresses (trailing punctuation and an unbalanced ")" belong to the sentence). */
export function linkParts(s: string): LinkPart[] {
  const out: LinkPart[] = []
  let last = 0
  for (const m of s.matchAll(URL_RE)) {
    let url = m[0]
    while (/[.,;:!?'"\]]$/.test(url) || (url.endsWith(')') && count(url, ')') > count(url, '('))) url = url.slice(0, -1)
    const at = m.index ?? 0
    if (!/^(?:https?:\/\/|www\.)./i.test(url)) continue
    if (at > last) out.push({ text: s.slice(last, at) })
    out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    last = at + url.length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

/** A phone_app tool call in plain words ("Using Keep", "Tapping in Keep"), for tool cards that carry no label of their own. */
export function phoneAppLabel(args?: Record<string, unknown> | null): string {
  if (!args) return ''
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : '')
  const app = str('app')
  const action = str('action')
  const text = str('text')
  const short = text.length > 40 ? `${text.slice(0, 40)}…` : text
  const inApp = app ? ` in ${app}` : ''
  switch (action) {
    case 'open':
      return app ? `Using ${app}` : 'Opening an app'
    case 'capture':
      return `Looking at the screen${inApp}`
    case 'tap':
      return `Tapping${inApp}`
    case 'set_text':
    case 'type':
      return short ? `Typing "${short}"${inApp}` : `Typing${inApp}`
    case 'key':
      return text ? `Pressing ${text}${inApp}` : `Pressing a key${inApp}`
    case 'scroll':
      return `Scrolling${inApp}`
    case 'wait':
      return `Waiting${inApp}`
    case 'list_apps':
      return 'Listing apps'
    case 'hand_over':
      return app ? `Handing ${app} over to you` : 'Handing the app over to you'
    case 'close':
      return app ? `Closing ${app}` : 'Closing the app'
    default:
      return app ? `Using ${app}` : ''
  }
}
