// Hermes's own `approvals.mode` (`manual`, `smart`, or `off`) for each bot, read from GET /api/config?profile=.
// No polling and no timer: shared with `loadDefaultModel()` on start-up and bot switches, and re-checked when the user
// opens the Auto picker or Settings, runs `/approvals …`, or saves `approvals.mode` in Advanced settings. Unknown/failed
// reads are never cached as `null` and never worded as if Hermes asks; per-profile sequence numbers and a connection
// generation guard ensure the newest read wins and pre-reconnect replies are ignored. The app never changes the mode itself.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { Access } from './gateway'
import { getState, subscribe, useStore } from './store'

export type ApprovalsMode = 'manual' | 'smart' | 'off'

const answers = new Map<string, ApprovalsMode>()
const reqSeq = new Map<string, number>()
const inFlight = new Map<string, Promise<Record<string, unknown> | null>>()
const subs = new Set<() => void>()
let connGen = 0
let version = 0
let startupWait: () => Promise<void> = () => Promise.resolve()

const changed = () => {
  version++
  subs.forEach(f => f())
}

/** Registered by `gateway.ts` so passive chat mounts wait for `afterChatOpens()` and share `loadDefaultModel()`'s read. */
export function setApprovalsStartupWait(fn: () => Promise<void>): void {
  startupWait = fn
}

let lastConn = getState().conn
subscribe(() => {
  const conn = getState().conn
  if (conn === lastConn) return
  lastConn = conn
  if (conn !== 'open') {
    connGen++
    inFlight.clear()
    if (answers.size) {
      answers.clear()
      changed()
    }
  }
})

/** Reads `approvals.mode` from a Hermes config response. Unknown or missing values return null. */
export function parseApprovalsMode(config: unknown): ApprovalsMode | null {
  if (!config || typeof config !== 'object') return null
  const o = config as Record<string, unknown>
  const nested = o.approvals && typeof o.approvals === 'object' ? (o.approvals as Record<string, unknown>).mode : undefined
  const raw = nested ?? o['approvals.mode']
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return v === 'manual' || v === 'smart' || v === 'off' ? v : null
}

/** Fetches `GET /api/config?profile=<profile>` and records `approvals.mode` if this read is still the newest for that bot
 *  in the current connection. With `force: false`, shares any in-flight read for that bot so start-up (`loadDefaultModel`
 *  and `useApprovalsMode`) sends only one request; `force: true` (default) always starts a fresh read. */
export function readProfileConfig(profile = getState().profile, { force = true }: { force?: boolean } = {}): Promise<Record<string, unknown> | null> {
  if (getState().conn !== 'open') return Promise.resolve(null)
  if (!force) {
    const existing = inFlight.get(profile)
    if (existing) return existing
  }
  const gen = connGen
  const seq = (reqSeq.get(profile) ?? 0) + 1
  reqSeq.set(profile, seq)
  const path = profile ? `/api/config?profile=${encodeURIComponent(profile)}` : '/api/config'
  const p = (async () => {
    try {
      const cfg = await Promise.resolve(api<Record<string, unknown>>('GET', path, undefined, { profile: false }))
      if (gen !== connGen || getState().conn !== 'open' || reqSeq.get(profile) !== seq) return cfg
      const parsed = parseApprovalsMode(cfg)
      if (parsed) {
        if (answers.get(profile) !== parsed) {
          answers.set(profile, parsed)
          changed()
        }
      } else if (answers.delete(profile)) {
        changed()
      }
      return cfg
    } catch {
      // Never cache `null` on a failed read: clear any stale value if still latest, and retry on the next picker/Settings open.
      if (gen === connGen && getState().conn === 'open' && reqSeq.get(profile) === seq) {
        if (answers.delete(profile)) changed()
      }
      return null
    } finally {
      if (gen === connGen && reqSeq.get(profile) === seq) inFlight.delete(profile)
    }
  })()
  inFlight.set(profile, p)
  return p
}

/** Re-read `approvals.mode` for `profile` (or drop other bots' cached answers and re-read the active bot). Always issues a
 *  fresh read so a recheck after saving or `/approvals …` is never dropped by an earlier in-flight request. */
export function recheckApprovalsMode(profile?: string): void {
  const target = profile || getState().profile
  if (!profile) {
    // Every other bot's cached answer and in-flight read go stale (e.g. after "Apply to all bots"): bump its counter so a
    // read started before the save can't put the old mode back.
    for (const k of new Set([...answers.keys(), ...inFlight.keys(), ...reqSeq.keys()])) {
      if (k === target) continue
      answers.delete(k)
      inFlight.delete(k)
      reqSeq.set(k, (reqSeq.get(k) ?? 0) + 1)
    }
  }
  if (getState().conn === 'open') void readProfileConfig(target)
}

/** Current known `approvals.mode` for `profile` (null when offline, not yet read, or unknown). */
export function currentApprovalsMode(profile = getState().profile): ApprovalsMode | null {
  return getState().conn === 'open' ? (answers.get(profile) ?? null) : null
}

/** Test helper: clears cached answers and bumps the connection generation without talking to Hermes. */
export function resetApprovalsModeForTest(): void {
  connGen++
  answers.clear()
  reqSeq.clear()
  inFlight.clear()
  changed()
}

