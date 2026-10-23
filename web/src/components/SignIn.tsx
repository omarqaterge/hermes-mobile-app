// Signing in to Claude (a Pro / Max subscription) and telling the user whether it worked.
//
// Hermes's dashboard has no Claude sign-in of its own (only `hermes auth add anthropic` in a terminal), so the app
// uses the Hermes Mobile plugin's /claude-login routes: the same PKCE login, split in two (claude_login.py). The user
// opens claude.ai in the browser, signs in, copies the code Claude shows and pastes it here. Termux stays as the
// fallback (older plugin, or the user prefers it).
//
// Whether Claude is signed in: Hermes's /api/providers/oauth only looks at ~/.hermes/.anthropic_oauth.json and API key
// variables for its Anthropic card, but `hermes auth add anthropic` (and this login) save to the credential pool, so
// that card kept saying "not signed in" after a successful login. The pool (/api/credentials/pool) is read too.
import { useEffect, useRef, useState } from 'react'
import { api, qs } from '../api'
import { haptic, openExternal } from '../bridge'
import { errText, loadDefaultModel, rpc } from '../gateway'
import { toast } from '../store'
import { Sheet } from './Screens'
import { Spinner } from './Spinner'

interface PoolEntry {
  label?: string
  auth_type?: string
  source?: string
}
interface PoolAnswer {
  providers?: { provider: string; entries?: PoolEntry[] }[]
}
interface Status {
  logged_in?: boolean
  source?: string | null
  source_label?: string | null
}

/** The profile's credential pool (redacted by Hermes: labels and sources, never tokens). Empty when unavailable. */
export const loadPool = (profile: string): Promise<Record<string, PoolEntry[]>> =>
  api<PoolAnswer>('GET', `/api/credentials/pool?${qs({ profile })}`, undefined, { profile: false })
    .then(r => Object.fromEntries((r?.providers || []).map(p => [p.provider, p.entries || []])))
    .catch(() => ({}))

/** A Claude-subscription login Hermes will use: an OAuth pool entry (Claude Code's own login has its own card). */
const claudeLogin = (pool: Record<string, PoolEntry[]>) => (pool.anthropic || []).find(e => e.auth_type === 'oauth' && e.source !== 'claude_code')

/** Fills in "signed in" for logins Hermes's account list doesn't see (Claude in the credential pool). */
export function withPoolStatus<P extends { id: string; status: Status }>(providers: P[], pool: Record<string, PoolEntry[]>): P[] {
  return providers.map(p => {
    if (p.id !== 'anthropic' || p.status?.logged_in) return p
    const e = claudeLogin(pool)
    return e ? { ...p, status: { ...p.status, logged_in: true, source: 'credential_pool', source_label: e.label || null } } : p
  })
}

/** After a new login: the default model, and the live model list once so the new models show up in the pickers. */
export function afterSignIn(): void {
  void loadDefaultModel()
  void rpc('model.options', { refresh: true }).catch(() => {})
}

interface Start {
  session_id: string
  url: string
}

/** In-app Claude sign-in: open claude.ai, paste the code back, done. `onTermux` = do it in Termux instead. */
export function ClaudeSignInSheet({ profile, onClose, onDone, onTermux }: { profile: string; onClose: () => void; onDone: () => void; onTermux: () => void }) {
  const [start, setStart] = useState<Start | null>(null)
  const [unavailable, setUnavailable] = useState('')
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [round, setRound] = useState(0) // "Start again" makes a new link (a code works once)
  const sid = useRef('')
  const done = useRef(false)

  useEffect(() => {
    let alive = true
    setStart(null)
    setErr('')
    setCode('')
    api<Start>('POST', `/api/plugins/hermes-mobile/claude-login/start?${qs({ profile })}`, {}, { profile: false })
      .then(s => {
        if (!alive) return
        sid.current = s.session_id
        setStart(s)
      })
      .catch(e => alive && setUnavailable(errText(e)))
    return () => {
      alive = false
      // Closed or restarted before it finished: let the plugin forget the half-done sign-in now (it expires anyway).
      if (sid.current && !done.current) void api('POST', '/api/plugins/hermes-mobile/claude-login/cancel', { session_id: sid.current }, { profile: false }).catch(() => {})
      sid.current = ''
    }
  }, [profile, round])

  const submit = () => {
    if (!start || busy) return
    haptic()
    setBusy(true)
    setErr('')
    api<{ ok: boolean; label?: string }>('POST', `/api/plugins/hermes-mobile/claude-login/finish?${qs({ profile })}`, { session_id: start.session_id, code: code.trim() }, { profile: false })
      .then(() => {
        done.current = true
        toast('Signed in to Claude. Its models are in the model menu now.')
        onDone()
      })
      .catch(e => {
        const msg = errText(e)
        setErr(msg)
        // An expired or used-up sign-in can't take another code: offer a fresh one.
        if (/Start again/i.test(msg)) sid.current = ''
      })
      .finally(() => setBusy(false))
  }
  const restart = /Start again/i.test(err)

  return (
    <Sheet title="Sign in to Claude" onClose={onClose}>
      <div className="sheet-scroll">
        {unavailable ? (
          <>
            <div className="notice notice-warn">Hermes Mobile can’t do this sign-in in the app here ({unavailable}). Sign in with Termux instead: it runs the same login.</div>
            <button className="btn primary block" onClick={onTermux}>
              Sign in with Termux
            </button>
          </>
        ) : !start ? (
          <div className="device-wait dim small">
            <Spinner small /> Asking Hermes for a sign-in link…
          </div>
        ) : (
          <div className="device-login">
            <div className="dim small">1. Sign in on claude.ai with your Pro or Max account and allow access</div>
            <button
              className="btn primary block"
              onClick={() => {
                haptic()
                openExternal(start.url)
              }}
            >
              Open claude.ai
            </button>
            <div className="dim small">2. Claude shows a code. Copy it, come back and paste it here</div>
            <label className="field">
              <span>Code from Claude</span>
              <input
                className="mono"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="Paste the code here"
              />
            </label>
            {err && <div className="notice notice-error">{err}</div>}
            {restart ? (
              <button className="btn block" onClick={() => setRound(r => r + 1)}>
                Start again
              </button>
            ) : (
              <button className="btn primary block" disabled={busy || !code.trim()} onClick={submit}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            )}
            <div className="dim small">Hermes saves the login on this phone, like `hermes auth add anthropic` does. The code works once and only for 10 minutes.</div>
            <button className="btn block" onClick={onTermux}>
              Use Termux instead
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
