// The opt-in card for usage stats (stats.ts), shown once after setup; "How did you hear about us?" after a yes; and the
// Settings → About switch. None of it renders without an app key.
import { useEffect, useState } from 'react'
import { lockView } from '../lockview'
import { answerStatsSource, markStatsAsked, setStatsChoice, statsAvailable, statsOn, statsSourceAsked, statsUndecided, STATS_SOURCES } from '../stats'
import { useStore } from '../store'
import { useBackHandler } from '../backstack'
import { useSheetDrag } from './useSheetDrag'
import { welcomeDone } from './Connect'
import { ToggleRow } from './ui'

function StatsSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

/** Fixed choices, no free text. Closing it without a choice counts as answered, and sends nothing. */
function SourceSheet({ onClose }: { onClose: () => void }) {
  const done = (source: string | null) => {
    answerStatsSource(source)
    onClose()
  }
  return (
    <StatsSheet title="How did you hear about us?" onClose={() => done(null)}>
      <div className="sheet-desc">Optional, and only asked once.</div>
      <div className="sheet-actions wrap">
        {STATS_SOURCES.map(s => (
          <button key={s} className="btn" onClick={() => done(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={() => done(null)}>
          Skip
        </button>
      </div>
    </StatsSheet>
  )
}

/** Once, when setup is finished and nothing else is on screen. Closing it any way but Yes leaves stats off. */
export function StatsCard() {
  const free = useStore(s => s.conn === 'open' && !s.screen && !s.sheet && !s.drawer && !s.requests.length)
  const [step, setStep] = useState<'ask' | 'source' | null>(null)
  useEffect(() => {
    if (!free || step || !statsAvailable() || !statsUndecided() || !welcomeDone()) return
    const wait = setTimeout(() => {
      if (lockView()) return
      markStatsAsked()
      setStep('ask')
    }, 1500)
    return () => clearTimeout(wait)
  }, [free, step])
  if (step === 'source') return <SourceSheet onClose={() => setStep(null)} />
  if (step !== 'ask') return null
  return (
    <StatsSheet title="Share anonymous usage stats?" onClose={() => setStep(null)}>
      <div className="sheet-desc strong">It helps show how many people use the app and which screens matter. It is off unless you say yes.</div>
      <div className="sheet-desc">
        What is sent: a random ID made only for this install, the app version, the Android version, and how often the app starts and which screens open.
      </div>
      <div className="sheet-desc">Never your chats, prompts, tool output, file names, model keys, account names or phone number.</div>
      <div className="sheet-desc">
        It goes to Aptabase, a stats service. Aptabase sees your internet address when a report arrives: it keeps a rough country and region and a one-day anonymous code from it, not the address.
      </div>
      <div className="sheet-desc">You can change this any time in Settings → About.</div>
      <div className="sheet-actions">
        <button className="btn" onClick={() => setStep(null)}>
          No thanks
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setStatsChoice(true)
            setStep('source')
          }}
        >
          Yes
        </button>
      </div>
    </StatsSheet>
  )
}

/** Settings → About. Off stops sending and forgets the install ID. */
export function StatsRow() {
  const [on, setOn] = useState(statsOn)
  const [asking, setAsking] = useState(false)
  if (!statsAvailable()) return null
  return (
    <>
      <ToggleRow
        icon="📊"
        tone="blue"
        title="Share anonymous usage stats"
        sub="A random ID, the app and Android versions, app starts and screen opens. Never chats or files"
        on={on}
        onChange={v => {
          setStatsChoice(v)
          setOn(v)
          if (v && !statsSourceAsked()) setAsking(true)
        }}
      />
      {asking && <SourceSheet onClose={() => setAsking(false)} />}
    </>
  )
}
