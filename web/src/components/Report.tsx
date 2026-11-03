// "Report a problem": a sheet that turns what the user writes into a public GitHub issue (report.ts). Opened from
// Settings → About and from error states (openReport). What goes with the words is on screen before Submit.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { appLog, openChatText } from '../applog'
import { openExternal } from '../bridge'
import { fallbackUrl, MAX_TEXT, MAX_TITLE, prepareScreenshot, relayUrl, reportDetails, REPORT_REPO, scrubLog, sendReport, type Report, type Screenshot } from '../report'
import { toast, useStore } from '../store'
import { Sheet } from './Screens'
import { Row, ToggleRow } from './ui'

let shown = false
const subs = new Set<() => void>()
const setShown = (v: boolean) => {
  shown = v
  subs.forEach(f => f())
}
/** Opens the sheet from anywhere (error states, Settings). */
export const openReport = (): void => setShown(true)

// The draft outlives a closed sheet (a tap outside it, Back), until it is sent.
const draft = { title: '', text: '', withLog: false }

type Phase = { kind: 'edit' } | { kind: 'sending' } | { kind: 'sent'; url: string; screenshot: boolean } | { kind: 'github'; why: 'no-relay' | 'limit' | 'failed'; url: string }

const SHOT_NOTE = '_Screenshot: add it to this box before creating the issue._'

function ReportSheet({ onClose }: { onClose: () => void }) {
  const hermes = useStore(s => String(s.active?.info?.version || s.health?.version || ''))
  const [title, setTitle] = useState(draft.title)
  const [text, setText] = useState(draft.text)
  const [withLog, setWithLog] = useState(draft.withLog)
  const [shot, setShot] = useState<(Screenshot & { preview: string }) | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const pick = useRef<HTMLInputElement>(null)
  useEffect(() => {
    Object.assign(draft, { title, text, withLog })
  }, [title, text, withLog])
  const details = reportDetails(hermes)
  // Read once when switched on: what is shown is what is sent, and typing doesn't scrub it again.
  const log = useMemo(() => (withLog ? scrubLog(appLog(), openChatText()) : ''), [withLog])
  const relay = Boolean(relayUrl())
  const ready = title.trim() && text.trim() && phase.kind === 'edit'
  // A send in progress finishes on screen (30 seconds at most): closed, it could open GitHub out of nowhere or be sent twice.
  const close = () => {
    if (phase.kind !== 'sending') onClose()
  }

  const submit = async () => {
    if (!ready) return
    const r: Report = { title: title.trim(), text: text.trim(), details, log: log || undefined }
    setPhase({ kind: 'sending' })
    try {
      const res = await sendReport(r, shot && { type: shot.type, data: shot.data })
      if (res.kind === 'sent') {
        Object.assign(draft, { title: '', text: '', withLog: false })
        setPhase(res)
        return
      }
      const url = fallbackUrl(r, shot ? SHOT_NOTE : '')
      setPhase({ kind: 'github', why: res.why, url })
      openExternal(url)
    } catch {
      setPhase({ kind: 'edit' })
      toast("Couldn't send the report", 'error')
    }
  }

  if (phase.kind === 'sent')
    return (
      <Sheet title="Report sent" onClose={onClose}>
        <div className="sheet-scroll">
          <div className="sheet-desc strong">Thanks. Your report is now an issue on GitHub{phase.screenshot ? ', with the screenshot' : ''}.</div>
          {shot && !phase.screenshot && <div className="sheet-desc">The screenshot didn't go with it: you can add it on GitHub.</div>}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={() => openExternal(phase.url)}>Open the report</button>
        </div>
      </Sheet>
    )

  if (phase.kind === 'github')
    return (
      <Sheet title="Finish on GitHub" onClose={onClose}>
        <div className="sheet-scroll">
          <div className="sheet-desc strong">
            {phase.why === 'limit'
              ? 'This phone has sent several reports today, so this one goes through GitHub.'
              : phase.why === 'failed'
                ? "The app couldn't send it."
                : 'Reports from the app go through GitHub.'}{' '}
            GitHub's new-issue page has your report filled in: sign in there and tap Create.
          </div>
          {shot && <div className="sheet-desc">Add your screenshot there yourself: GitHub's text box takes files.</div>}
          <div className="sheet-desc">Your words stay here until a report is sent, so nothing is lost if you close this.</div>
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={() => setPhase({ kind: 'edit' })}>Back</button>
          <button className="btn primary" onClick={() => openExternal(phase.url)}>Open GitHub again</button>
        </div>
      </Sheet>
    )

  return (
    <Sheet title="Report a problem" onClose={close}>
      <div className="sheet-scroll report">
        <div className="notice notice-warn">Reports are public: anyone can read them on GitHub. Don't write anything private.</div>
        <label className="field">
          Title
          <input className="sheet-input" value={title} maxLength={MAX_TITLE} placeholder="What went wrong, in a few words" onChange={e => setTitle(e.target.value)} />
        </label>
        <label className="field">
          What happened
          <textarea className="sheet-input" rows={5} value={text} maxLength={MAX_TEXT} placeholder="What you did, what you expected, what happened instead" onChange={e => setText(e.target.value)} />
        </label>
        <div className="sheet-desc">
          Sent with it: app {details.app}, Android {details.android || 'unknown'}, Hermux agent {details.hermes || 'unknown'}. Nothing else about your phone.
        </div>
        <ToggleRow title="Include recent app log" sub="Errors and connection changes from this session. You can read it below first" on={withLog} onChange={setWithLog} />
        {withLog && (
          <>
            <pre className="sheet-code report-log" aria-label="App log to send">{log || 'Nothing logged yet.'}</pre>
            <div className="sheet-desc">The app takes out keys, tokens, emails, internet addresses, links' details, home folders and chat text it recognises. It can miss some: read it, because it will be public.</div>
          </>
        )}
        {relay ? (
          shot ? (
            <div className="report-shot">
              <img src={shot.preview} alt="Screenshot to send" />
              <div className="sheet-desc strong">The screenshot will be public too. Check it shows nothing private.</div>
              <button className="btn" onClick={() => setShot(null)}>Remove screenshot</button>
            </div>
          ) : (
            <Row icon="🖼" tone="blue" title="Add a screenshot" sub="Optional. It will be public" onClick={() => pick.current?.click()} />
          )
        ) : (
          <div className="sheet-desc">To add a screenshot, attach it on the GitHub page that opens.</div>
        )}
        <input
          ref={pick}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) prepareScreenshot(f).then(setShot, () => toast("Couldn't read that picture", 'error'))
          }}
        />
        <div className="sheet-desc">This becomes a public issue in {REPORT_REPO} on GitHub.</div>
      </div>
      <div className="sheet-actions">
        <button className="btn" disabled={phase.kind === 'sending'} onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!ready} onClick={() => void submit()}>
          {phase.kind === 'sending' ? 'Sending…' : relay ? 'Submit' : 'Continue on GitHub'}
        </button>
      </div>
    </Sheet>
  )
}

/** Mounted once in App.tsx. */
export function ReportHost() {
  const open = useSyncExternalStore(
    cb => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => shown
  )
  return open ? <ReportSheet onClose={() => setShown(false)} /> : null
}

/** Settings → About. */
export function ReportRow() {
  return <Row icon="🐞" tone="red" title="Report a problem" sub="Becomes a public issue on GitHub" chevron onClick={openReport} />
}

/** A small "Report a problem" link under an error message. */
export function ReportLink() {
  return (
    <button className="report-link" onClick={openReport}>
      Report a problem
    </button>
  )
}
