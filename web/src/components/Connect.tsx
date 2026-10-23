// Connecting Hermes to a model: the device-code sign-in sheet (used by Settings → Model providers) and the first-run
// welcome (the model step of the SetupFlow) that walks a fresh install through signing in or pasting a key, then picking a model.
//
// Sign-ins use the dashboard's own /api/providers/oauth routes (the ones Hermes's web dashboard uses):
// device-code providers (ChatGPT/Codex, Nous Portal, xAI Grok, MiniMax) run entirely in the app. Hermes
// has no in-dashboard login for a Claude subscription, only `hermes auth add anthropic` in a terminal: the app
// runs that login in its own sheet through the plugin, with Termux as the fallback (SignIn.tsx).
import { useEffect, useRef, useState } from 'react'
import { api, qs } from '../api'
import { copyText, haptic, openExternal } from '../bridge'
import { errText, rpc } from '../gateway'
import { toast, useStore } from '../store'
import { Sheet } from './Screens'
import { ModelPicker, setProfileModel } from './Settings'
import { ProviderList } from './Providers'
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

/** Provider names in words a phone user knows. Unknown providers just show their name. */
const NAME: Record<string, string> = {
  'openai-codex': 'ChatGPT / Codex',
  anthropic: 'Claude',
  'xai-oauth': 'xAI Grok',
  'minimax-oauth': 'MiniMax',
  'qwen-oauth': 'Qwen'
}
export const cliFor = (p: OAuthProvider, profile: string) => (profile && profile !== 'default' ? p.cli_command.replace(/^hermes /, `hermes -p ${profile} `) : p.cli_command)

/** Device-code login: show the code, open the provider's page, wait until Hermes says it's approved. */
export function DeviceLoginSheet({ provider, profile, onClose, onDone }: { provider: OAuthProvider; profile: string; onClose: () => void; onDone: () => void }) {
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

// ── First run ────────────────────────────────────────────────

const DONE = 'hm.welcomeDone'
export const welcomeDone = () => {
  try {
    return localStorage.getItem(DONE) === '1'
  } catch {
    return false
  }
}
export const markWelcomeDone = () => {
  try {
    localStorage.setItem(DONE, '1')
  } catch {
    /* private mode */
  }
}

/** The "model" step of the first-run SetupFlow (Setup.tsx): sign in or paste a key, then pick the model.
 *  `onChange` runs when a provider was connected, `onFinish` when the user picked a model, kept the current one or skipped. */
export function WelcomeBody({ onChange, onFinish }: { onChange?: () => void; onFinish: () => void }) {
  const profile = useStore(s => s.profile)
  const [ready, setReady] = useState(false)
  const [picking, setPicking] = useState(false)
  const recheck = () => {
    void rpc<{ provider_configured?: boolean }>('setup.status')
      .then(r => setReady(Boolean(r?.provider_configured)))
      .catch(() => {})
    onChange?.()
  }
  useEffect(recheck, [profile])
  const finish = () => {
    markWelcomeDone()
    onFinish()
  }
  return (
    <>
      <div className="welcome-hero">
        <div className="welcome-title">Connect Hermes to a model</div>
        <div className="dim">Hermes runs on this phone, but it thinks with a model in the cloud. Pick a provider: sign in with a subscription you already pay for, or paste an API key.</div>
      </div>
      <ProviderList profile={profile} onChange={recheck} onPicked={finish} />
      <div className="welcome-actions">
        <button className="btn primary block" disabled={!ready} onClick={() => setPicking(true)}>
          {ready ? 'Pick a model' : 'Connect a provider first'}
        </button>
        <button className="btn block" onClick={finish}>
          {ready ? 'Keep the current model' : 'Skip for now'}
        </button>
      </div>
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
    </>
  )
}
