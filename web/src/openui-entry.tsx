// The OpenUI renderer, OpenUI's chat component library, its CSS and its OWN React copy. vite.config.ts (lazyBundle)
// builds this file on its own into an inert <script type="text/hm-lazy" id="hm-openui"> in index.html, and
// components/OpenUIBlock.tsx runs it on the first ```openui-lang block (lazy.ts). Each block gets its own React root in
// its own shadow root: the app's `.md` CSS can't leak in, and OpenUI's CSS stays out of the app.
import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Renderer, type ActionEvent, type McpClientLike, type OpenUIError } from '@openuidev/react-lang'
// The package root, not '@openuidev/react-ui/ThemeProvider': that deep path breaks under vitest's node ESM.
import { ThemeProvider } from '@openuidev/react-ui'
import css from '@openuidev/react-ui/components.css?inline'
import { library } from './openui-lib'

export interface BlockProps {
  code: string
  streaming: boolean
  mode: 'light' | 'dark'
  initialState?: Record<string, unknown>
  onAction: (e: ActionEvent) => void
  onState: (state: Record<string, unknown>) => void
  onErrors: (errors: OpenUIError[]) => void
  /** Phase 2: live Query() data through the plugin. */
  toolProvider?: McpClientLike | null
}
export interface BlockHandle {
  update(p: BlockProps): void
  unmount(): void
}
export interface OpenUIApi {
  mount(host: HTMLElement, p: BlockProps): BlockHandle
}

// One parsed stylesheet shared by the document (for Radix popups, which portal to <body>) and every block's shadow root.
let sheet: CSSStyleSheet | null = null
function adoptCss(root: Document | ShadowRoot) {
  if (!css) return // vitest doesn't load CSS
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    if (!sheet) {
      sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
    }
    if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return
  }
  const el = document.createElement('style') // very old WebViews
  el.textContent = css
  ;(root instanceof Document ? root.head : root).appendChild(el)
}

class Boundary extends Component<{ onCrash: (e: unknown) => void; children: ReactNode }, { bad: boolean }> {
  state = { bad: false }
  static getDerivedStateFromError() {
    return { bad: true }
  }
  componentDidCatch(e: unknown) {
    this.props.onCrash(e)
  }
  render() {
    return this.state.bad ? null : this.props.children
  }
}

function view(p: BlockProps, scope: string) {
  return (
    <Boundary onCrash={e => p.onErrors([{ source: 'runtime', code: 'render-error', message: String(e) }])}>
      <ThemeProvider mode={p.mode} cssSelector={`.${scope}`}>
        <Renderer
          response={p.code}
          library={library}
          isStreaming={p.streaming}
          initialState={p.initialState}
          onAction={p.onAction}
          onStateUpdate={p.onState}
          onError={p.onErrors}
          toolProvider={p.toolProvider ?? null}
        />
      </ThemeProvider>
    </Boundary>
  )
}

let seq = 0
const api: OpenUIApi = {
  mount(host, p) {
    adoptCss(document)
    const scope = `hm-oui-${++seq}`
    host.classList.add(scope) // ThemeProvider's --openui-* vars land on the host and inherit into the shadow tree
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    adoptCss(shadow)
    const inner = document.createElement('div')
    shadow.appendChild(inner)
    const root = createRoot(inner)
    root.render(view(p, scope))
    return {
      update: q => root.render(view(q, scope)),
      unmount: () => {
        root.unmount()
        inner.remove()
      }
    }
  }
}
;(window as unknown as { __hmOpenUI?: OpenUIApi }).__hmOpenUI = api
