import { useEffect, useRef, useState } from 'react'
import { startDraft, switchProfile } from '../gateway'
import { setState, useStore, type Screen } from '../store'
import { SessionList } from './SessionList'
import { haptic } from '../bridge'
import { setSideHidden, useSidePanel } from '../sidepanel'
import { refreshPanelValues, usePanelValues } from '../panelvalues'
import { lessMotion } from '../motion'
import { Icon, type IconName } from './icons'
import { Sheet } from './Screens'
import { Row, Section } from './ui'
import { openLibrary } from '../library'

// The side panel: a glass sheet that lies over the chat (8 px in from the left, top and bottom edges), or, on a wide
// screen, the docked column. Top, pinned: the search field. Then, scrolling with the list: three rows (Scheduled,
// Skills, Library) and the chats. Bottom, pinned: the bot, Settings and New chat. Spec 3.13.

const botName = (p?: { display_name?: string | null; name?: string }, fallback = '') => p?.display_name || p?.name || fallback

export function Drawer() {
  const open = useStore(s => s.drawer)
  const profiles = useStore(s => s.profiles)
  const profile = useStore(s => s.profile)
  const [q, setQ] = useState('')
  const [botSheet, setBotSheet] = useState(false)
  const [wide, hidden] = useSidePanel()
  const docked = wide && !hidden

  // The rows' values load when the panel opens (docked: once at start, and again when the app returns, App.tsx), at
  // most once a minute: no timer. On a phone they are read once the sheet is in place, so the answer lands after the
  // slide and not in the middle of it (the transition's end; one short safety wait if no end comes).
  const aside = useRef<HTMLElement>(null)
  useEffect(() => {
    if (docked) return refreshPanelValues()
    const el = aside.current
    if (!open || !el) return
    if (lessMotion()) return refreshPanelValues()
    let done = false
    const go = () => {
      if (done) return
      done = true
      refreshPanelValues()
    }
    el.addEventListener('transitionend', go, { once: true })
    const safety = window.setTimeout(go, 500)
    return () => {
      done = true
      window.clearTimeout(safety)
      el.removeEventListener('transitionend', go)
    }
  }, [open, docked, profile])

  const current = profiles.find(p => p.name === profile)
  const name = botName(current, profile)
  const go = (screen: Exclude<Screen, null>) => {
    haptic()
    setState({ screen, screenProfile: null, drawer: false })
  }

  // The bot sheet opens over the chat once the panel has left, so a glass sheet never lies on the glass panel.
  const openBotSheet = () => {
    haptic()
    setState({ drawer: false })
    if (lessMotion() || docked) setBotSheet(true)
    else window.setTimeout(() => setBotSheet(true), 200)
  }

  return (
    <>
      <div className={`drawer-backdrop${open ? ' show' : ''}`} onClick={() => setState({ drawer: false })} />
      <aside ref={aside} className={`drawer${open ? ' open' : ''}`} aria-label="Chats">
        <div className="drawer-top">
          <input className="search" aria-label="Search chats" placeholder="Search chats" value={q} onChange={e => setQ(e.target.value)} />
          {/* Only shown while the list is docked on a wide screen (styles.css): hides it, also from Settings and other pages. */}
          <button className="icon-btn side-hide" aria-label="Hide the chat list" onClick={() => { haptic(); setSideHidden(true) }}>
            <Icon n="panelClose" />
          </button>
        </div>
        <div className="drawer-list">
          {!q.trim() && <PanelRows go={go} />}
          <SessionList query={q} />
        </div>
        <div className="drawer-bar">
          <button className="bot-btn" aria-label={`Bot: ${name}`} onClick={openBotSheet}>
            <span className="avatar sm" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <span className="bot-btn-name">{name}</span>
          </button>
          <button className="icon-btn" aria-label="Settings" onClick={() => go('settings')}>
            <Icon n="settings" />
          </button>
          <button className="btn primary new-chat" aria-label="New chat" onClick={() => startDraft()}>
            <Icon n="plus" />
            <span className="new-chat-label">New chat</span>
          </button>
        </div>
      </aside>
      {botSheet && <BotSheet onClose={() => setBotSheet(false)} />}
    </>
  )
}

/** The three rows at the top of the scrolling area. The values arrive after the panel has opened; they are read here, so a
 *  value that lands re-renders these rows and not the chat list beside them. */
function PanelRows({ go }: { go: (screen: Exclude<Screen, null>) => void }) {
  const values = usePanelValues()
  const rows: { icon: IconName; label: string; value?: string; onClick: () => void }[] = [
    { icon: 'clock', label: 'Scheduled', value: values.scheduled, onClick: () => go('cron') },
    { icon: 'sparkles', label: 'Skills', value: values.skills, onClick: () => go('skills') },
    { icon: 'folder', label: 'Library', onClick: () => { haptic(); openLibrary(); setState({ drawer: false }) } }
  ]
  return (
    <div className="panel-rows">
      {rows.map(r => (
        <button key={r.label} className="panel-row" onClick={r.onClick}>
          <span className="panel-row-icon" aria-hidden="true"><Icon n={r.icon} /></span>
          <span className="panel-row-name">{r.label}</span>
          {r.value && <span className="panel-row-value">{r.value}</span>}
        </button>
      ))}
    </div>
  )
}

/** The bots, the current one marked (a tap switches), then what this bot remembers and Manage bots. */
function BotSheet({ onClose }: { onClose: () => void }) {
  const profiles = useStore(s => s.profiles)
  const profile = useStore(s => s.profile)
  const current = profiles.find(p => p.name === profile)
  const open = (screen: Exclude<Screen, null>) => {
    onClose()
    setState({ screen, screenProfile: null, drawer: false })
  }
  return (
    <Sheet title="Bots" onClose={onClose}>
      <div className="sheet-scroll">
        <div className="bot-list">
          {profiles.map(p => (
            <button
              key={p.name}
              className={`picker-opt${p.name === profile ? ' on' : ''}`}
              aria-pressed={p.name === profile}
              onClick={() => {
                haptic()
                onClose()
                if (p.name !== profile) void switchProfile(p.name)
              }}
            >
              <span className="avatar sm" aria-hidden="true">{botName(p, p.name).slice(0, 1).toUpperCase()}</span>
              <span className="set-text">
                <span className="set-title">{botName(p, p.name)}</span>
                {p.model ? <span className="set-sub">{p.model}</span> : null}
              </span>
              <span className="picker-check">{p.name === profile ? <Icon n="check" /> : null}</span>
            </button>
          ))}
        </div>
        <Section>
          <Row icon="brain" tone="purple" title={`What ${botName(current, profile)} remembers`} chevron onClick={() => open('memory')} />
          <Row icon="bot" tone="gold" title="Manage bots" chevron onClick={() => open('bots')} />
        </Section>
      </div>
    </Sheet>
  )
}
