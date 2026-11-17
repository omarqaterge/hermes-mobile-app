// Built separately (vite.config.ts → lazyBundle 'hm-rich') into an inert <script type="text/hm-lazy"> block of
// index.html; rich.ts runs it on the first message with math or a code block, so the phone doesn't parse KaTeX and
// highlight.js (about 1 MB with their CSS and fonts) at every start.
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import hljsCss from 'highlight.js/styles/github-dark.css?inline'
import katexCss from 'katex/dist/katex.min.css?inline'
import type { RichApi } from './rich'

// rehype-highlight builds its language definitions (37 of them) each time it joins a Markdown processor, and
// react-markdown makes a processor for every drawing of every message: about 1.5 ms each on a fast computer, more than
// reading a short message itself. So what it builds is kept, once per setting, and handed to every processor.
type Highlight = ReturnType<typeof rehypeHighlight>
const built = new Map<string, Highlight>()
function highlightOnce(options?: Parameters<typeof rehypeHighlight>[0]): Highlight {
  const key = JSON.stringify(options ?? {})
  let made = built.get(key)
  if (!made) built.set(key, (made = rehypeHighlight(options)))
  return made
}

const api: RichApi = { rehypeKatex, rehypeHighlight: highlightOnce, css: `${hljsCss}\n${katexCss}` }
;(window as unknown as { __hmRich?: RichApi }).__hmRich = api
export default api
