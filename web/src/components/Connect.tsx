// Connecting Hermes to a model: subscription / account sign-ins (Settings → Accounts) and the first-run
// welcome that walks a fresh install through signing in or pasting a key, then picking a model.
//
// Sign-ins use the dashboard's own /api/providers/oauth routes (the ones Hermes's web dashboard uses):
// device-code providers (ChatGPT/Codex, Nous Portal, xAI Grok, MiniMax) run entirely in the app. Hermes
// deliberately has no in-dashboard login for a Claude subscription, only `hermes auth add anthropic` in a
// terminal, so for those "external" providers the app opens Termux on that command.
import { useEffect, useRef, useState } from 'react'
import { api, qs } from '../api'
import { copyText, haptic, openExternal, signInTermux } from '../bridge'
import { errText, loadDefaultModel, rpc } from '../gateway'
import { closeScreen, getState, setState, toast, useStore } from '../store'
import { ScreenShell, Sheet, Status, useLoader } from './Screens'
import { ModelPicker, setProfileModel } from './Settings'
import { Row, Section } from './ui'
import { Spinner } from './Spinner'

interface OAuthStatus {
  logged_in?: boolean
  source_label?: string | null
  token_preview?: string | null
  error?: string | null
}
export interface OAuthProvider {
  id: string
  name: string
  flow: 'device_code' | 'external' | string
  cli_command: string
  docs_url?: string
  disconnectable?: boolean
  status: OAuthStatus
}
interface DeviceStart {
  session_id: string
  user_code: string
  verification_url: string
  expires_in?: number
  poll_interval?: number
}
interface Poll {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'error' | string
  error_message?: string | null
}

/** What each sign-in is, in words a phone user knows. Unknown providers just show their name. */
const BLURB: Record<string, string> = {
  'openai-codex': 'ChatGPT Plus / Pro or a Codex plan',
  anthropic: 'Claude Pro / Max · signs in from Termux',
  nous: 'Nous Portal account',
  'xai-oauth': 'SuperGrok or X Premium+',
  'minimax-oauth': 'MiniMax account'
}
const NAME: Record<string, string> = {
  'openai-codex': 'ChatGPT / Codex',
  anthropic: 'Claude',
  'xai-oauth': 'xAI Grok',
  'minimax-oauth': 'MiniMax',
  'qwen-oauth': 'Qwen'
}
const ORDER = ['openai-codex', 'anthropic', 'xai-oauth', 'nous', 'minimax-oauth', 'qwen-oauth']

/** A sign-in the app can run: in-app device code, or `hermes auth add <id>` in Termux. */
// Only Claude: Qwen's "external" login just imports the Qwen CLI's credentials, which a phone doesn't have.
const IN_TERMUX = new Set(['anthropic'])
const termuxCommand = (p: OAuthProvider) => p.flow === 'external' && IN_TERMUX.has(p.id) && p.cli_command === `hermes auth add ${p.id}`
const usable = (p: OAuthProvider) => p.flow === 'device_code' || termuxCommand(p)

export const loadAccounts = (profile: string) =>
  api<{ providers: OAuthProvider[] }>('GET', `/api/providers/oauth?${qs({ profile })}`, undefined, { profile: false }).then(r =>
    (r.providers || [])
      // Logins that need another CLI (Copilot, Claude Code's setup-token) can't run on the phone: only show them when already signed in.
      .filter(p => usable(p) || p.status?.logged_in)
      .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99))
  )

/** The list of sign-ins for one profile, each with Sign in / Sign out. `onChange` runs after a login or logout. */
export function AccountsList({ profile, onChange, title }: { profile: string; onChange?: () => void; title?: string }) {
  const { data, error, loading, reload } = useLoader(() => loadAccounts(profile), [profile])
  const [device, setDevice] = useState<OAuthProvider | null>(null)
  const waitingTermux = useRef(false)

  // Back from Termux: see whether the login landed.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible' || !waitingTermux.current) return
      waitingTermux.current = false
      reload()
      onChange?.()
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [reload, onChange])

  const changed = () => {
    reload()
    onChange?.()
    void loadDefaultModel()
  }

  const signIn = (p: OAuthProvider) => {
    haptic()
    if (p.flow === 'device_code') return setDevice(p)
    if (signInTermux(p.id, profile)) {
      waitingTermux.current = true
      toast('Follow the steps in Termux, then come back here')
      return
    }
    void copyText(cliFor(p, profile))
    toast('Couldn’t open Termux. The command is copied: paste it in Termux inside Debian (proot-distro login debian)', 'error', 8000)
  }

  const signOut = (p: OAuthProvider) => {
    haptic()
    api('DELETE', `/api/providers/oauth/${encodeURIComponent(p.id)}?${qs({ profile })}`, undefined, { profile: false })
      .then(() => {
        toast(`Signed out of ${NAME[p.id] || p.name}`)
        changed()
      })
      .catch(e => toast(errText(e), 'error', 6000))
  }

  return (
    <>
      <Status loading={loading} error={error} empty={!data?.length} emptyText="This Hermes has no account sign-ins." />
      {data && data.length > 0 && (
        <Section title={title}>
          {data.map(p => {
            const on = Boolean(p.status?.logged_in)
            return (
              <Row
                key={p.id}
                title={
                  <span className="key-line">
                    <span className={on ? 'dot-set' : 'dot-unset'} />
                    <span>{NAME[p.id] || p.name}</span>
                  </span>
                }
                sub={on ? `Signed in${p.status.source_label ? ` · ${p.status.source_label}` : ''}` : BLURB[p.id] || p.name}
                trailing={
                  on ? (
                    p.disconnectable ? (
                      <button className="btn" onClick={() => signOut(p)}>
                        Sign out
                      </button>
                    ) : undefined
                  ) : usable(p) ? (
                    <button className="btn primary" onClick={() => signIn(p)}>
                      Sign in
                    </button>
                  ) : undefined
                }
              />
            )
          })}
        </Section>
      )}
      {device && (
        <DeviceLoginSheet
          provider={device}
          profile={profile}
          onClose={() => setDevice(null)}
          onDone={() => {
            setDevice(null)
            changed()
          }}
        />
      )}
    </>
  )
}

