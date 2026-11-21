// The chat's model picker list, kept between opens so the picker shows at once. Hermes builds the list on the phone,
// and its live refresh (every provider's catalog fetched again) is slow there and competes with a running reply, so it
// runs at most every REFRESH_EVERY_MS per profile (or when asked with "Refresh the list"), not on every open, and never
// twice at the same time: a refresh still running when the sheet closes finishes and fills the next open.
import type { ModelOptionsResult } from '@hermes/shared/gateway-contract.generated'

const KEY = 'hm.modelOptions.v1'
/** How old the last live list may be before an open asks Hermes for a new one. */
export const REFRESH_EVERY_MS = 10 * 60_000

/** The parts of a `model.options` answer the picker draws: no prices, limits or usage. */
export type ModelList = Pick<ModelOptionsResult, 'model' | 'provider'> & {
  providers: { slug: string; name: string; models?: string[]; authenticated?: boolean | null; is_current?: boolean | null; free_tier?: boolean | null }[]
}

interface Entry {
  list: ModelList
  /** When a live (`refresh: true`) list last arrived; 0 when only Hermes's cached catalog was read. */
  liveAt: number
}

function readAll(): Record<string, Entry> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Only the fields the picker draws, so the stored copy stays small. */
export function slim(r: ModelOptionsResult): ModelList {
  return {
    model: r.model,
    provider: r.provider,
    providers: (r.providers || []).map(p => ({
      slug: p.slug,
      name: p.name,
      models: p.models,
      authenticated: p.authenticated,
      is_current: p.is_current,
      free_tier: p.free_tier
    }))
  }
}

/** The list last shown for `profile`, or null. */
export function cachedModels(profile: string): ModelList | null {
  const e = readAll()[profile]
  return e?.list && Array.isArray(e.list.providers) ? e.list : null
}

/** Keeps `list` for `profile`; `live` marks it as a fresh (refreshed) list. */
export function saveModels(profile: string, list: ModelList, live: boolean): void {
  try {
    const all = readAll()
    all[profile] = { list, liveAt: live ? Date.now() : all[profile]?.liveAt || 0 }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage full or blocked: the picker just loads as before */
  }
}

/** True when `profile`'s last live list is older than REFRESH_EVERY_MS (or there is none). */
export function refreshDue(profile: string, now = Date.now()): boolean {
  const at = readAll()[profile]?.liveAt || 0
  return !at || now - at >= REFRESH_EVERY_MS || at > now
}

const inflight = new Map<string, Promise<ModelList>>()

/** One live refresh per profile at a time: a second call while one runs gets the same promise. */
export function liveOnce(profile: string, run: () => Promise<ModelOptionsResult>): Promise<ModelList> {
  const running = inflight.get(profile)
  if (running) return running
  const p = run()
    .then(r => {
      const list = slim(r)
      saveModels(profile, list, true)
      return list
    })
    .finally(() => inflight.delete(profile))
  inflight.set(profile, p)
  return p
}

/** A live refresh for `profile` is running now. */
export const refreshing = (profile: string): boolean => inflight.has(profile)

/** A sign-in, key or endpoint changed: the next open of the picker asks Hermes for the live list again (every profile). */
export function modelsChanged(): void {
  try {
    const all = readAll()
    for (const e of Object.values(all)) if (e) e.liveAt = 0
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* nothing stored */
  }
}
