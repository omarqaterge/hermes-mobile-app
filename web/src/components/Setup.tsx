import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { copyText, haptic, isNative, setupFix, setupState, type NativeSetup } from '../bridge'
import { reconnectNow } from '../gateway'
import { getState, toast, useStore } from '../store'
import { ScreenShell } from './Screens'
import { Spinner } from './Spinner'

// Setup check (drawer → Settings, the status sheet, the offline banner, or by itself on a first run that can't
// connect): every piece the app needs, a ✓ or ✗ each, and a button that fixes it or opens the right Android page.

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash'

type State = 'ok' | 'bad' | 'wait' | 'skip'
interface Check {
  id: string
  title: string
  state: State
  /** What is wrong and what the button does, shown while not ok. */
  help?: ReactNode
  fix?: { label: string; run: () => void }
  alt?: { label: string; run: () => void }
}

interface Remote {
  plugin: boolean | null // the dashboard knows the plugin
  enabled: boolean | null // …and this profile has it enabled (hooks: status chip, approvals, canvas)
  enabledList: string[]
  phone: PhoneAccess | null // what of the phone Hermes reaches (null: an older plugin that can't tell)
}

interface PhoneAccess {
  files: boolean
  termux_api: boolean
  shizuku: 'ok' | 'off' | 'denied' | 'blocked' | 'missing'
}

async function remote(): Promise<Remote> {
  const [plugins, config, phone] = await Promise.all([
    api<{ name: string }[]>('GET', '/api/dashboard/plugins', undefined, { profile: false }).catch(() => null),
    api<{ plugins?: { enabled?: string[] } }>('GET', '/api/config').catch(() => null),
    api<PhoneAccess>('GET', '/api/plugins/hermes-mobile/phone-access', undefined, { profile: false }).catch(() => null)
  ])
  const list = config?.plugins?.enabled ?? []
  return {
    plugin: plugins ? plugins.some(p => p.name === 'hermes-mobile') : null,
    enabled: config ? list.includes('hermes-mobile') : null,
    enabledList: list,
    phone: phone && typeof phone.files === 'boolean' ? phone : null
  }
}

const copyInstall = () => {
  void copyText(INSTALL)
  toast('Installer command copied: paste it in Termux')
}

function build(n: NativeSetup | null, conn: string, r: Remote | null, enable: () => void): Check[] {
  const online = conn === 'open'
  const nat = (v: boolean | undefined): State => (n ? (v ? 'ok' : 'bad') : 'skip')
  const checks: Check[] = [
    {
      id: 'termux',
      title: 'Termux is installed',
      state: nat(n?.termux),
      help: 'Hermes runs inside Termux. Install it from F-Droid (the Play Store version is outdated), then follow the README.',
      fix: { label: 'Get Termux', run: () => setupFix('get-termux') }
    },
    {
      id: 'run',
      title: 'Hermes Mobile may start Hermes',
      state: n && !n.termux ? 'skip' : nat(n?.runCommand),
      help: 'Android asks once: “Run commands in Termux environment”. Allow it. If you denied it before, turn it on in the app’s permissions.',
      fix: { label: 'Allow', run: () => setupFix('permissions') },
      alt: { label: 'App settings', run: () => setupFix('app-settings') }
    },
    {
      id: 'hermes',
      title: 'Hermes is running',
      state: online ? 'ok' : conn === 'connecting' ? 'wait' : 'bad',
      help: (
        <>
          The app starts Hermes through Termux. If it stays offline, Termux may not allow it yet: run the installer in Termux
          again (it turns on <code>allow-external-apps</code>), then come back.
          {n?.startError ? <span className="dim"> ({n.startError})</span> : null}
        </>
      ),
      fix: {
        label: 'Start Hermes',
        run: () => {
          setupFix('start')
          reconnectNow()
          toast('Starting Hermes… the first start can take a minute')
        }
      },
      alt: { label: 'Copy installer', run: copyInstall }
    },
    {
      id: 'plugin',
      title: 'The Hermes Mobile plugin is installed',
      state: !online || !r || r.plugin == null ? (online ? 'wait' : 'skip') : r.plugin ? 'ok' : 'bad',
      help: 'Needed for the status chip, approvals from the notification, the canvas and media. Run the installer in Termux, then restart Hermes.',
      fix: { label: 'Copy installer', run: copyInstall },
      alt: { label: 'Open Termux', run: () => setupFix('open-termux') }
    },
    {
      id: 'enabled',
      title: `Plugin enabled for “${getState().profile}”`,
      state: !online || !r?.plugin || r.enabled == null ? 'skip' : r.enabled ? 'ok' : 'bad',
      help: 'This profile doesn’t load the plugin yet. Enabling it applies to new chats.',
      fix: { label: 'Enable', run: enable }
    },
    {
      id: 'notif',
      title: 'Notifications allowed',
      state: nat(n?.notifications),
      help: 'Replies, questions and approvals arrive as notifications, and the status chip lives there.',
      fix: { label: 'Allow', run: () => setupFix('permissions') },
      alt: { label: 'Settings', run: () => setupFix('notifications') }
    },
    {
      id: 'bat-app',
      title: 'Hermes Mobile may run in the background',
      state: nat(n?.batteryApp),
      help: 'Without this Android stops the app’s notification service after a while.',
      fix: { label: 'Allow', run: () => setupFix('battery-app') }
    },
    {
      id: 'bat-termux',
      title: 'Termux may run in the background',
      state: n && !n.termux ? 'skip' : nat(n?.batteryTermux),
      help: 'Hermes lives in Termux. Open Termux’s app info → Battery → Unrestricted (on Xiaomi also turn on Autostart).',
      fix: { label: 'Open Termux settings', run: () => setupFix('battery-termux') }
    },
    ...phoneChecks(n, online, r)
  ]
  return checks.filter(c => c.state !== 'skip')
}

