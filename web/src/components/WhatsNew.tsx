// "What's new": the release sections shared by Settings → About (before an update) and the one-time sheet after one.
import { useMemo, useState } from 'react'
import { appVersion, haptic } from '../bridge'
import { useBackHandler } from '../backstack'
import { useDialogOpen } from '../dialog'
import { headlines, type ReleaseNotes } from '../releasenotes'
import { useStore } from '../store'
import { dismissWhatsNewAfterUpdate, useWhatsNewAfterUpdate } from '../whatsnew'
import { Markdown } from './Markdown'
import { useSheetDrag } from './useSheetDrag'

/** Each version as a heading with its date and its short lines. `full` (when given) shows every version's details
 *  and hides the per-version Details buttons; without it each version has its own. */
export function WhatsNewSections({ notes, full }: { notes: ReleaseNotes[]; full?: boolean }) {
  return (
    <>
      {notes.map(r => (
        <section key={r.version}>
          <h3 className="whats-new-version">
            {r.version}
            {r.date && <span className="dim small"> · {r.date}</span>}
          </h3>
          <WhatsNewNotes text={r.text} full={full} />
        </section>
      ))}
    </>
  )
}

/** One release: a short line per change, biggest first, smaller changes and fixes last; Details shows the full notes. */
function WhatsNewNotes({ text, full }: { text: string; full?: boolean }) {
  const [own, setOwn] = useState(false)
  const groups = useMemo(() => headlines(text), [text])
  if (!groups.length) return <Markdown text={text} />
  const shown = full ?? own
  return (
    <>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <h4 className="whats-new-group">{g.title}</h4>}
          <ul className="whats-new-list">
            {g.items.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ))}
      {full === undefined && (
        <button className="whats-new-more" aria-expanded={own} onClick={() => setOwn(!own)}>
          {own ? 'Hide details' : 'Details'}
        </button>
      )}
      {shown && <Markdown text={text} />}
    </>
  )
}

/** The one-time sheet over the chat after an update; waits while Setup, a dialog, a request or another sheet shows. */
export function WhatsNewAfterUpdate() {
  const notes = useWhatsNewAfterUpdate()
  const screen = useStore(s => s.screen)
  const sheet = useStore(s => s.sheet)
  const request = useStore(s => s.requests.length > 0)
  const dialog = useDialogOpen()
  if (!notes.length || screen === 'welcome' || screen === 'setup' || sheet || request || dialog) return null
  return <AfterUpdateSheet notes={notes} />
}

function AfterUpdateSheet({ notes }: { notes: ReleaseNotes[] }) {
  const [full, setFull] = useState(false)
  const close = () => {
    haptic()
    dismissWhatsNewAfterUpdate()
  }
  const drag = useSheetDrag(close)
  useBackHandler(close)
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet tall whats-new-after" role="dialog" aria-label="What's new" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="whats-new-head">
          <div>
            <div className="sheet-title">What's new</div>
            <div className="sheet-desc">You're on Hermux {appVersion().replace(/^v/i, '')}</div>
          </div>
          <button className="icon-btn" aria-label="Close" onPointerDown={e => e.stopPropagation()} onClick={close}>✕</button>
        </div>
        <div className="sheet-scroll whats-new">
          <WhatsNewSections notes={notes} full={full} />
        </div>
        <div className="sheet-actions">
          <button className="btn" aria-expanded={full} onClick={() => setFull(!full)}>
            {full ? 'Hide details' : 'Details'}
          </button>
          <button className="btn primary" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  )
}
