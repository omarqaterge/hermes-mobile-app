import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { copyText, haptic, isNative, setupFix, setupState, type NativeSetup } from '../bridge'
import { reconnectNow, rpc } from '../gateway'
import { closeScreen, getState, setState, toast, useStore } from '../store'
import { nextStep, recommendedGaps, setupSteps, shouldOpenFlow, type FlowStep, type PhoneAccess, type Remote, type StepId, type StepState } from '../setupflow'
import { WelcomeBody, markWelcomeDone, welcomeDone } from './Connect'
import { ScreenShell } from './Screens'
import { Spinner } from './Spinner'

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
export function useSetupState(opts: { poll?: boolean; model?: boolean } = {}) {
  const conn = useStore(s => s.conn)
  const profile = useStore(s => s.profile)
  const [n, setN] = useState<NativeSetup | null>(() => setupState())
  const [r, setR] = useState<Remote | null>(null)
  const [hasModel, setHasModel] = useState<boolean | null>(null)
  const wantModel = Boolean(opts.model)
  const refresh = useCallback(() => {
    setN(setupState())
    if (getState().conn !== 'open') return
    void remote().then(setR)
    if (wantModel) void modelConnected().then(v => v != null && setHasModel(v))
  }, [wantModel])
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', on)
    const t = opts.poll ? setInterval(refresh, 4000) : 0
    return () => {
      document.removeEventListener('visibilitychange', on)
      if (t) clearInterval(t)
    }
  }, [refresh, opts.poll])
  useEffect(refresh, [conn, profile, refresh])
  const steps = setupSteps(n, conn, r, wantModel ? hasModel : true)
  const loading = conn === 'connecting' || (conn === 'open' && (r == null || (wantModel && hasModel == null)))
  return { steps, next: nextStep(steps), loading, refresh, n, r, conn }
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
  const { steps, loading, refresh, n, r, conn } = useSetupState({ model: true })
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
  const finished = todo.current.filter(id => (stateOf(id) === 'ok' && !(id === 'model' && !modelDone)) || (id === 'model' && modelDone)).length
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
  firstRunTimer = window.setTimeout(() => {
    firstRunTimer = 0
    if (getState().conn !== 'open' && !getState().screen && !flowDismissed) {
      firstRunShown = true
      open()
    }
  }, 15000)
  return () => {}
}
let firstRunShown = false
