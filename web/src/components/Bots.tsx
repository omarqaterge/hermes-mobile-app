// Bots = Hermes profiles, managed like Desktop's Profiles page: create (blank or cloned), rename,
// describe, edit SOUL.md, pick the model, delete. This app is the only front end, so there is no
// channels / messaging-gateway UI here (Telegram etc. are deliberately not exposed).
import { useEffect, useState } from 'react'
import { api, qs } from '../api'
import { errText, loadProfiles, startDraft, switchProfile } from '../gateway'
import { getState, setState, toast } from '../store'
import { haptic } from '../bridge'
import { promptDialog } from '../dialog'
import { ScreenShell, Sheet, Status, useLoader } from './Screens'
import { ModelPicker, profileLabel, setProfileModel } from './Settings'

interface Profile {
  name: string
  is_default: boolean
  model?: string | null
  provider?: string | null
  skill_count?: number
  gateway_running?: boolean
  description?: string
  display_name?: string
  bot_title?: string
}
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
const P = '/api/plugins/hermes-mobile'
const enc = encodeURIComponent

async function loadAll() {
  const p = await api<{ profiles: Profile[] }>('GET', '/api/profiles', undefined, { profile: false })
  return { profiles: p.profiles }
}

export function BotsScreen() {
  const { data, error, loading, reload, setData } = useLoader(loadAll, [])
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const profiles = data?.profiles || []
  const current = open ? profiles.find(p => p.name === open) : null
  return (
    <ScreenShell
      title="Bots"
      actions={
        <button className="icon-btn" aria-label="New bot" onClick={() => setCreating(true)}>
          ＋
        </button>
      }
    >
      <Status loading={loading} error={error} empty={!profiles.length} emptyText="No profiles" />
      {profiles.map(p => {
        return (
          <div key={p.name} className="card">
            <div className="list-row">
              <span className="avatar">{profileLabel(p).slice(0, 1).toUpperCase()}</span>
              <button className="list-main" onClick={() => setOpen(p.name)}>
                <span className="list-title">
                  {profileLabel(p)} {p.name !== profileLabel(p) && <span className="dim small mono">{p.name}</span>}
                </span>
                <span className="list-sub">{p.is_default ? 'Main profile' : p.description || 'No description'}</span>
                <span className="list-sub">{p.model || 'no model'}</span>
              </button>
            </div>
          </div>
        )
      })}
      {creating && (
        <CreateSheet
          profiles={profiles}
          onClose={() => setCreating(false)}
          onCreated={name => {
            setCreating(false)
            reload()
            void loadProfiles()
            setOpen(name)
          }}
        />
      )}
      {current && (
        <BotSheet
          p={current}
          onClose={() => setOpen(null)}
          onChanged={(renamed?: string) => {
            reload()
            void loadProfiles()
            if (renamed !== undefined) setOpen(renamed || null)
          }}
        />
      )}
    </ScreenShell>
  )
}

function CreateSheet({ profiles, onClose, onCreated }: { profiles: Profile[]; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('')
  const [cloneFrom, setCloneFrom] = useState<string>('default')
  const [description, setDescription] = useState('')
  const [soul, setSoul] = useState('')
  const [busy, setBusy] = useState(false)
  const bad = name !== '' && !NAME_RE.test(name)
  const create = async () => {
    setBusy(true)
    try {
      await api('POST', '/api/profiles', { name, clone_from: cloneFrom || null, description: description.trim() || null }, { profile: false })
      if (soul.trim()) await api('PUT', `/api/profiles/${enc(name)}/soul`, { content: soul }, { profile: false })
      // A new profile has its own empty plugins folder: link the Hermes Mobile plugin in (status chip, approvals…).
      await api('POST', '/api/plugins/hermes-mobile/profiles/link', {}, { profile: false }).catch(() => {})
      toast(`Created ${name}`)
      onCreated(name)
    } catch (e) {
      toast(errText(e), 'error', 6000)
      setBusy(false)
    }
  }
  return (
    <Sheet title="New bot" onClose={onClose}>
      <div className="sheet-scroll">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={e => setName(slug(e.target.value))} placeholder="my-bot" autoCapitalize="none" />
        </label>
        <div className={`small ${bad ? 'danger' : 'dim'}`}>Lowercase letters, numbers, - and _.</div>
        <div className="field">
          <span>Start from</span>
        </div>
        <div className="chips-row">
          <button className={`pill${cloneFrom === '' ? ' on' : ''}`} onClick={() => setCloneFrom('')}>
            Blank
          </button>
          {profiles.map(p => (
            <button key={p.name} className={`pill${cloneFrom === p.name ? ' on' : ''}`} onClick={() => setCloneFrom(p.name)}>
              {profileLabel(p)}
            </button>
          ))}
        </div>
        <div className="dim small">{cloneFrom ? `Copies ${cloneFrom}’s settings, keys, skills and SOUL.md (not its chats or memory).` : 'A fresh profile with the bundled skills.'}</div>
        <label className="field">
          <span>What is it for? (optional)</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Linear algebra tutor" />
        </label>
        <label className="field">
          <span>SOUL.md — personality (optional)</span>
          <textarea className="sheet-input mono" rows={5} value={soul} onChange={e => setSoul(e.target.value)} placeholder={cloneFrom ? 'Leave blank to keep the copied one' : 'You are…'} />
        </label>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !name || bad} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Sheet>
  )
}