/** Hermes's own access to the phone: files, the termux-* commands, and Shizuku's shell (screen, taps, apps, logs).
 *  None of it needs root. The Android half says whether an app is installed; the plugin says whether Hermes can use it. */
function phoneChecks(n: NativeSetup | null, online: boolean, r: Remote | null): Check[] {
  const p = online ? r?.phone ?? null : null
  const remoteState = (v: boolean | undefined): State => (p ? (v ? 'ok' : 'bad') : 'skip')
  const apiMissing = n?.termuxApi === false
  const shizukuMissing = n?.shizuku === false
  const sh = p?.shizuku
  return [
    {
      id: 'files',
      title: 'Hermes can use your files',
      state: remoteState(p?.files),
      help: 'Termux needs Android’s files permission, and Hermes only sees it after a restart. Tap Allow, then Restart Hermes.',
      fix: { label: 'Allow', run: () => setupFix('storage') },
      alt: {
        label: 'Restart Hermes',
        run: () => {
          setupFix('restart-hermes')
          toast('Restarting Hermes… back in about half a minute')
        }
      }
    },
    {
      id: 'termux-api',
      title: 'Hermes can use the phone’s features (Termux:API)',
      state: apiMissing ? 'bad' : remoteState(p?.termux_api),
      help: apiMissing
        ? 'Battery, location, clipboard, notifications and more go through the Termux:API app. Install it from F-Droid, like Termux.'
        : 'Termux:API is installed but Hermes can’t reach it yet. Run the installer in Termux again: it adds the termux-* commands.',
      fix: apiMissing ? { label: 'Get Termux:API', run: () => setupFix('get-termux-api') } : { label: 'Copy installer', run: copyInstall },
      alt: apiMissing ? undefined : { label: 'Open Termux', run: () => setupFix('open-termux') }
    },
    {
      id: 'shizuku',
      title: 'Hermes can see and use the screen (Shizuku)',
      state: shizukuMissing ? 'bad' : !p ? 'skip' : sh === 'ok' ? 'ok' : 'bad',
      help: shizukuMissing ? (
        'Shizuku gives Hermes the screen, taps, apps and logs, without root. Install it, then come back.'
      ) : sh === 'denied' ? (
        'Shizuku hasn’t allowed Termux yet. Open Shizuku → Application management and turn on Termux.'
      ) : sh === 'blocked' ? (
        'Shizuku doesn’t answer Termux. Set Battery to Unrestricted for both Shizuku and Termux (app info → Battery).'
      ) : sh === 'missing' ? (
        'Shizuku’s shell isn’t set up for Hermes yet. Run the installer in Termux again.'
      ) : (
        <>
          Shizuku isn’t running: it stops when the phone restarts. Open it and start it. No root: <i>Start via Wireless
          debugging</i> (pair once; on Android 13+ it then starts by itself after a restart, on Wi-Fi). Rooted: <i>Start</i>.
        </>
      ),
      fix: shizukuMissing
        ? { label: 'Get Shizuku', run: () => setupFix('get-shizuku') }
        : sh === 'missing'
          ? { label: 'Copy installer', run: copyInstall }
          : sh === 'blocked'
            ? { label: 'Open Termux settings', run: () => setupFix('battery-termux') }
            : { label: 'Open Shizuku', run: () => setupFix('open-shizuku') },
      alt: sh === 'blocked' ? { label: 'Open Shizuku', run: () => setupFix('open-shizuku') } : undefined
    }
  ]
}

