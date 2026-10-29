import { useState } from 'react'
import { startDraft, switchProfile } from '../gateway'
import { setState, useStore, type Screen } from '../store'
import { SessionList } from './SessionList'
import { haptic } from '../bridge'
import { setSideHidden } from '../sidepanel'

// Skills, memory, cron, files and projects live on the Hermes hub (one tile, more room for chats).
const NAV: [Exclude<Screen, null>, string, string][] = [
  ['hub', '☤', 'Hermes'],
  ['bots', '🤖', 'Bots'],
  ['settings', '⚙', 'Settings']
]

export function Drawer() {
  const open = useStore(s => s.drawer)
  const profiles = useStore(s => s.profiles)
  const profile = useStore(s => s.profile)
  const [q, setQ] = useState('')
  const [showProfiles, setShowProfiles] = useState(false)

  const current = profiles.find(p => p.name === profile)

  return (
    <>
      <div className={`drawer-backdrop${open ? ' show' : ''}`} onClick={() => setState({ drawer: false })} />
      <aside className={`drawer${open ? ' open' : ''}`}>
        <div className="drawer-top">
          <div className="drawer-head">
            <button className="profile-switch" onClick={() => setShowProfiles(v => !v)}>
              <span className="avatar">{(current?.display_name || profile).slice(0, 1).toUpperCase()}</span>
              <span className="profile-name">
                {current?.display_name || profile}
                <span className="dim small">{current?.description || (profile === 'default' ? 'Main profile' : '')}</span>
              </span>
              <span className="chev">{showProfiles ? '▴' : '▾'}</span>
            </button>
            {/* Only shown while the list is docked on a wide screen (styles.css): hides it, also from Settings and other pages. */}
            <button className="icon-btn side-hide" aria-label="Hide the chat list" onClick={() => { haptic(); setSideHidden(true) }}>
              «
            </button>
          </div>
          {showProfiles && (
            <div className="profile-list">
              {profiles.map(p => (
                <button
                  key={p.name}
                  className={`row${p.name === profile ? ' on' : ''}`}
                  onClick={() => {
                    haptic()
                    setShowProfiles(false)
                    void switchProfile(p.name)
                  }}
                >
                  <span className="avatar sm">{(p.display_name || p.name).slice(0, 1).toUpperCase()}</span>
                  <span>
                    {p.display_name || p.name}
                    {p.model ? <span className="dim small"> · {p.model}</span> : null}
                  </span>
                </button>
              ))}
              <button className="row dim" onClick={() => { setShowProfiles(false); setState({ screen: 'bots', drawer: false }) }}>
                ＋ New bot / manage bots…
              </button>
            </div>
          )}
          <button className="btn primary block" onClick={() => startDraft()}>
            ＋ New chat
          </button>
          <div className="nav-grid">
            {NAV.map(([key, icon, label]) => (
              <button key={key} className="nav-tile" onClick={() => { haptic(); setState({ screen: key, screenProfile: null, screenBack: null, drawer: false }) }}>
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Search sessions…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="drawer-list">
          <SessionList query={q} />
        </div>
      </aside>
    </>
  )
}