const cliFor = (p: OAuthProvider, profile: string) => (profile && profile !== 'default' ? p.cli_command.replace(/^hermes /, `hermes -p ${profile} `) : p.cli_command)

/** Device-code login: show the code, open the provider's page, wait until Hermes says it's approved. */
function DeviceLoginSheet({ provider, profile, onClose, onDone }: { provider: OAuthProvider; profile: string; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState<DeviceStart | null>(null)
  const [err, setErr] = useState('')
  const done = useRef(false)
  const name = NAME[provider.id] || provider.name

  useEffect(() => {
    let timer = 0
    let alive = true
    let sid = ''
    api<DeviceStart>('POST', `/api/providers/oauth/${encodeURIComponent(provider.id)}/start?${qs({ profile })}`, {}, { profile: false })
      .then(s => {
        if (!alive) return
        sid = s.session_id
        setStart(s)
        // Bounded: Hermes expires a session after its expires_in (≤ 15 min).
        const until = Date.now() + Math.min(s.expires_in || 900, 900) * 1000
        const every = Math.max(2, s.poll_interval || 3) * 1000
        const tick = () => {
          if (!alive) return
          if (Date.now() > until) return setErr('The code expired. Close this and try again.')
          api<Poll>('GET', `/api/providers/oauth/${encodeURIComponent(provider.id)}/poll/${encodeURIComponent(sid)}?${qs({ profile })}`, undefined, { profile: false })
            .then(p => {
              if (!alive) return
              if (p.status === 'approved') {
                done.current = true
                toast(`Signed in to ${name}`)
                onDone()
              } else if (p.status === 'pending') timer = window.setTimeout(tick, every)
              else setErr(p.error_message || (p.status === 'denied' ? 'The sign-in was declined.' : 'The sign-in didn’t finish. Try again.'))
            })
            .catch(e => alive && setErr(errText(e)))
        }
        timer = window.setTimeout(tick, every)
      })
      .catch(e => alive && setErr(errText(e)))
    return () => {
      alive = false
      clearTimeout(timer)
      // Closed before it finished: tell Hermes to stop waiting (its poller would otherwise save a late login).
      if (sid && !done.current) void api('DELETE', `/api/providers/oauth/sessions/${encodeURIComponent(sid)}?${qs({ profile })}`, undefined, { profile: false }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, profile])

  return (
    <Sheet title={`Sign in to ${name}`} onClose={onClose}>
      <div className="sheet-scroll">
        {err && <div className="notice notice-error">{err}</div>}
        {!start && !err && <div className="dim pad">Asking {name} for a sign-in code…</div>}
        {start && !err && (
          <div className="device-login">
            <div className="dim small">1. Copy this code</div>
            <button
              className="device-code mono"
              onClick={() => {
                haptic()
                void copyText(start.user_code)
                toast('Code copied')
              }}
            >
              {start.user_code}
            </button>
            <div className="dim small">2. Open the sign-in page, sign in and enter the code</div>
            <button
              className="btn primary block"
              onClick={() => {
                haptic()
                void copyText(start.user_code)
                openExternal(start.verification_url)
              }}
            >
              Copy code and open {hostOf(start.verification_url)}
            </button>
            <div className="device-wait dim small">
              <Spinner small /> 3. Come back here: this closes by itself once you’re signed in
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return 'the page'
  }
}

// ── API keys, the short list (everything else is under Settings → API keys) ──

const KEY_PROVIDERS: { env: string; name: string; sub: string; url: string }[] = [
  { env: 'OPENROUTER_API_KEY', name: 'OpenRouter', sub: 'One key for hundreds of models', url: 'https://openrouter.ai/keys' },
  { env: 'ANTHROPIC_API_KEY', name: 'Anthropic', sub: 'Claude API key', url: 'https://console.anthropic.com/settings/keys' },
  { env: 'OPENAI_API_KEY', name: 'OpenAI', sub: 'OpenAI API key', url: 'https://platform.openai.com/api-keys' },
  { env: 'GEMINI_API_KEY', name: 'Google AI Studio', sub: 'Gemini, has a free tier', url: 'https://aistudio.google.com/apikey' }
]

function KeyEntrySheet({ p, profile, onClose, onSaved }: { p: (typeof KEY_PROVIDERS)[number]; profile: string; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = () => {
    haptic()
    setBusy(true)
    // Same route as Settings → API keys: this profile's .env (the gateway's model.save_key has no profile parameter).
    api('PUT', `/api/env?${qs({ profile })}`, { key: p.env, value: key.trim() }, { profile: false })
      .then(() => {
        toast(`${p.name} connected`)
        onSaved()
        onClose()
      })
      .catch(e => toast(errText(e), 'error', 6000))
      .finally(() => setBusy(false))
  }
  return (
    <Sheet title={`${p.name} API key`} onClose={onClose}>
      <div className="sheet-scroll">
        <button className="btn" onClick={() => openExternal(p.url)}>
          Get a key ↗
        </button>
        <label className="field">
          <span>API key</span>
          <input className="mono" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste here" />
        </label>
        <div className="dim small">Saved in Hermes’s .env on this phone. It never leaves the phone except to call {p.name}.</div>
      </div>
      <div className="sheet-actions">
        <button className="btn primary" disabled={busy || !key.trim()} onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  )
}

// ── First run ────────────────────────────────────────────────

const DONE = 'hm.welcomeDone'
const welcomeDone = () => {
  try {
    return localStorage.getItem(DONE) === '1'
  } catch {
    return false
  }
}
const markWelcomeDone = () => {
  try {
    localStorage.setItem(DONE, '1')
  } catch {
    /* private mode */
  }
}

/** Once connected: a Hermes with no model provider at all (a fresh install) opens the welcome by itself. */
export async function checkFirstRun(): Promise<void> {
  if (welcomeDone() || getState().screen) return
  const r = await rpc<{ provider_configured?: boolean | null }>('setup.status').catch(() => null)
  if (!r || r.provider_configured == null) return
  if (r.provider_configured) return markWelcomeDone() // an existing setup never sees it
  if (!getState().screen) setState({ screen: 'welcome' })
}

export function WelcomeScreen() {
  const profile = useStore(s => s.profile)
  const [ready, setReady] = useState(false)
  const [keyFor, setKeyFor] = useState<(typeof KEY_PROVIDERS)[number] | null>(null)
  const [picking, setPicking] = useState(false)
  const recheck = () =>
    void rpc<{ provider_configured?: boolean }>('setup.status')
      .then(r => setReady(Boolean(r?.provider_configured)))
      .catch(() => {})
  useEffect(recheck, [profile])
  const finish = () => {
    markWelcomeDone()
    closeScreen()
  }
  return (
    <ScreenShell title="Welcome" onBack={finish}>
      <div className="welcome-hero">
        <div className="welcome-title">Connect Hermes to a model</div>
        <div className="dim">Hermes runs on this phone, but it thinks with a model in the cloud. Sign in with a subscription you already pay for, or paste an API key.</div>
      </div>
      <AccountsList profile={profile} onChange={recheck} title="Sign in with a subscription" />
      <Section title="Or use an API key" footer="Other providers (DeepSeek, xAI, Mistral, local models…) are under Settings → API keys.">
        {KEY_PROVIDERS.map(p => (
          <Row key={p.env} title={p.name} sub={p.sub} chevron onClick={() => setKeyFor(p)} />
        ))}
      </Section>
      <div className="welcome-actions">
        <button className="btn primary block" disabled={!ready} onClick={() => setPicking(true)}>
          {ready ? 'Pick a model' : 'Connect one of the above first'}
        </button>
        <button className="btn block" onClick={finish}>
          {ready ? 'Keep the current model' : 'Skip for now'}
        </button>
      </div>
      {keyFor && <KeyEntrySheet p={keyFor} profile={profile} onClose={() => setKeyFor(null)} onSaved={recheck} />}
      {picking && (
        <ModelPicker
          profile={profile}
          target="new chats"
          refresh
          onClose={() => setPicking(false)}
          onPick={async (provider, model, effort) => {
            await setProfileModel(profile, provider, model, effort)
            toast(`New chats use ${model}`)
            finish()
          }}
        />
      )}
    </ScreenShell>
  )
}