function BotSheet({ p, onClose, onChanged }: { p: Profile; onClose: () => void; onChanged: (renamed?: string) => void }) {
  const [view, setView] = useState<'main' | 'soul' | 'model' | 'rename'>('main')
  const label = profileLabel(p)

  const chat = async () => {
    setState({ screen: null })
    await switchProfile(p.name)
    startDraft()
  }
  const del = async () => {
    const typed = await promptDialog({
      title: `Delete “${p.name}”?`,
      message: 'This deletes the bot and ALL its chats, memory, skills and keys. It cannot be undone. Type its name to confirm.',
      placeholder: p.name,
      match: p.name,
      confirmLabel: 'Delete bot',
      danger: true
    })
    if (typed == null) return
    try {
      if (getState().profile === p.name) await switchProfile('default')
      await api('DELETE', `/api/profiles/${enc(p.name)}`, undefined, { profile: false })
      toast(`Deleted ${p.name}`)
      onClose()
      onChanged()
    } catch (e) {
      toast(errText(e), 'error', 6000)
    }
  }

  if (view === 'soul') return <SoulSheet p={p} onClose={() => setView('main')} />
  if (view === 'rename') return <RenameSheet p={p} onClose={() => setView('main')} onDone={n => onChanged(n)} />
  if (view === 'model')
    return (
      <ModelPicker
        profile={p.name}
        target={label}
        onClose={() => setView('main')}
        onPick={async (provider, model, effort) => {
          await setProfileModel(p.name, provider, model, effort)
          toast(`${label} → ${model}`)
          onChanged()
        }}
      />
    )
  return (
    <Sheet title={label} onClose={onClose}>
      <div className="sheet-scroll">
        <DescriptionField p={p} onSaved={() => onChanged()} />
        <div className="kv">
          <div>Profile</div>
          <div className="mono small">{p.name}</div>
          <div>Model</div>
          <div>{p.model || '—'}</div>
          <div>Skills</div>
          <div>{p.skill_count ?? '—'}</div>
        </div>
        <div className="menu-list">
          <button className="menu-item" onClick={() => void chat()}>
            💬 Chat with {label}
          </button>
          <button className="menu-item" onClick={() => setView('model')}>
            🧩 Default model
          </button>
          <button className="menu-item" onClick={() => setView('soul')}>
            ✎ Personality (SOUL.md)
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setState({ screen: 'settings', screenProfile: p.name })
            }}
          >
            🔑 API keys & settings
          </button>
          <button className="menu-item" onClick={() => setView('rename')}>
            Aa Rename
          </button>
          {!p.is_default && (
            <button className="menu-item danger" onClick={() => void del()}>
              🗑 Delete bot
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function DescriptionField({ p, onSaved }: { p: Profile; onSaved: () => void }) {
  const [text, setText] = useState(p.description || '')
  const dirty = text.trim() !== (p.description || '').trim()
  return (
    <label className="field">
      <span>Description</span>
      <div className="search-row">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="What this bot is for" />
        {dirty && (
          <button
            className="btn primary"
            onClick={() =>
              api('PUT', `/api/profiles/${enc(p.name)}/description`, { description: text }, { profile: false })
                .then(() => {
                  toast('Saved')
                  onSaved()
                })
                .catch(e => toast(errText(e), 'error'))
            }
          >
            Save
          </button>
        )}
      </div>
    </label>
  )
}

function RenameSheet({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState(p.is_default ? profileLabel(p) : p.name)
  const [busy, setBusy] = useState(false)
  const bad = !p.is_default && !NAME_RE.test(name)
  return (
    <Sheet title={`Rename ${p.name}`} onClose={onClose}>
      <div className="sheet-scroll">
        <label className="field">
          <span>New name</span>
          <input value={name} onChange={e => setName(p.is_default ? e.target.value : slug(e.target.value))} autoCapitalize="none" />
        </label>
        <div className="dim small">{p.is_default ? 'The main profile keeps its id; this changes the name shown.' : 'Renames the folder and keeps chats, memory and skills.'}</div>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || !name.trim() || bad || name === p.name}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api<{ name: string }>('PATCH', `/api/profiles/${enc(p.name)}`, { new_name: name.trim() }, { profile: false })
              if (getState().profile === p.name && r.name !== p.name) await switchProfile(r.name)
              toast('Renamed')
              onDone(r.name)
            } catch (e) {
              toast(errText(e), 'error', 6000)
              setBusy(false)
            }
          }}
        >
          Rename
        </button>
      </div>
    </Sheet>
  )
}

function SoulSheet({ p, onClose }: { p: Profile; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [orig, setOrig] = useState('')
  useEffect(() => {
    api<{ content: string }>('GET', `/api/profiles/${enc(p.name)}/soul`, undefined, { profile: false })
      .then(r => {
        setText(r.content)
        setOrig(r.content)
      })
      .catch(e => {
        toast(errText(e), 'error')
        setText('')
      })
  }, [p.name])
  return (
    <Sheet title={`SOUL.md · ${profileLabel(p)}`} onClose={onClose}>
      {text == null ? (
        <div className="dim pad">Loading…</div>
      ) : (
        <textarea className="sheet-input mono soul-editor" value={text} onChange={e => setText(e.target.value)} placeholder="Who this bot is, how it talks, what it focuses on…" />
      )}
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          Back
        </button>
        <button
          className="btn primary"
          disabled={text == null || text === orig}
          onClick={() =>
            api('PUT', `/api/profiles/${enc(p.name)}/soul`, { content: text }, { profile: false })
              .then(() => {
                toast('Saved — new chats use it')
                onClose()
              })
              .catch(e => toast(errText(e), 'error'))
          }
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}
