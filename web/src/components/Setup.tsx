import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../api'
import {
  copySetupCommand, copyText, haptic, installHelperApp, openExternal, isNative, onSetupEvent, probeTermux, setupFix, setupProgress, setupState,
  type HelperApp, type InstallState, type NativeSetup
} from '../bridge'
import { reconnectNow, rpc } from '../gateway'
import { closeScreen, getState, setState, toast, useStore } from '../store'
import {
  nextStep, probeState, progressView, recommendedGaps, setupSteps, shouldOpenFlow, type FlowStep, type PhoneAccess, type PreHermes,
  type ProbeRaw, type Progress, type Remote, type StepId, type StepState
} from '../setupflow'
import { WelcomeBody, markWelcomeDone, welcomeDone } from './Connect'
import { ScreenShell } from './Screens'
import { Spinner } from './Spinner'
import { formatDuration } from '../text'

// Setup check (drawer → Settings, the status sheet, the offline banner) and the first-run SetupFlow. Both draw the same
// rows from setupSteps() (setupflow.ts): the check lists every row with a ✓ or ✗ and a button that fixes it or opens
// the right Android page; the flow shows the first missing required row, then the recommended ones once.

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash'

interface Check {
  id: StepId
  title: string
  state: StepState
  /** What is wrong and what the button does, shown while not ok. */
  help?: ReactNode
  fix?: { label: string; run: () => void }
  alt?: { label: string; run: () => void }
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

/** Can Hermes serve a model? setup.runtime_check runs the same resolver as a new chat. setup.status is not enough: scoped
 *  to a profile it answers with a loose probe that says yes on a fresh install with no provider (seen on the pinned
 *  Hermes). An older Hermes without runtime_check falls back to setup.status, where null counts as yes: never block. */
async function modelConnected(): Promise<boolean | null> {
  const c = await rpc<{ ok?: boolean }>('setup.runtime_check').catch(() => null)
  if (typeof c?.ok === 'boolean') return c.ok
  const r = await rpc<{ provider_configured?: boolean | null }>('setup.status').catch(() => null)
  return r ? r.provider_configured !== false : null
}

const copyInstall = () => {
  void copyText(INSTALL)
  toast('Installer command copied: paste it in Termux')
}

// ── App-first setup: the helper apps, installed one after another by the shell ──

export const HELPERS: { id: HelperApp; name: string; what: string; has: (n: NativeSetup) => boolean; url: string }[] = [
  { id: 'termux', name: 'Termux', what: 'Linux on the phone: Hermes runs inside it', has: n => n.termux, url: 'https://f-droid.org/packages/com.termux/' },
  { id: 'termux-api', name: 'Termux:API', what: 'Lets Hermes use the phone: battery, location, notifications…', has: n => Boolean(n.termuxApi), url: 'https://f-droid.org/packages/com.termux.api/' },
  { id: 'termux-boot', name: 'Termux:Boot', what: 'Starts Hermes again after the phone restarts', has: n => Boolean(n.termuxBoot), url: 'https://f-droid.org/packages/com.termux.boot/' },
  { id: 'shizuku', name: 'Shizuku', what: 'Lets Hermes see and use the screen, without root', has: n => Boolean(n.shizuku), url: 'https://github.com/RikkaApps/Shizuku/releases' }
]

interface AppStatus {
  state: InstallState | 'idle'
  pct: number
  msg: string
}
const IDLE: AppStatus = { state: 'idle', pct: 0, msg: '' }
let appStatus: Record<HelperApp, AppStatus> = { termux: IDLE, 'termux-api': IDLE, 'termux-boot': IDLE, shizuku: IDLE }
let installQueue: HelperApp[] = []
let waitingPermission = false
const appSubs = new Set<() => void>()
const setAppStatus = (id: HelperApp, st: AppStatus) => {
  appStatus = { ...appStatus, [id]: st }
  appSubs.forEach(f => f())
}
const busy = () => Object.values(appStatus).some(a => a.state === 'downloading' || a.state === 'installing')
function installNext() {
  if (busy() || waitingPermission) return
  const n = setupState()
  while (installQueue.length && n && HELPERS.find(h => h.id === installQueue[0])!.has(n)) installQueue.shift()
  const next = installQueue.shift()
  if (!next) return
  setAppStatus(next, { state: 'downloading', pct: 0, msg: '' })
  if (!installHelperApp(next)) setAppStatus(next, { state: 'error', pct: 0, msg: 'This app build can’t install apps.' })
}
/** Install these apps (missing ones only, in the fixed order: Termux first). One system "Install" dialog each. */
export function installApps(ids: HelperApp[]) {
  for (const h of HELPERS) if (ids.includes(h.id) && !installQueue.includes(h.id)) installQueue.push(h.id)
  installNext()
}
onSetupEvent(e => {
  if (e.kind !== 'install') return
  setAppStatus(e.which, { state: e.state, pct: e.pct, msg: e.msg })
  if (e.state === 'permission') {
    // Android's "Install unknown apps" switch is open: carry on when the user comes back with it on.
    waitingPermission = true
    installQueue.unshift(e.which)
    setAppStatus(e.which, IDLE)
  } else if (e.state === 'done') installNext()
  else if (e.state === 'error') installQueue = []
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !waitingPermission) return
  waitingPermission = false
  if (setupState()?.canInstall) installNext()
  else installQueue = []
})
const useAppStatus = () => useSyncExternalStore(f => (appSubs.add(f), () => appSubs.delete(f)), () => appStatus)

