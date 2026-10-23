import { describe, expect, it } from 'vitest'
import { appInstalled, cleanupOk, nextApp, parseCleanup, phaseOf, resumeOnStart, settingsSnapshot, type UninstallNative } from './uninstall'
import type { NativeSetup } from './bridge'

const base: NativeSetup = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true }
const st = (o: Partial<UninstallNative>): UninstallNative => ({ started: false, running: false, removed: false, result: null, ...o })
const go = { confirmed: false, skipCleanup: false }

// Lines exactly as phone/uninstall.sh prints them (tools/test_uninstall.sh runs the real script).
const FULL = `HMUNINSTALL STEP stop Stopping Hermes
HMUNINSTALL OK stop 3 supervisor loop(s) stopped
HMUNINSTALL STEP backup Saving a backup to Downloads
HMUNINSTALL BACKUP /storage/emulated/0/Download/hermes-backup-20261023-101500.tar.gz
HMUNINSTALL OK backup hermes-backup-20261023-101500.tar.gz (412 KB)
HMUNINSTALL STEP android Undoing the phone settings the installer changed
HMUNINSTALL SKIP android Shizuku isn't running, so the child-process limit stays lifted
HMUNINSTALL STEP debian Removing Debian and Hermes
HMUNINSTALL RM $PREFIX/var/lib/proot-distro/containers/debian
HMUNINSTALL OK debian removed
HMUNINSTALL STEP files Removing the installer's files in Termux
HMUNINSTALL RM ~/.hermes-mobile
HMUNINSTALL RM ~/bin/hermes-services
HMUNINSTALL OK files
HMUNINSTALL STEP termux Turning off commands from other apps in Termux
HMUNINSTALL OK termux allow-external-apps removed from ~/.termux/termux.properties
HMUNINSTALL DONE
`

describe('parseCleanup', () => {
  it('reads every step, the backup and the removed paths', () => {
    const r = parseCleanup(FULL, true)
    expect(r.done).toBe(true)
    expect(r.steps.map(s => `${s.id}:${s.state}`)).toEqual(['stop:ok', 'backup:ok', 'android:skip', 'debian:ok', 'files:ok', 'termux:ok'])
    expect(r.backup).toBe('/storage/emulated/0/Download/hermes-backup-20261023-101500.tar.gz')
    expect(r.removed).toEqual(['$PREFIX/var/lib/proot-distro/containers/debian', '~/.hermes-mobile', '~/bin/hermes-services'])
    expect(r.steps[2].text).toMatch(/Shizuku/)
  })
  it('a failed backup: FAIL, nothing after it, no DONE', () => {
    const r = parseCleanup('HMUNINSTALL STEP stop Stopping Hermes\nHMUNINSTALL OK stop 0\nHMUNINSTALL STEP backup Saving\nHMUNINSTALL FAIL backup can\'t write to Downloads; nothing was removed\n', true)
    expect(r.done).toBe(false)
    expect(r.steps.find(s => s.id === 'backup')?.state).toBe('fail')
    expect(r.steps.find(s => s.id === 'debian')?.state).toBe('pending')
    expect(r.fails).toEqual(["can't write to Downloads; nothing was removed"])
  })
  it('a FAIL sticks even when an OK for the same step follows', () => {
    const r = parseCleanup('HMUNINSTALL STEP files x\nHMUNINSTALL FAIL files could not remove ~/bin/rish\nHMUNINSTALL OK files\n', false)
    expect(r.steps.find(s => s.id === 'files')?.state).toBe('fail')
  })
  it('without a backup the backup step is not listed; junk lines are ignored', () => {
    const r = parseCleanup('noise\nHMUNINSTALL STEP stop x\nHMUNINSTALL OK stop\n', false)
    expect(r.steps.map(s => s.id)).toEqual(['stop', 'android', 'debian', 'files', 'termux'])
  })
})

