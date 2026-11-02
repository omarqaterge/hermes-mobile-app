// Settings → Connectors → Google: Gmail, Calendar, Drive, Docs, Sheets and Contacts through Hermes's google-workspace
// skill. Hermes has no dashboard route for it, so the plugin's /google routes run the skill's own setup script for the
// bot (google_workspace.py): store the user's OAuth client file, make Google's consent link, take back the address the
// browser lands on (http://localhost:1/?code=…, a page that never loads), check and revoke the token.
import { useEffect, useState } from 'react'
import { api, qs } from '../api'
import { haptic, openExternal } from '../bridge'
import { STATE_WORDS } from '../connectors'
import { confirmDialog } from '../dialog'
import { errText } from '../gateway'
import { toast } from '../store'
import { Sheet, useLoader } from './Screens'
import { Row, Section } from './ui'

export interface GoogleStatus {
  available: boolean
  client_secret: boolean
  signed_in: boolean
  unverified?: boolean // a saved sign-in Google couldn't be asked about right now (no network)
  detail?: string
  installing?: boolean
  install_error?: string
  warning?: string
}

const G = '/api/plugins/hermes-mobile/google'
const CONSOLE = 'https://console.cloud.google.com/apis/credentials'
/** While the plugin installs Google's libraries: ask every 5 s, for 12 minutes at most (it stops by itself after 10). */
const INSTALL_POLL_MS = 5000
const INSTALL_POLLS = 144

/** The Google row of the Connectors page; nothing when this Hermes has no google-workspace skill or the plugin no route. */
export function GoogleSection({ profile }: { profile: string }) {
  const { data, reload, setData } = useLoader(() => api<GoogleStatus>('GET', `${G}?${qs({ profile })}`, undefined, { profile: false }).catch(() => null), [profile])
  const [open, setOpen] = useState(false)
  if (!data?.available) return null
  const state = data.signed_in || data.unverified ? 'connected' : 'setup'
  return (
    <>
      <Section title="Google" footer="Hermes reads and writes your mail, calendar and files through its Google Workspace skill. Ask it in any chat.">
        <Row
          icon="📧"
          tone="red"
          title="Gmail, Calendar, Drive"
          sub="Also Docs, Sheets and Contacts, with your Google account"
          value={<span className={`conn-state conn-${state}`}>{STATE_WORDS[state]}</span>}
          chevron
          onClick={() => setOpen(true)}
        />
      </Section>
      {open && (
        <GoogleSheet
          profile={profile}
          status={data}
          onStatus={s => setData(s)}
          onClose={() => {
            setOpen(false)
            reload()
          }}
        />
      )}
    </>
  )
}