const SHIZUKU_SKIP = 'hm.shizukuStepDone'
const shizukuSkipped = () => {
  try {
    return localStorage.getItem(SHIZUKU_SKIP) === '1'
  } catch {
    return false
  }
}

const copyBootstrap = () => {
  if (copySetupCommand()) toast('Copied. In Termux: long-press, Paste, then Enter')
  else toast('This app build can’t make the installer command. Use the command from the README.', 'error')
}

interface Ctx {
  n: NativeSetup | null
  conn: string
  r: Remote | null
  enable: () => void
}

/** The words and buttons of one row. */
function describe(id: StepId, { n, conn, r, enable }: Ctx): Pick<Check, 'title' | 'help' | 'fix' | 'alt'> {
  const online = conn === 'open'
  const p = online ? r?.phone ?? null : null
  const sh = p?.shizuku
  switch (id) {
    case 'apps': {
      const missing = n ? HELPERS.filter(h => !h.has(n)) : []
      return {
        title: 'Termux, Termux:API, Termux:Boot and Shizuku are installed',
        help: `Hermes needs ${missing.length ? missing.map(h => h.name).join(', ') : 'these apps'}. Hermes Mobile downloads and installs them for you: tap Install on each of Android’s prompts.`,
        fix: missing.length ? { label: 'Install all', run: () => installApps(missing.map(h => h.id)) } : undefined
      }
    }
    case 'shizuku-start':
      return {
        title: 'Start Shizuku',
        help: 'Recommended before the installer: it stops Android from killing the install (“signal 9”) and lets Hermes see and use the screen. Needs Developer options and Wi-Fi.',
        fix: { label: 'Open Shizuku', run: () => setupFix('open-shizuku') }
      }
    case 'installer':
      return {
        title: 'Hermes is installed in Termux',
        help: 'Copy the command, open Termux, long-press, Paste, then Enter. It installs Debian and Hermes (15-40 minutes); keep Termux open.',
        fix: { label: 'Copy the command', run: copyBootstrap },
        alt: { label: 'Open Termux', run: () => setupFix('open-termux') }
      }
    case 'termux-boot':
      return {
        title: 'Termux:Boot was opened once',
        help: 'Android only starts Termux:Boot after a restart (and with it Hermes) once it has been opened. Open it once, then come back.',
        fix: { label: 'Open Termux:Boot', run: () => setupFix('open-termux-boot') }
      }
    case 'termux':
      return {
        title: 'Termux is installed',
        help: 'Hermes runs inside Termux. Install it from F-Droid (the Play Store version is outdated), then follow the README.',
        fix: { label: 'Get Termux', run: () => setupFix('get-termux') }
      }
    case 'run':
      return {
        title: 'Hermes Mobile may start Hermes',
        help: 'Android asks once: “Run commands in Termux environment”. Allow it. If you denied it before, turn it on in the app’s permissions.',
        fix: { label: 'Allow', run: () => setupFix('permissions') },
        alt: { label: 'App settings', run: () => setupFix('app-settings') }
      }
    case 'hermes':
      return {
        title: 'Hermes is running',
        help: (
          <>
            The app starts Hermes through Termux. If it stays offline, Termux may not allow it yet: run the installer in Termux again
            (it turns on <code>allow-external-apps</code>), then come back.
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
      }
    case 'plugin':
      return {
        title: 'The Hermes Mobile plugin is installed',
        help: 'Needed for the status chip, approvals from the notification, the canvas and media. Run the installer in Termux, then restart Hermes.',
        fix: { label: 'Copy installer', run: copyInstall },
        alt: { label: 'Open Termux', run: () => setupFix('open-termux') }
      }
    case 'enabled':
      return {
        title: `Plugin enabled for “${getState().profile}”`,
        help: 'This profile doesn’t load the plugin yet. Enabling it applies to new chats.',
        fix: { label: 'Enable', run: enable }
      }
    case 'model':
      return { title: 'A model is connected', help: 'Hermes thinks with a model in the cloud. Sign in with a subscription or paste an API key.' }
    case 'notif':
      return {
        title: 'Notifications allowed',
        help: 'Replies, questions and approvals arrive as notifications, and the status chip lives there.',
        fix: { label: 'Allow', run: () => setupFix('permissions') },
        alt: { label: 'Settings', run: () => setupFix('notifications') }
      }
    case 'bat-app':
      return {
        title: 'Hermes Mobile may run in the background',
        help: 'Without this Android stops the app’s notification service after a while.',
        fix: { label: 'Allow', run: () => setupFix('battery-app') }
      }
    case 'bat-termux':
      return {
        title: 'Termux may run in the background',
        help: 'Hermes lives in Termux. Open Termux’s app info → Battery → Unrestricted (on Xiaomi also turn on Autostart).',
        fix: { label: 'Open Termux settings', run: () => setupFix('battery-termux') }
      }
    case 'files':
      return {
        title: 'Hermes can use your files',
        help: 'Termux needs Android’s files permission, and Hermes only sees it after a restart. Tap Allow, then Restart Hermes.',
        fix: { label: 'Allow', run: () => setupFix('storage') },
        alt: {
          label: 'Restart Hermes',
          run: () => {
            setupFix('restart-hermes')
            toast('Restarting Hermes… back in about half a minute')
          }
        }
      }
    case 'termux-api': {
      const apiMissing = n?.termuxApi === false
      return {
        title: 'Hermes can use the phone’s features (Termux:API)',
        help: apiMissing
          ? 'Battery, location, clipboard, notifications and more go through the Termux:API app. Install it from F-Droid, like Termux.'
          : 'Termux:API is installed but Hermes can’t reach it yet. Run the installer in Termux again: it adds the termux-* commands.',
        fix: apiMissing ? { label: 'Get Termux:API', run: () => setupFix('get-termux-api') } : { label: 'Copy installer', run: copyInstall },
        alt: apiMissing ? undefined : { label: 'Open Termux', run: () => setupFix('open-termux') }
      }
    }
    case 'shizuku': {
      const missing = n?.shizuku === false
      return {
        title: 'Hermes can see and use the screen (Shizuku)',
        help: missing ? (
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
        fix: missing
          ? { label: 'Get Shizuku', run: () => setupFix('get-shizuku') }
          : sh === 'missing'
            ? { label: 'Copy installer', run: copyInstall }
            : sh === 'blocked'
              ? { label: 'Open Termux settings', run: () => setupFix('battery-termux') }
              : { label: 'Open Shizuku', run: () => setupFix('open-shizuku') },
        alt: sh === 'blocked' ? { label: 'Open Shizuku', run: () => setupFix('open-shizuku') } : undefined
      }
    }
    case 'autostart':
      return {
        title: 'Turn on Autostart for Termux and Hermes Mobile',
        help: 'Xiaomi phones stop apps that are not allowed to autostart. Android can’t tell us whether it is on, so this is only a reminder: open each app’s settings → Autostart.',
        fix: { label: 'Hermes Mobile settings', run: () => setupFix('app-settings') },
        alt: { label: 'Termux settings', run: () => setupFix('battery-termux') }
      }
  }
}

const buildChecks = (steps: FlowStep[], ctx: Ctx, withModel: boolean): Check[] =>
  steps.filter(s => s.state !== 'skip' && (withModel || s.id !== 'model')).map(s => ({ id: s.id, state: s.state, ...describe(s.id, ctx) }))

/** Everything the app knows about its setup. Re-checks when the connection or profile changes, when the app comes back
 *  to the foreground (from an Android settings page or Termux) and after a fix; `poll` adds the Setup check screen's
 *  own 4 s refresh while it is open. `loading` until the answers it needs have arrived. */
let lastProbe = 0

export function useSetupState(opts: { poll?: boolean; model?: boolean } = {}) {
  const conn = useStore(s => s.conn)
  const profile = useStore(s => s.profile)
  const [n, setN] = useState<NativeSetup | null>(() => setupState())
  const [r, setR] = useState<Remote | null>(null)
  const [hasModel, setHasModel] = useState<boolean | null>(null)
  const [probeRaw, setProbeRaw] = useState<ProbeRaw | null>(null)
  const [progress, setProgress] = useState<Progress | null>(() => setupProgress())
  const [shSkip, setShSkip] = useState(shizukuSkipped)
  const wantModel = Boolean(opts.model)
  /** probe: also ask Termux what is installed (one RUN_COMMAND, only while Hermes is offline; never on the poll). */
  const refresh = useCallback((probe: unknown = true) => {
    const nat = setupState()
    setN(nat)
    setProgress(setupProgress())
    setShSkip(shizukuSkipped())
    if (getState().conn !== 'open') {
      // at most one probe per 2 s (the return to the app fires both visibilitychange and hermesSetupChanged)
      if (probe !== false && nat?.probe && nat.termux && Date.now() - lastProbe > 2000) {
        lastProbe = Date.now()
        probeTermux()
      }
      return
    }
    void remote().then(setR)
    if (wantModel) void modelConnected().then(v => v != null && setHasModel(v))
  }, [wantModel])
  useEffect(
    () =>
      onSetupEvent(e => {
        if (e.kind === 'probe') {
          try {
            setProbeRaw(JSON.parse(e.json) as ProbeRaw)
          } catch {
            /* ignore */
          }
        } else if (e.kind === 'line') {
          setProgress(setupProgress())
          if (e.line === 'DONE') {
            // install.sh has started Hermes: connect now instead of waiting for the next retry
            reconnectNow()
            refresh(false)
          }
        } else if (e.kind === 'changed') refresh(true)
        else if (e.state === 'done') refresh(false)
      }),
    [refresh]
  )
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', on)
    const t = opts.poll ? setInterval(() => refresh(false), 4000) : 0
    return () => {
      document.removeEventListener('visibilitychange', on)
      if (t) clearInterval(t)
    }
  }, [refresh, opts.poll])
  // The connection retrying (connecting ↔ closed) must not probe: each probe is a Termux command, and before the
  // installer ran Termux answers every one with an error notification. Probe on open, on return and after a fix only.
  useEffect(() => refresh(false), [conn, profile, refresh])
  useEffect(() => refresh(true), [refresh])
  const installing = Boolean(progress?.active && !progress.done && !progress.fail)
  const pre: PreHermes = { probe: n?.probe ? probeState(probeRaw, installing) : null, progress, shizukuSkipped: shSkip }
  const steps = setupSteps(n, conn, r, wantModel ? hasModel : true, pre)
  // A step before Hermes exists is known without Hermes: never "Checking…" while the connection retries.
  const pending = nextStep(steps)
  const preHermes = pending != null && ['apps', 'shizuku-start', 'run', 'installer'].includes(pending.id) && (pending.state === 'bad' || installing)
  const loading = !preHermes && (conn === 'connecting' || (conn === 'open' && (r == null || (wantModel && hasModel == null))))
  const skipShizuku = () => {
    try {
      localStorage.setItem(SHIZUKU_SKIP, '1')
    } catch {
      /* private mode */
    }
    setShSkip(true)
  }
  return { steps, next: pending, loading, refresh, n, r, conn, progress, skipShizuku }
}

