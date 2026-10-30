import { useEffect, useState } from 'react'
import { haptic } from '../bridge'
import { useStore } from '../store'
import { useVoice } from '../voice'
import { QUOTE_MAX, addQuote } from '../quote'

const SCOPE = '.msg.assistant .md'
const scopeOf = (n: Node | null): Element | null => ((n?.nodeType === 1 ? (n as Element) : n?.parentElement) ?? null)?.closest(SCOPE) ?? null

/** Bar above the composer while words are selected inside one of Hermes's replies: Quote or Explain them. */
export function QuoteBar({ onExplain }: { onExplain: (selection: string) => void }) {
  const [sel, setSel] = useState('')
  const chat = useStore(s => s.active?.storedId)
  const sheet = useStore(s => s.sheet)
  const live = useVoice(v => v.live)

  useEffect(() => {
    const on = () => {
      const s = window.getSelection()
      let t = ''
      if (s && !s.isCollapsed) {
        const a = scopeOf(s.anchorNode)
        if (a && a === scopeOf(s.focusNode)) t = s.toString().trim()
      }
      setSel(t.length > 2 ? t : '')
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [])
  useEffect(() => setSel(''), [chat, sheet])

  if (!sel || sheet || live !== 'off') return null
  const tooLong = sel.length > QUOTE_MAX
  const done = () => {
    haptic()
    setSel('')
    window.getSelection()?.removeAllRanges()
  }
  return (
    <div className="quote-bar">
      <span className="quote-bar-label">{tooLong ? 'Selection is too long to quote' : 'Selected text'}</span>
      <button
        className="quote-bar-btn"
        disabled={tooLong}
        // Keep the selection and the keyboard state while tapping.
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          addQuote(sel)
          done()
          document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
        }}
      >
        Quote
      </button>
      <button
        className="quote-bar-btn"
        disabled={tooLong}
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          const t = sel
          done()
          onExplain(t)
        }}
      >
        Explain
      </button>
    </div>
  )
}
