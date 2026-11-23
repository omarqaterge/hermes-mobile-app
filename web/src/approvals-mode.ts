// Hermes's own `approvals.mode` (`manual`, `smart`, or `off`) for the current bot, read from GET /api/config?profile=.
// No polling and no timer: asked once per bot while connected (`fresh` asks again when a screen opens) and re-checked
// when the user opens the Auto picker or saves `approvals.mode` in Advanced settings. The app never changes the mode
// itself; it only makes sure the Auto control and Access & privacy never imply every risky command asks when Hermes is
// approving on its own.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { Access } from './gateway'
import { getState, subscribe, useStore } from './store'

export type ApprovalsMode = 'manual' | 'smart' | 'off'

const answers = new Map<string, ApprovalsMode | null>()
const asking = new Set<string>()
const subs = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  subs.forEach(f => f())
}

let lastConn = getState().conn
subscribe(() => {
  const conn = getState().conn
  if (conn === lastConn) return
  lastConn = conn
  if (conn !== 'open' && answers.size) {
    answers.clear()
    changed()
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

function ask(profile: string): void {
  if (asking.has(profile)) return
  asking.add(profile)
  const path = profile ? `/api/config?profile=${encodeURIComponent(profile)}` : '/api/config'
  void Promise.resolve(api<Record<string, unknown>>('GET', path, undefined, { profile: false }))
    .then(cfg => {
      if (getState().conn !== 'open') return
      answers.set(profile, parseApprovalsMode(cfg))
      changed()
    })
    .catch(() => {
      if (getState().conn !== 'open') return
      if (!answers.has(profile)) {
        answers.set(profile, null)
        changed()
      }
    })
    .finally(() => asking.delete(profile))
}

/** Re-read `approvals.mode` for `profile` (or drop other bots' cached answers and re-read the active bot) without flashing null. */
export function recheckApprovalsMode(profile?: string): void {
  const target = profile || getState().profile
  if (!profile) {
    for (const k of [...answers.keys()]) if (k !== target) answers.delete(k)
  }
  if (getState().conn === 'open') ask(target)
}

/** Test helper: clears cached answers without talking to Hermes. */
export function resetApprovalsModeForTest(): void {
  answers.clear()
  asking.clear()
  changed()
}

/** Hermes's `approvals.mode` for the active bot: `'manual'`, `'smart'`, `'off'`, or null when offline / unknown. */
export function useApprovalsMode({ fresh = false }: { fresh?: boolean } = {}): ApprovalsMode | null {
  const conn = useStore(s => s.conn)
  const profile = useStore(s => s.profile)
  const opening = useStore(s => s.opening)
  useSyncExternalStore(
    f => (subs.add(f), () => subs.delete(f)),
    () => version
  )
  useEffect(() => {
    // Wait until a chat opening finishes so we never add a request to the start-up burst (14-start-up.cjs).
    if (conn !== 'open' || opening) return
    if (fresh || !answers.has(profile)) ask(profile)
  }, [conn, profile, opening, fresh])
  return conn === 'open' ? (answers.get(profile) ?? null) : null
}

export const isLooseApprovals = (m: ApprovalsMode | null): m is 'smart' | 'off' => m === 'smart' || m === 'off'

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
  if (hermesMode === 'smart') return 'Auto is off. Hermes approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Auto is off. Hermes approves every command without asking'
  return 'Auto is off'
}

/** Subtitle of the Off option in the Auto picker. */
export function offOptionSub(hermesMode: ApprovalsMode | null): string {
  if (hermesMode === 'smart') return 'Hermes approves low-risk commands by itself and asks for the rest'
  if (hermesMode === 'off') return 'Hermes approves every command without asking'
  return 'Hermux asks before risky commands'
}

/** Toast shown after switching a chat's Auto to Off. */
export function doneOffToast(hermesMode: ApprovalsMode | null): string {
  if (hermesMode === 'smart') return 'Auto off: Hermes still approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Auto off: Hermes still approves every command without asking'
  return 'Auto off: Hermux asks before risky commands again'
}

/** Value shown on the Settings main page's Access & privacy row. */
export function accessSummary(access: Access, hermesMode: ApprovalsMode | null): string {
  if (access === 'auto') return 'Auto access'
  if (access === 'full') return 'Full access'
  if (hermesMode === 'smart') return 'Smart approvals'
  if (hermesMode === 'off') return 'Approvals off'
  return 'Auto off'
}

/** Subtitle shown under Settings → Access & privacy → Auto for all chats. */
export function defaultAccessSub(access: Access, hermesMode: ApprovalsMode | null): string {
  if (access === 'auto') return 'Auto access'
  if (access === 'full') return 'Full access'
  if (hermesMode === 'smart') return 'Off · Hermes approves low-risk commands by itself'
  if (hermesMode === 'off') return 'Off · Hermes approves every command without asking'
  return 'Off'
}

/** Title and body for the calm note shown where Auto is chosen while Hermes is in smart or off mode. */
export function approvalsModeNote(hermesMode: 'smart' | 'off'): { title: string; sub: string; value: string } {
  if (hermesMode === 'smart') {
    return {
      title: 'Hermes approvals mode',
      value: 'Smart',
      sub: 'Hermes approves low-risk commands by itself, even when Auto is off. Open approvals.mode in Advanced settings.'
    }
  }
  return {
    title: 'Hermes approvals mode',
    value: 'Off',
    sub: 'Hermes approves every command without asking, even when Auto is off. Open approvals.mode in Advanced settings.'
  }
}