export function SetupScreen() {
  const conn = useStore(s => s.conn)
  const profile = useStore(s => s.profile)
  const [n, setN] = useState<NativeSetup | null>(() => setupState())
  const [r, setR] = useState<Remote | null>(null)
  const refresh = useCallback(() => {
    setN(setupState())
    if (getState().conn === 'open') void remote().then(setR)
  }, [])
  // Coming back from an Android settings page or Termux: check again.
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', on)
    const t = setInterval(refresh, 4000)
    return () => {
      document.removeEventListener('visibilitychange', on)
      clearInterval(t)
    }
  }, [refresh])
  useEffect(refresh, [conn, profile, refresh])

  const enable = () => {
    haptic()
    const list = [...(r?.enabledList ?? []).filter(x => x !== 'hermes-mobile'), 'hermes-mobile']
    api('PUT', '/api/config', { config: { plugins: { enabled: list } } })
      .then(() => {
        toast('Enabled. New chats use it.')
        refresh()
      })
      .catch(() => toast('Couldn’t enable it. In Termux: proot-distro login debian -- hermes plugins enable hermes-mobile', 'error'))
  }

  const checks = build(n, conn, r, enable)
  const bad = checks.filter(c => c.state === 'bad').length
  const waiting = checks.some(c => c.state === 'wait')
  return (
    <ScreenShell title="Setup check">
      <div className={`setup-hero ${bad ? 'bad' : waiting ? 'wait' : 'ok'}`}>
        <span className="setup-hero-mark" aria-hidden="true">{bad ? '!' : waiting ? '…' : '✓'}</span>
        <div>
          <div className="setup-hero-title">{bad ? `${bad} thing${bad > 1 ? 's' : ''} to fix` : waiting ? 'Checking…' : 'All set'}</div>
          <div className="dim small">
            {bad ? 'Tap a button below; this page checks again by itself.' : waiting ? 'Waiting for Hermes to answer.' : 'Everything Hermes Mobile needs is in place.'}
          </div>
        </div>
      </div>
      {!isNative && <div className="dim small setup-note">In a browser only the Hermes checks run; the Android ones show in the app.</div>}
      <ul className="setup-list">
        {checks.map(c => (
          <li key={c.id} className={`setup-item ${c.state}`}>
            <span className={`setup-mark ${c.state}`} aria-label={c.state === 'ok' ? 'Done' : c.state === 'bad' ? 'Needs fixing' : 'Checking'}>
              {c.state === 'ok' ? '✓' : c.state === 'bad' ? '✕' : <Spinner small />}
            </span>
            <div className="setup-body">
              <div className="setup-title">{c.title}</div>
              {c.state === 'bad' && (
                <>
                  {c.help && <div className="setup-help">{c.help}</div>}
                  <div className="setup-actions">
                    {c.fix && (
                      <button className="btn primary" onClick={() => { haptic(); c.fix!.run() }}>
                        {c.fix.label}
                      </button>
                    )}
                    {c.alt && (
                      <button className="btn" onClick={() => { haptic(); c.alt!.run() }}>
                        {c.alt.label}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ScreenShell>
  )
}

const SEEN = 'hm.connectedOnce'

/** First run that can't reach Hermes: open the setup check by itself once (per launch), after a grace period. */
export function watchFirstRun(conn: string, open: () => void): () => void {
  let seen = false
  try {
    seen = localStorage.getItem(SEEN) === '1'
    if (conn === 'open') localStorage.setItem(SEEN, '1')
  } catch {
    /* private mode */
  }
  if (seen || conn === 'open' || firstRunShown) return () => {}
  const t = setTimeout(() => {
    if (getState().conn !== 'open' && !getState().screen) {
      firstRunShown = true
      open()
    }
  }, 15000)
  return () => clearTimeout(t)
}
let firstRunShown = false
