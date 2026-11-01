// Built separately (vite.config.ts → lazyBundle 'hm-rich') into an inert <script type="text/hm-lazy"> block of
// index.html; rich.ts runs it on the first message with math or a code block, so the phone doesn't parse KaTeX and
// highlight.js (about 1 MB with their CSS and fonts) at every start.
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import hljsCss from 'highlight.js/styles/github-dark.css?inline'
import katexCss from 'katex/dist/katex.min.css?inline'
import type { RichApi } from './rich'

const api: RichApi = { rehypeKatex, rehypeHighlight, css: `${hljsCss}\n${katexCss}` }
;(window as unknown as { __hmRich?: RichApi }).__hmRich = api
export default api