function useEnable(r: Remote | null, refresh: () => void) {
  return () => {
    haptic()
    const list = [...(r?.enabledList ?? []).filter(x => x !== 'hermes-mobile'), 'hermes-mobile']
    api('PUT', '/api/config', { config: { plugins: { enabled: list } } })
      .then(() => {
        toast('Enabled. New chats use it.')
        refresh()
      })
      .catch(() => toast('Couldn’t enable it. In Termux: ~/bin/hermes-debian bash -lc \'hermes plugins enable hermes-mobile\'', 'error'))
  }
}

function CheckActions({ c }: { c: Check }) {
  return (
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
  )
}

const MARK: Record<StepState, string> = { ok: '✓', bad: '✕', info: 'i', wait: '', skip: '' }
const MARK_LABEL: Record<StepState, string> = { ok: 'Done', bad: 'Needs fixing', info: 'Tip', wait: 'Checking', skip: '' }

export function SetupScreen() {
  const { steps, refresh, n, r, conn } = useSetupState({ poll: true })
  useAppStatus() // re-render on install progress
  const checks = buildChecks(steps, { n, conn, r, enable: useEnable(r, refresh) }, false)
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
            <span className={`setup-mark ${c.state}`} aria-label={MARK_LABEL[c.state]}>
              {c.state === 'wait' ? <Spinner small /> : MARK[c.state]}
            </span>
            <div className="setup-body">
              <div className="setup-title">{c.title}</div>
              {(c.state === 'bad' || c.state === 'info') && (
                <>
                  {c.help && <div className="setup-help">{c.help}</div>}
                  <CheckActions c={c} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ScreenShell>
  )
}

// ── The first-run flow ───────────────────────────────────────

const FLOW_DONE = 'hm.setupFlowDone'
const flowDone = () => {
  try {
    return localStorage.getItem(FLOW_DONE) === '1'
  } catch {
    return false
  }
}
const markFlowDone = () => {
  try {
    localStorage.setItem(FLOW_DONE, '1')
  } catch {
    /* private mode */
  }
}
/** "Not now" on a required step: don't open it again until the app is restarted. */
let flowDismissed = false

/** Resume at the first missing step: shows that step with its fix, moves on by itself when it turns ✓, then lists the
 *  recommended items that are still missing once, then "All set". Opens from checkSetupFlow() / watchFirstRun(). */
export function SetupFlow() {
  const { steps, loading, refresh, n, r, conn, progress, skipShizuku } = useSetupState({ model: true })
  const enable = useEnable(r, refresh)
  // The model step stays on screen until the user finishes it (connecting a provider turns it ✓ before they pick a model).
  const [modelStarted, setModelStarted] = useState(false)
  const [modelDone, setModelDone] = useState(false)
  // The required steps that were missing while the flow was open (the "Step 2 of 4" count); a step that turns bad later joins.
  const todo = useRef<StepId[]>([])
  if (!loading) for (const s of steps) if (s.required && s.state === 'bad' && !todo.current.includes(s.id)) todo.current.push(s.id)
  const cur = modelStarted && !modelDone ? (steps.find(s => s.id === 'model') ?? null) : nextStep(steps.filter(s => !(s.id === 'model' && modelDone)))
  if (cur?.id === 'model' && !modelStarted) setModelStarted(true)
  const stateOf = (id: StepId) => steps.find(s => s.id === id)?.state
  const total = todo.current.length
  // skip = the step went away (Start Shizuku skipped, or the installer made it unnecessary): counts as finished, no ✓.
  const finished = todo.current.filter(id => ((stateOf(id) === 'ok' || stateOf(id) === 'skip') && !(id === 'model' && !modelDone)) || (id === 'model' && modelDone)).length
  const ctx: Ctx = { n, conn, r, enable }
  const checkOf = (s: FlowStep): Check => ({ id: s.id, state: s.state, ...describe(s.id, ctx) })

  const finish = () => {
    markWelcomeDone()
    markFlowDone()
    closeScreen()
  }
  const back = () => {
    if (cur) {
      flowDismissed = true
      if (cur.id === 'model') markWelcomeDone() // as the old welcome's back arrow did: never ask again
      return closeScreen()
    }
    finish()
  }

  const gaps = [...recommendedGaps(steps), ...steps.filter(s => s.id === 'model' && modelDone && s.state === 'bad')]
  const tips = steps.filter(s => s.state === 'info')
  const doneRows = todo.current.filter(id => stateOf(id) === 'ok' && (id !== 'model' || modelDone))

  let body: ReactNode
  if (loading) {
    body = (
      <div className="flow-wait dim">
        <Spinner small /> Checking what is already set up…
      </div>
    )
  } else if (cur?.id === 'model') {
    body = (
      <WelcomeBody
        onChange={refresh}
        onFinish={() => {
          refresh()
          setModelDone(true)
        }}
      />
    )
  } else if (cur?.id === 'apps' && n) {
    body = <AppsStep n={n} />
  } else if (cur?.id === 'shizuku-start' && n) {
    body = <ShizukuStep n={n} onSkip={skipShizuku} />
  } else if (cur?.id === 'installer') {
    body = <InstallerStep progress={progress} onCopied={() => refresh(false)} />
  } else if (cur) {
    const c = checkOf(cur)
    body = (
      <div className="flow-card">
        <div className="flow-card-title">{c.title}</div>
        {cur.state === 'wait' ? (
          <div className="dim flow-card-wait">
            <Spinner small /> Checking…
          </div>
        ) : (
          <>
            {c.help && <div className="setup-help">{c.help}</div>}
            <CheckActions c={c} />
            <div className="dim small flow-card-note">This page moves on by itself once it is fixed.</div>
          </>
        )}
      </div>
    )
  } else {
    body = (
      <>
        <div className={`setup-hero ${gaps.length ? 'wait' : 'ok'}`}>
          <span className="setup-hero-mark" aria-hidden="true">{gaps.length ? '…' : '✓'}</span>
          <div>
            <div className="setup-hero-title">{gaps.length ? 'Almost done' : 'All set'}</div>
            <div className="dim small">
              {gaps.length ? 'These are recommended. Hermes works without them, but they keep it running in the background.' : 'Everything Hermes Mobile needs is in place.'}
            </div>
          </div>
        </div>
        {gaps.length + tips.length > 0 && (
          <ul className="setup-list">
            {[...gaps, ...tips].map(s => {
              const c = checkOf(s)
              return (
                <li key={s.id} className={`setup-item ${s.state}`}>
                  <span className={`setup-mark ${s.state}`} aria-label={MARK_LABEL[s.state]}>{MARK[s.state]}</span>
                  <div className="setup-body">
                    <div className="setup-title">{c.title}</div>
                    {c.help && <div className="setup-help">{c.help}</div>}
                    {s.id === 'model' ? (
                      <div className="setup-actions">
                        <button className="btn primary" onClick={() => { haptic(); setModelDone(false) }}>
                          Connect a model
                        </button>
                      </div>
                    ) : (
                      <CheckActions c={c} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="welcome-actions">
          <button className="btn primary block" onClick={() => { haptic(); finish() }}>
            Done
          </button>
        </div>
      </>
    )
  }

  return (
    <ScreenShell title="Set up Hermes" onBack={back}>
      {!loading && cur && total > 0 && (
        <div className="flow-progress" aria-label={`Step ${Math.min(finished + 1, total)} of ${total}`}>
          <span className="flow-progress-label">
            Step {Math.min(finished + 1, total)} of {total}
          </span>
          <span className="flow-progress-bar">
            <span style={{ width: `${(finished / total) * 100}%` }} />
          </span>
        </div>
      )}
      {!loading && doneRows.length > 0 && (
        <ul className="flow-done">
          {doneRows.map(id => (
            <li key={id}>
              <span className="flow-done-mark" aria-hidden="true">✓</span> {describe(id, ctx).title}
            </li>
          ))}
        </ul>
      )}
      {body}
    </ScreenShell>
  )
}

const STATUS_TEXT = (a: AppStatus) =>
  a.state === 'downloading' ? `Downloading${a.pct ? ` ${a.pct} %` : '…'}`
    : a.state === 'installing' ? 'Tap Install on Android’s prompt'
      : a.state === 'error' ? a.msg || 'Install failed'
        : ''

/** Step 1: the four helper apps, each ✓ or Install, plus Install all. */
function AppsStep({ n }: { n: NativeSetup }) {
  const status = useAppStatus()
  const missing = HELPERS.filter(h => !h.has(n))
  const otherTermux = n.termuxSigner === 'other'
  const oldTermux = Boolean(n.termux && n.termuxVersion && /^0\.(\d+)/.test(n.termuxVersion) && Number(n.termuxVersion.split('.')[1]) < 118)
  const canFix = (h: (typeof HELPERS)[number]) => !(otherTermux && (h.id === 'termux-api' || h.id === 'termux-boot'))
  const installable = missing.filter(canFix)
  const working = HELPERS.some(h => status[h.id].state === 'downloading' || status[h.id].state === 'installing')
  return (
    <div className="flow-card">
      <div className="flow-card-title">Get the helper apps</div>
      <div className="setup-help">
        Hermes runs inside Termux and uses these apps to reach your phone. Hermes Mobile downloads them (Termux from F-Droid,
        Shizuku from GitHub) and Android asks you to tap <b>Install</b> for each one.
        {n.canInstall === false && <> First Android asks you to allow Hermes Mobile to install apps: turn the switch on, then come back.</>}
      </div>
      <ul className="setup-list app-list">
        {HELPERS.map(h => {
          const has = h.has(n)
          const a = status[h.id]
          return (
            <li key={h.id} className={`setup-item ${has ? 'ok' : 'bad'}`}>
              <span className={`setup-mark ${has ? 'ok' : 'bad'}`} aria-label={has ? 'Done' : 'Missing'}>
                {has ? '✓' : a.state === 'downloading' || a.state === 'installing' ? <Spinner small /> : '✕'}
              </span>
              <div className="setup-body">
                <div className="setup-title">{h.name}</div>
                <div className="dim small">{has ? h.what : STATUS_TEXT(a) || h.what}</div>
                {!has && (
                  <button className="app-own-link" onClick={() => { haptic(); openExternal(h.url) }}>
                    Or install it yourself: {h.id === 'shizuku' ? 'GitHub page' : 'F-Droid page'}
                  </button>
                )}
              </div>
              {!has && canFix(h) && a.state !== 'downloading' && a.state !== 'installing' && (
                <button className="btn" onClick={() => { haptic(); installApps([h.id]) }}>
                  {a.state === 'error' ? 'Retry' : 'Install'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="setup-help">
        Prefer to install them yourself? Use the page link under each app, then come back: this list ticks an app by itself once it is
        installed. Termux, Termux:API and Termux:Boot must all come from the same source (F-Droid): apps from different sources are
        signed differently and won’t work together.
      </div>
      {otherTermux && (
        <div className="setup-help">
          Your Termux doesn’t come from F-Droid, so F-Droid’s Termux:API and Termux:Boot can’t be added to it. Install them from the same
          place you got Termux (for example its GitHub releases), or uninstall Termux and install all three here.
        </div>
      )}
      {oldTermux && <div className="setup-help">Your Termux is older than 0.118 and can’t run the installer: update it first.</div>}
      {installable.length > 0 && (
        <div className="setup-actions">
          <button className="btn primary" disabled={working} onClick={() => { haptic(); installApps(installable.map(h => h.id)) }}>
            {installable.length === HELPERS.length ? 'Install all' : `Install ${installable.length === 1 ? installable[0].name : 'the rest'}`}
          </button>
          {n.canInstall === false && (
            <button className="btn" onClick={() => { haptic(); setupFix('install-permission') }}>
              Allow installing apps
            </button>
          )}
        </div>
      )}
      <div className="dim small flow-card-note">This page moves on by itself once all four are installed.</div>
    </div>
  )
}

/** Step 2 (can be skipped): start Shizuku before the installer, all on the phone. */
function ShizukuStep({ n, onSkip }: { n: NativeSetup; onSkip: () => void }) {
  const sub = (ok: boolean | undefined, text: ReactNode) => (
    <li className={`setup-item ${ok ? 'ok' : 'bad'}`}>
      <span className={`setup-mark ${ok ? 'ok' : 'bad'}`} aria-label={ok ? 'Done' : 'Not yet'}>{ok ? '✓' : '·'}</span>
      <div className="setup-body">{text}</div>
    </li>
  )
  return (
    <div className="flow-card">
      <div className="flow-card-title">Start Shizuku</div>
      <div className="setup-help">
        Recommended before the installer: Shizuku lets the installer stop Android from killing it (“signal 9”), and gives Hermes the
        screen, taps and apps without root. You can skip it and start Shizuku later.
      </div>
      <ul className="setup-list">
        {sub(n.devOptions, <><div className="setup-title">Turn on Developer options</div><div className="dim small">About phone → tap <i>Build number</i> 7 times (on some phones it is under <i>Software information</i>, or called <i>OS version</i>).</div></>)}
        {sub(n.wirelessDebugging, <><div className="setup-title">Turn on Wireless debugging</div><div className="dim small">Connect to Wi-Fi, then Developer options → <i>Wireless debugging</i> → Allow. Why: Shizuku uses Android’s own wireless debugging to start itself on the phone, with no computer and no root. That gives Hermes the screen, taps and apps, and lets the installer stop Android killing it. It only works locally on your phone (over your own Wi-Fi); nothing goes to the internet. Once Shizuku is running you can usually turn Wireless debugging off again: Shizuku keeps running until the phone restarts.</div></>)}
        {sub(false, <><div className="setup-title">Pair and start Shizuku</div><div className="dim small">In Shizuku: <i>Pairing</i>, then <i>Pair device with pairing code</i> in Wireless debugging and type the code into Shizuku’s notification. Then <i>Start</i>.</div></>)}
      </ul>
      <div className="setup-actions">
        {!n.devOptions ? (
          <button className="btn primary" onClick={() => { haptic(); setupFix('about-phone') }}>About phone</button>
        ) : (
          <button className="btn" onClick={() => { haptic(); setupFix('dev-options') }}>Developer options</button>
        )}
        <button className={`btn${n.devOptions ? ' primary' : ''}`} onClick={() => { haptic(); setupFix('open-shizuku') }}>Open Shizuku</button>
      </div>
      <div className="setup-actions">
        <button className="btn" onClick={() => { haptic(); onSkip() }}>Shizuku is running</button>
        <button className="btn" onClick={() => { haptic(); onSkip() }}>Skip for now</button>
      </div>
    </div>
  )
}

/** Epoch seconds, re-read every second while `on` (the installer is running) and the page is visible; stops after 3 h. */
function useInstallClock(on: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!on) return
    let ticks = 0
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Math.floor(Date.now() / 1000))
      if (++ticks >= 10800) clearInterval(id)
    }
    const id = setInterval(tick, 1000)
    const vis = () => document.visibilityState === 'visible' && setNow(Math.floor(Date.now() / 1000))
    document.addEventListener('visibilitychange', vis)
    tick()
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [on])
  return now
}

const MARK_STEP = { ok: '✓', bad: '✕', run: '', todo: '·' } as const

/** Step 3: copy the installer command, run it in Termux, then its progress line by line. */
function InstallerStep({ progress, onCopied }: { progress: Progress | null; onCopied: () => void }) {
  const lines = progress?.lines ?? []
  const now = useInstallClock(Boolean(progress?.times) && !progress?.done && !progress?.fail && lines.some(l => l.startsWith('STEP ')))
  const v = progressView(lines, progress?.times, now)
  const started = lines.some(l => l.startsWith('STEP '))
  const actions = (
    <div className="setup-actions">
      <button className="btn primary" onClick={() => { haptic(); copyBootstrap(); onCopied() }}>Copy the command</button>
      <button className="btn" onClick={() => { haptic(); setupFix('open-termux') }}>Open Termux</button>
    </div>
  )
  if (!started)
    return (
      <div className="flow-card">
        <div className="flow-card-title">Run the installer</div>
        <ol className="setup-help flow-steps">
          <li>Tap <b>Copy the command</b>, then <b>Open Termux</b>.</li>
          <li>In Termux, long-press, tap <b>Paste</b>, then press Enter.</li>
          <li>Stay in Termux and tap <b>Allow</b> on what it asks (notifications, battery, files; Shizuku: <i>Allow all the time</i>).</li>
        </ol>
        {actions}
        <div className="dim small flow-card-note">
          {progress?.active ? 'Waiting for the installer to start… its progress shows here.' : 'It takes 15-40 minutes, mostly waiting. Its progress shows here.'}
        </div>
      </div>
    )
  return (
    <div className="flow-card">
      <div className="flow-card-title">{v.fail ? 'The installer stopped' : 'Installing Hermes'}</div>
      {v.hint && !v.fail && <div className="setup-help install-hint"><b>{v.hint}</b></div>}
      <ul className="install-steps">
        {v.steps.map(s => (
          <li key={s.id} className={`install-step ${s.state}`}>
            <span className="install-mark" aria-hidden="true">{s.state === 'run' ? <Spinner small /> : MARK_STEP[s.state]}</span> {s.label}
            {s.secs != null && s.state !== 'todo' && <span className="install-time">{formatDuration(s.secs)}</span>}
          </li>
        ))}
      </ul>
      {v.total != null && <div className="dim small install-total">{v.done ? 'Total' : 'So far'} {formatDuration(v.total)}</div>}
      {v.android && <div className="dim small">{v.android}</div>}
      {v.todo.length > 0 && (
        <div className="setup-help">
          Still to do after the install:
          <ul className="install-todo">{v.todo.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {v.fail ? (
        <>
          <div className="setup-help">
            The installer stopped at <b>{v.steps.find(s => s.id === v.fail)?.label ?? v.fail}</b>. Open Termux to see why, then paste the same
            command again: finished steps are skipped.
          </div>
          {actions}
        </>
      ) : (
        <>
          <div className="dim small flow-card-note">Keep Termux open and the screen on. This page moves on by itself when it is done.</div>
          <div className="setup-actions">
            <button className="btn" onClick={() => { haptic(); setupFix('open-termux') }}>Open Termux</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Once connected on a first run (neither flag set): work out what is missing and open the flow when something is.
 *  Nothing missing: remember it, so an established install is never checked (or interrupted) again. */
let flowChecked = false
export async function checkSetupFlow(): Promise<void> {
  if (flowChecked || flowDismissed || welcomeDone() || flowDone() || getState().screen) return
  const [hasModel, r] = await Promise.all([modelConnected(), remote()])
  if (hasModel == null || getState().conn !== 'open') return // no answer: try again on the next connect
  flowChecked = true
  const steps = setupSteps(setupState(), 'open', r, hasModel)
  if (!shouldOpenFlow(steps, { welcomeDone: false, flowDone: false })) {
    markWelcomeDone()
    markFlowDone()
  } else if (!getState().screen) setState({ screen: 'welcome' })
}

const SEEN = 'hm.connectedOnce'

/** First run that can't reach Hermes: open the setup flow (at "Start Hermes") by itself once per launch, after a grace
 *  period. The timer is not restarted by the connection flapping between connecting and closed while it retries. */
let firstRunTimer = 0
export function watchFirstRun(conn: string, open: () => void): () => void {
  let seen = false
  try {
    seen = localStorage.getItem(SEEN) === '1'
    if (conn === 'open') localStorage.setItem(SEEN, '1')
  } catch {
    /* private mode */
  }
  if (conn === 'open') {
    clearTimeout(firstRunTimer)
    firstRunTimer = 0
  }
  if (seen || conn === 'open' || firstRunShown || firstRunTimer) return () => {}
  // Nothing to wait for when Termux isn't even there, or the installer is running: open the flow at once.
  const nat = setupState()
  const now = Boolean(nat && nat.canInstall !== undefined && (!nat.termux || setupProgress()?.active))
  firstRunTimer = window.setTimeout(() => {
    firstRunTimer = 0
    if (getState().conn !== 'open' && !getState().screen && !flowDismissed) {
      firstRunShown = true
      open()
    }
  }, now ? 0 : 15000)
  return () => {}
}
let firstRunShown = false
