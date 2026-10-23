// Settings → Uninstall Hermes: one flow that removes Hermes, Debian, its data and chats, the installer's changes, then
// Termux:API, Termux:Boot, Shizuku, Termux and this app (Android asks once per app). Offers a backup to Downloads first.
import { useEffect, useState } from 'react'
import { confirmDialog, promptDialog } from '../dialog'
import { haptic, isNative, onSetupEvent, setupFix, setupState, startHermes, type NativeSetup } from '../bridge'
import { reconnectNow } from '../gateway'
import { toast } from '../store'
import { Sheet } from './Screens'
import { Row, Section, ToggleRow } from './ui'
import { Spinner } from './Spinner'
import {
  APPS, appInstalled, backupName, canUninstall, cleanupOk, nextApp, onCleanupDone, parseCleanup, phaseOf, settingsSnapshot,
  resumeOnStart, startCleanup, uninstallApp, uninstallState, type AppId, type UninstallNative
} from '../uninstall'

export function UninstallSection() {
  const [open, setOpen] = useState(false)
  if (!isNative || !canUninstall()) return null // a browser, or an older app build without the uninstall bridge
  return (
    <>
      <Section title="Danger zone" footer="Removes Hermes, all chats and every helper app from this phone. You can save a backup first.">
        <Row icon="🗑" danger title="Uninstall Hermes" sub="Hermes, Debian, chats, Termux and the helper apps" chevron onClick={() => setOpen(true)} />
      </Section>
      {open && <UninstallSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/** Mounted at the app root: after a cleanup removed something, opening the app goes straight back to the sheet. */
export function UninstallResume() {
  const [open, setOpen] = useState(() => isNative && canUninstall() && resumeOnStart(uninstallState()))
  return open ? <UninstallSheet onClose={() => setOpen(false)} /> : null
}

const get = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

function UninstallSheet({ onClose }: { onClose: () => void }) {
  const [n, setN] = useState<NativeSetup | null>(() => setupState())
  const [s, setS] = useState<UninstallNative | null>(() => uninstallState())
  const [backup, setBackup] = useState(true)
  const [keys, setKeys] = useState(false)
  const [go, setGo] = useState({ confirmed: false, skipCleanup: false })
  const [why, setWhy] = useState('')
  useEffect(() => {
    // Re-read on return to the app (an uninstall prompt was answered) and when Termux answered: no timer.
    const sync = () => {
      setN(setupState())
      setS(uninstallState())
    }
    const off1 = onSetupEvent(e => e.kind === 'changed' && sync())
    const off2 = onCleanupDone(sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      off1()
      off2()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  const termuxThere = appInstalled(n, 'termux')
  const phase = phaseOf(s, termuxThere, go)
  const withBackup = backup && termuxThere
  const report = s?.result ? parseCleanup(s.result.stdout || '', withBackup) : null

  const run = (b: boolean, k: boolean) => {
    const r = startCleanup(b, k, settingsSnapshot(get))
    setWhy(r === 'ok' ? '' : r)
    setS(uninstallState())
  }

  const begin = async () => {
    const typed = await promptDialog({
      title: 'Uninstall Hermes?',
      message: `This deletes Hermes and everything in it on this phone: all chats, memory, skills, settings and keys${withBackup ? ' (after saving the backup)' : ''}. Then Android asks you to remove each app. It can’t be undone. Type uninstall to confirm.`,
      placeholder: 'uninstall',
      match: 'uninstall',
      danger: true,
      icon: '⚠',
      confirmLabel: 'Uninstall'
    })
    if (typed !== 'uninstall') return
    setGo(g => ({ ...g, confirmed: true }))
    if (termuxThere) run(withBackup, withBackup && keys)
  }

  const cancelAfterFailure = () => {
    // Nothing was removed (the backup failed): Hermes may run again.
    startHermes()
    reconnectNow()
    onClose()
  }

  return (
    <Sheet title="Uninstall Hermes" onClose={onClose}>
      <div className="sheet-scroll uninstall">
        {phase === 'review' && (
          <>
            <ul className="setup-list">
              {[
                ['Hermes, with all chats, memory, skills, settings and API keys', 'Everything Hermes keeps in Debian.'],
                ['Debian', 'The Linux system Hermes runs in, inside Termux.'],
                ['The installer’s files in Termux', '~/bin/hermes-services, ~/bin/hermes-debian, rish, ~/.hermes-mobile, the start-after-restart script, and Termux taking commands from this app.'],
                ['The phone setting the installer changed', 'Android’s child-process limit goes back to normal (needs Shizuku running; otherwise it stays, which is harmless).'],
                ...APPS.map(a => [`App: ${a.name}${appInstalled(n, a.id) ? '' : ' (not installed)'}`, a.what])
              ].map(([t, h]) => (
                <li key={t} className="setup-item bad">
                  <span className="setup-mark bad" aria-hidden="true">✕</span>
                  <div className="setup-body">
                    <div className="setup-title">{t}</div>
                    <div className="setup-help">{h}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="setup-help uninstall-note">
              Kept: files Hermes saved to your phone’s storage (Downloads, Pictures/Hermes) and the backup. Android asks before removing each
              app; Hermes Mobile goes last.
            </div>
            {termuxThere ? (
              <Section title="Backup">
                <ToggleRow icon="💾" tone="blue" title="Save a backup to Downloads" sub="Chats, memory, skills, Hermes settings and this app’s settings, as hermes-backup-<date>.tar.gz" on={backup} onChange={setBackup} />
                {backup && (
                  <ToggleRow
                    icon="🔑"
                    tone="gold"
                    title="Include API keys and sign-ins"
                    sub={keys ? 'On: .env and auth.json are in the file. Any app that can read your Downloads can read them.' : 'Off: .env and auth.json are left out (other apps can read Downloads). You sign in again after a restore.'}
                    on={keys}
                    onChange={setKeys}
                  />
                )}
              </Section>
            ) : (
              <div className="setup-help uninstall-note">Termux is not installed, so Debian and Hermes are already gone; nothing to back up.</div>
            )}
            {why && <div className="setup-help uninstall-err">{whyText(why)}</div>}
            {why === 'no-permission' && (
              <div className="setup-actions">
                <button className="btn" onClick={() => setupFix('permissions')}>Allow</button>
                <button className="btn" onClick={() => setGo({ confirmed: true, skipCleanup: true })}>Skip to the apps</button>
              </div>
            )}
          </>
        )}

        {phase === 'running' && (
          <div className="uninstall-running">
            <Spinner />
            <div className="setup-title">Removing Hermes…</div>
            <div className="setup-help">Stopping Hermes, saving the backup if you asked for one, then removing Debian and the installer’s files. This can take a few minutes. You can leave the app and come back here.</div>
          </div>
        )}

        {(phase === 'failed' || phase === 'apps') && report && <Steps report={report} />}

        {phase === 'lost' && (
          <div className="setup-help uninstall-err">
            The cleanup in Termux started but didn’t report back (the app was closed meanwhile). Run it again: it skips what is already gone.
          </div>
        )}

        {phase === 'failed' && s?.result && (
          <div className="setup-help uninstall-err">
            {s.result.exit === 3 ? 'Stopped before removing anything: ' : s.result.exit === -1 ? 'Termux didn’t run the cleanup: ' : 'Something could not be removed: '}
            {report?.fails.join(' · ') || s.result.errmsg || s.result.stderr || `exit ${s.result.exit}`}
          </div>
        )}

        {phase === 'apps' && <Apps n={n} s={s} />}
      </div>

      <div className="sheet-actions">
        {phase === 'review' && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn danger-solid" onClick={() => void begin()}>Uninstall…</button>
          </>
        )}
        {phase === 'running' && <button className="btn" onClick={onClose}>Close</button>}
        {(phase === 'lost' || phase === 'failed') && (
          <>
            {phase === 'failed' && s?.result?.exit === 3 && !s.removed ? (
              <button className="btn" onClick={cancelAfterFailure}>Cancel</button>
            ) : (
              <button className="btn" onClick={() => setGo(g => ({ ...g, skipCleanup: true }))}>Continue to the apps</button>
            )}
            <button className="btn danger-solid" onClick={() => run(withBackup && !s?.removed, keys && withBackup && !s?.removed)}>Try again</button>
          </>
        )}
        {phase === 'apps' && <button className="btn" onClick={onClose}>Close</button>}
      </div>
    </Sheet>
  )
}

function whyText(why: string): string {
  if (why === 'no-permission') return 'Hermes Mobile may not run commands in Termux (Android permission), so it can’t remove Debian. Allow it, or skip: uninstalling Termux deletes Debian and Hermes too, but leaves the phone setting changed.'
  if (why === 'no-termux') return 'Termux is not installed.'
  if (why === 'busy') return 'The cleanup is already running.'
  return `Couldn’t start the cleanup (${why}).`
}

function Steps({ report }: { report: ReturnType<typeof parseCleanup> }) {
  const mark = { ok: '✓', skip: '–', fail: '✕', pending: '·' } as const
  return (
    <>
      <ul className="setup-list">
        {report.steps.map(st => (
          <li key={st.id} className={`setup-item ${st.state === 'fail' ? 'bad' : 'ok'}`} data-step={st.id} data-state={st.state}>
            <span className={`setup-mark ${st.state === 'fail' ? 'bad' : st.state === 'ok' ? 'ok' : 'info'}`} aria-label={st.state}>{mark[st.state]}</span>
            <div className="setup-body">
              <div className="setup-title">{st.label}</div>
              {st.text && <div className="setup-help">{st.text}</div>}
            </div>
          </li>
        ))}
      </ul>
      {report.backup && (
        <div className="setup-help uninstall-note">
          Backup saved: <b>Download/{backupName(report.backup)}</b>. To restore it on a new install, unpack it into Hermes’s folder (README → Uninstall).
        </div>
      )}
    </>
  )
}

function Apps({ n, s }: { n: NativeSetup | null; s: UninstallNative | null }) {
  const next = nextApp(n)
  const ok = cleanupOk(s)
  const remove = async (id: AppId) => {
    haptic()
    if (id === 'termux' && !ok) {
      const sure = await confirmDialog({
        title: 'Uninstall Termux anyway?',
        message: 'The cleanup in Termux didn’t finish. Uninstalling Termux deletes Debian and Hermes with it. On a rooted phone that used chroot-distro, restart the phone first.',
        confirmLabel: 'Uninstall Termux',
        danger: true
      })
      if (!sure) return
    }
    if (!uninstallApp(id)) toast('Android didn’t open the uninstall screen.')
  }
  const gone = APPS.filter(a => a.id !== 'self' && !appInstalled(n, a.id))
  return (
    <>
      <div className="setup-help uninstall-note">Android asks before removing each app. Tap Uninstall, then OK on Android’s screen. Removing Termux makes Android close this app: open Hermes Mobile again to finish.</div>
      <ul className="setup-list uninstall-apps">
        {APPS.map(a => {
          const there = appInstalled(n, a.id)
          return (
            <li key={a.id} className={`setup-item ${there ? 'bad' : 'ok'}`} data-app={a.id}>
              <span className={`setup-mark ${there ? 'bad' : 'ok'}`} aria-label={there ? 'Installed' : 'Removed'}>{there ? '·' : '✓'}</span>
              <div className="setup-body">
                <div className="setup-title">{a.name}</div>
                <div className="setup-help">{there ? a.what : 'Removed'}</div>
                {a.id === 'self' && (
                  <div className="setup-help">
                    Removed so far: {ok ? 'Hermes, its chats and Debian, the installer’s files' : 'what the steps above show'}
                    {gone.length ? `, ${gone.map(g => g.name).join(', ')}` : ''}. Removing this app is the last step.
                  </div>
                )}
                {there && (
                  <div className="setup-actions">
                    <button className={`btn ${a.id === next ? 'danger-solid' : ''}`} onClick={() => void remove(a.id)}>
                      {a.id === 'self' ? 'Uninstall Hermes Mobile' : `Uninstall ${a.name}`}
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

