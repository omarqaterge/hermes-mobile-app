// Math (KaTeX) and code colours (highlight.js) come in a lazy bundle (rich-entry.ts, built by vite.config.ts as
// 'hm-rich'), loaded the first time a message needs one. Until then Markdown renders the formula's TeX as inline code
// and code blocks without colours; once it is loaded, every message re-renders with them.
import type { Options } from 'react-markdown'
import { runLazy } from './lazy'

type Plugin = NonNullable<Options['rehypePlugins']>[number]

export interface RichApi {
  rehypeKatex: Plugin
  rehypeHighlight: Plugin
  /** highlight.js's dark palette and KaTeX's CSS (fonts inlined), added to the page when the bundle loads. */
  css: string
}

let api: RichApi | null = null
let loading: Promise<void> | null = null
const subs = new Set<() => void>()

export const richApi = (): RichApi | null => api

/** For Markdown's useSyncExternalStore: called once the bundle is loaded. */
export function subscribeRich(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

// Math (remark-math's $…$, $$…$$, \(…\), \[…\], also inside raw HTML), a fenced or indented code block, or HTML <pre>.
// A false match only loads the bundle a little early.
const NEEDS = /\$|\\[([]|```|~~~|<pre|^(?: {4}|\t)\S/m
export const needsRich = (text: string): boolean => NEEDS.test(text)

export function loadRich(): Promise<void> {
  loading ||= (import.meta.env.DEV ? import('./rich-entry').then(m => m.default) : runLazy<RichApi>('hm-rich', '__hmRich')).then(a => {
    if (api) return
    // After the page's own CSS, where main.tsx imported these before they were lazy.
    const style = document.createElement('style')
    style.id = 'hm-rich-css'
    style.textContent = a.css
    document.head.appendChild(style)
    api = a
    for (const cb of [...subs]) cb()
  })
  loading.catch(() => (loading = null)) // a failed load can be retried
  return loading
}