describe('apps', () => {
  it('removes them in order: Termux:API, Termux:Boot, Shizuku, Termux, then this app', () => {
    let n: NativeSetup = { ...base }
    const order: string[] = []
    for (let i = 0; i < 6; i++) {
      const a = nextApp(n)
      order.push(a)
      if (a === 'self') break
      n = { ...n, [{ 'termux-api': 'termuxApi', 'termux-boot': 'termuxBoot', shizuku: 'shizuku', termux: 'termux' }[a]]: false }
    }
    expect(order).toEqual(['termux-api', 'termux-boot', 'shizuku', 'termux', 'self'])
  })
  it('skips apps that are not installed; this app is always there', () => {
    expect(nextApp({ ...base, termuxApi: false, shizuku: false })).toBe('termux-boot')
    expect(nextApp({ ...base, termux: false, termuxApi: false, termuxBoot: false, shizuku: false })).toBe('self')
    expect(appInstalled(null, 'self')).toBe(true)
    // an older shell that doesn't report an app: treat it as installed (Android's prompt tells)
    expect(appInstalled({ ...base, termuxBoot: undefined }, 'termux-boot')).toBe(true)
  })
})

describe('phaseOf', () => {
  it('review first; running while Termux works', () => {
    expect(phaseOf(st({}), true, go)).toBe('review')
    expect(phaseOf(st({ started: true, running: true }), true, { ...go, confirmed: true })).toBe('running')
  })
  it('done → the apps; Termux may go without a warning', () => {
    const s = st({ started: true, removed: true, result: { exit: 0, stdout: FULL } })
    expect(phaseOf(s, true, go)).toBe('apps')
    expect(cleanupOk(s)).toBe(true)
  })
  it('nothing removed (exit 3): back to review on reopen, the reason right after confirming', () => {
    const s = st({ result: { exit: 3, stdout: '' } })
    expect(phaseOf(s, true, go)).toBe('review')
    expect(phaseOf(s, true, { ...go, confirmed: true })).toBe('failed')
  })
  it('partly removed (exit 1) or Termux refusing → failed, unless the user carries on', () => {
    const s = st({ started: true, removed: true, result: { exit: 1, stdout: '' } })
    expect(phaseOf(s, true, go)).toBe('failed')
    expect(phaseOf(s, true, { ...go, skipCleanup: true })).toBe('apps')
    expect(cleanupOk(s)).toBe(false)
    expect(phaseOf(st({ result: { exit: -1, stdout: '', errmsg: 'allow-external-apps' } }), true, { ...go, confirmed: true })).toBe('failed')
  })
  it('started but no answer (the app was killed meanwhile) → lost: run it again', () => {
    expect(phaseOf(st({ started: true }), true, go)).toBe('lost')
  })
  it('no Termux: confirming goes straight to the apps', () => {
    expect(phaseOf(st({}), false, go)).toBe('review')
    expect(phaseOf(st({}), false, { ...go, confirmed: true })).toBe('apps')
  })
})

describe('settingsSnapshot', () => {
  it('only the listed settings, never caches or drafts', () => {
    const ls: Record<string, string> = { 'hm.theme': 'oled', 'hm.textScale': '1.1', 'hm.chatcache.v1': 'BIG', 'hm.drafts.v1': '{"a":"secret draft"}', 'hm.boot.v1': '{}' }
    const o = JSON.parse(settingsSnapshot(k => ls[k] ?? null))
    expect(o).toEqual({ app: 'hermes-mobile', settings: { 'hm.theme': 'oled', 'hm.textScale': '1.1' } })
  })
})

describe('resumeOnStart', () => {
  it('reopens the sheet once something was removed (Android kills the app when Termux goes)', () => {
    expect(resumeOnStart(st({ started: true, removed: true, result: { exit: 0, stdout: '' } }))).toBe(true)
    expect(resumeOnStart(st({ started: true, removed: true, result: { exit: 1, stdout: '' } }))).toBe(true)
  })
  it('not before, not after a backup failure that removed nothing, not in a browser', () => {
    expect(resumeOnStart(st({}))).toBe(false)
    expect(resumeOnStart(st({ result: { exit: 3, stdout: '' } }))).toBe(false)
    expect(resumeOnStart(null)).toBe(false)
  })
})