function GoogleSheet({ profile, status: s, onStatus, onClose }: { profile: string; status: GoogleStatus; onStatus: (s: GoogleStatus) => void; onClose: () => void }) {
  const p = qs({ profile })
  const [client, setClient] = useState('')
  const [pasted, setPasted] = useState('')
  const [started, setStarted] = useState(false)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const needsLibs = /dependencies|librar|google_auth|No module named/i.test(`${error} ${s.detail || ''}`)
  const connected = s.signed_in || !!s.unverified

  // The install runs in the background: follow it until the plugin says it ended.
  useEffect(() => {
    if (!s.installing) return
    let polls = 0
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = () => {
      if (++polls > INSTALL_POLLS) return
      api<GoogleStatus>('GET', `${G}?${p}`, undefined, { profile: false })
        .then(r => {
          if (cancelled) return
          onStatus(r)
          if (r.installing) timer = setTimeout(poll, INSTALL_POLL_MS)
          else if (!r.install_error) {
            setError('')
            toast('Google’s libraries are installed. If a chat can’t use Google yet, restart Hermes (Settings → Reconnect).', 'info', 8000)
          }
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, INSTALL_POLL_MS)
        })
    }
    timer = setTimeout(poll, INSTALL_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.installing])

  const call = async <T,>(what: string, req: () => Promise<T>): Promise<T | null> => {
    setBusy(what)
    setError('')
    haptic()
    try {
      return await req()
    } catch (e) {
      setError(errText(e))
      return null
    } finally {
      setBusy('')
    }
  }
  const saveClient = () =>
    void call('client', () => api<GoogleStatus>('PUT', `${G}/client?${p}`, { text: client.trim() }, { profile: false })).then(r => {
      if (!r) return
      onStatus(r)
      setClient('')
      setReplace(false)
      setStarted(false)
      setPasted('')
      toast('Sign-in app saved')
    })
  const start = () =>
    void call('start', () => api<{ url: string }>('POST', `${G}/start?${p}`, {}, { profile: false })).then(r => {
      if (!r) return
      setStarted(true)
      openExternal(r.url)
    })
  const finish = () =>
    void call('finish', () => api<GoogleStatus>('POST', `${G}/finish?${p}`, { url: pasted.trim() }, { profile: false })).then(r => {
      if (!r) return
      onStatus(r)
      setPasted('')
      setStarted(false)
      toast(r.signed_in ? 'Google connected' : 'Signed in, but the check failed: try again')
    })
  const install = () =>
    void call('install', () => api<GoogleStatus>('POST', `${G}/install?${p}`, {}, { profile: false })).then(r => r && onStatus(r))
  const signOut = () =>
    void confirmDialog({ title: 'Sign out of Google?', message: 'Hermes revokes its access and deletes the saved sign-in. Your sign-in app stays.', confirmLabel: 'Sign out', danger: true }).then(ok => {
      if (!ok) return
      void call('signout', () => api<GoogleStatus>('DELETE', `${G}?${p}`, undefined, { profile: false })).then(r => {
        if (!r) return
        onStatus(r)
        if (r.warning) toast(`Signed out here. ${r.warning}`, 'error', 10000)
        else toast('Signed out of Google')
      })
    })

  const step1 = !s.client_secret || replace
  return (
    <Sheet title="Google" onClose={onClose}>
      <div className="sheet-scroll">
        {connected && (
          <>
            {s.signed_in ? (
              <div className="notice">Connected. Ask Hermes about your mail, calendar or files in any chat.</div>
            ) : (
              <div className="notice notice-warn">{`The sign-in is saved, but Google couldn’t be reached to check it right now (${s.detail}). No need to sign in again unless this stays.`}</div>
            )}
            <Section footer="To use another Google account or sign-in app, sign out first.">
              <Row icon="↩" tone="red" title="Sign out" danger onClick={busy ? undefined : signOut} />
            </Section>
          </>
        )}
        {!connected && s.detail && !needsLibs && <div className="notice notice-warn">{`The saved sign-in doesn’t work any more (${s.detail}). Sign in again.`}</div>}
        {step1 && (
          <Section title="1. Your Google sign-in app">
            <div className="dim small pad">
              Google lets each person connect with their own sign-in app (free). In Google Cloud: make a project; turn on the Gmail, Calendar, Drive, Docs,
              Sheets and People APIs; on the OAuth consent screen choose External and add yourself as a test user; then Credentials → Create credentials
              → OAuth client ID → Desktop app, and download its JSON file. Open that file and paste all of it here.
            </div>
            <Row icon="↗" tone="blue" title="Open Google Cloud" sub="console.cloud.google.com" onClick={() => openExternal(CONSOLE)} />
            <label className="field">
              <span>The client file (JSON)</span>
              <textarea className="mono" rows={4} value={client} onChange={e => setClient(e.target.value)} placeholder='{"installed": {"client_id": …}}' autoCapitalize="none" />
            </label>
            <div className="sheet-actions">
              {replace && (
                <button className="btn" onClick={() => { setReplace(false); setError('') }}>
                  Cancel
                </button>
              )}
              <button className="btn primary" disabled={!!busy || !client.trim()} onClick={saveClient}>
                {busy === 'client' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Section>
        )}
        {s.client_secret && !connected && !replace && (
          <Section title="2. Sign in with Google">
            <Row icon="🔑" tone="gold" title={started ? 'Open the sign-in page again' : 'Sign in'} sub="Opens Google in the browser" onClick={busy ? undefined : start} />
            {started && (
              <>
                <div className="dim small pad">
                  Allow access (Google may warn that the app isn’t verified: it is your own, so continue). The browser then opens a page that doesn’t load,
                  at localhost:1. Copy the whole address from the address bar and paste it here.
                </div>
                <label className="field">
                  <span>The address the browser shows</span>
                  <input className="mono" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="http://localhost:1/?state=…&code=…" autoCapitalize="none" autoComplete="off" />
                </label>
                <div className="sheet-actions">
                  <button className="btn primary" disabled={!!busy || !pasted.trim()} onClick={finish}>
                    {busy === 'finish' ? 'Checking…' : 'Finish'}
                  </button>
                </div>
              </>
            )}
            <Row title="Use another sign-in app" sub="Replace the OAuth client file" onClick={() => setReplace(true)} />
          </Section>
        )}
        {error && <div className="notice notice-error">{error}</div>}
        {s.install_error && <div className="notice notice-error">{s.install_error}</div>}
        {(needsLibs || s.installing || s.install_error) && (
          <Section footer="Hermes needs Google’s Python libraries for this. Installing them can take a few minutes; you can leave this page meanwhile.">
            <Row icon="⬇" tone="blue" title={s.installing ? 'Installing…' : 'Install Google’s libraries'} onClick={busy || s.installing ? undefined : install} />
          </Section>
        )}
      </div>
    </Sheet>
  )
}