/** Hermes's `approvals.mode` for the active (or given) bot: `'manual'`, `'smart'`, `'off'`, or null when offline / unknown. */
export function useApprovalsMode({ fresh = false, profile: wanted }: { fresh?: boolean; profile?: string } = {}): ApprovalsMode | null {
  const conn = useStore(s => s.conn)
  const activeProfile = useStore(s => s.profile)
  const target = wanted ?? activeProfile
  useSyncExternalStore(
    f => (subs.add(f), () => subs.delete(f)),
    () => version
  )
  useEffect(() => {
    if (conn !== 'open') return
    if (fresh) {
      void readProfileConfig(target)
      return
    }
    let cancelled = false
    void startupWait().then(() => {
      if (cancelled || getState().conn !== 'open') return
      if (!answers.has(target) && !inFlight.has(target)) void readProfileConfig(target, { force: false })
    })
    return () => {
      cancelled = true
    }
  }, [conn, target, fresh])
  return conn === 'open' ? (answers.get(target) ?? null) : null
}

export const isLooseApprovals = (m: ApprovalsMode | null): m is 'smart' | 'off' => m === 'smart' || m === 'off'

/** Inspects a config update payload (what `PUT /api/config` merges) for `approvals.mode`: whether it touches the mode
 *  at all (including through a parent `approvals` object) and whether it sets the mode to `off` or `smart`. */
export function configApprovalsUpdate(payload: Record<string, unknown>): { touches: boolean; loose: 'off' | 'smart' | null } {
  const mode = parseApprovalsMode(payload)
  const approvals = payload.approvals
  const touches =
    'approvals.mode' in payload ||
    (approvals !== undefined &&
      (approvals === null ||
        typeof approvals !== 'object' ||
        Array.isArray(approvals) ||
        'mode' in (approvals as Record<string, unknown>)))
  return { touches, loose: isLooseApprovals(mode) ? mode : null }
}

/** Short chip text on the composer's Auto button when the chat's own Auto is off. */
export function autoButtonText(mode: Access, hermesMode: ApprovalsMode | null): string {
  if (mode === 'full') return 'Full access'
  if (mode === 'auto') return 'Auto'
  if (hermesMode === 'smart') return 'Auto · smart'
  if (hermesMode === 'off') return 'Approvals off'
  return 'Auto'
}

/** Accessible label prefix on the composer's Auto button (always followed by ". Change how much Hermux may do without asking"). */
export function autoButtonLabel(mode: Access, hermesMode: ApprovalsMode | null): string {
  if (mode === 'auto') return 'Auto access is on'
  if (mode === 'full') return 'Full access is on'
  if (hermesMode === 'smart') return 'Auto is off. Hermux approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Auto is off. Hermux approves every command without asking'
  return 'Auto is off'
}

/** Subtitle of the Off option in the Auto picker. Unknown (`null`) stays neutral and never implies Hermes asks. */
export function offOptionSub(hermesMode: ApprovalsMode | null): string {
  if (hermesMode === 'manual') return 'Hermux asks before risky commands'
  if (hermesMode === 'smart') return 'Hermux approves low-risk commands by itself and asks for the rest'
  if (hermesMode === 'off') return 'Hermux approves every command without asking'
  return 'Follows the approvals setting'
}

/** Toast / notice shown after switching a chat's Auto to Off. Unknown (`null`) stays neutral. */
export function doneOffToast(hermesMode: ApprovalsMode | null): string {
  if (hermesMode === 'manual') return 'Auto off: Hermux asks before risky commands again'
  if (hermesMode === 'smart') return 'Auto off: Hermux still approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Auto off: Hermux still approves every command without asking'
  return 'Auto off for this chat (follows the approvals setting)'
}

function offModeTail(hermesMode: ApprovalsMode | null): string {
  if (hermesMode === 'manual') return ': Hermux asks before risky commands'
  if (hermesMode === 'smart') return ': Hermux still approves low-risk commands by itself'
  if (hermesMode === 'off') return ': Hermux still approves every command without asking'
  return ' (follows the approvals setting)'
}

/** Error notice in chat when a failed `/yolo` switch settled back to Off. Unknown / lock-screen (`null`) stays neutral. */
export function accessUnsureOff(hermesMode: ApprovalsMode | null): string {
  return `Couldn’t change this chat’s access, so it is back to Off${offModeTail(hermesMode)}.`
}

/** Error notice when a resumed chat's Auto access could not be re-applied and fell back to Off. */
export function autoRestoreOffNotice(hermesMode: ApprovalsMode | null): string {
  return `Auto access couldn’t be set again, so this chat is in Off${offModeTail(hermesMode)}. Tap Auto to try again.`
}

/** Value shown on the Settings main page's Access & privacy row. Blank when offline/unknown so it never implies Hermes asks. */
export function accessSummary(access: Access, hermesMode: ApprovalsMode | null): string {
  if (access === 'auto') return 'Auto access'
  if (access === 'full') return 'Full access'
  if (hermesMode === 'smart') return 'Smart approvals'
  if (hermesMode === 'off') return 'Approvals off'
  if (hermesMode === 'manual') return 'Auto off'
  return ''
}

/** Subtitle shown under Settings → Access & privacy → Auto for all chats. */
export function defaultAccessSub(access: Access, hermesMode: ApprovalsMode | null): string {
  if (access === 'auto') return 'Auto access'
  if (access === 'full') return 'Full access'
  if (hermesMode === 'smart') return 'Off · Hermux approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Off · Hermux approves every command without asking'
  if (hermesMode === 'manual') return 'Off'
  return 'Off · follows the approvals setting'
}

/** Title and body for the calm note shown where Auto is chosen while Hermes is in smart or off mode. */
export function approvalsModeNote(hermesMode: 'smart' | 'off'): { title: string; sub: string; value: string } {
  if (hermesMode === 'smart') {
    return {
      title: 'Approvals mode',
      value: 'Smart',
      sub: 'Hermux approves low-risk commands by itself, even when Auto is off. Open approvals.mode in Advanced settings.'
    }
  }
  return {
    title: 'Approvals mode',
    value: 'Off',
    sub: 'Hermux approves every command without asking, even when Auto is off. Open approvals.mode in Advanced settings.'
  }
}
