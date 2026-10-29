// Model ids typed into a model picker (localStorage hm.customModels.v1: [{ p: provider slug, m: model }]). Hermes's
// catalog is a hint list: a newer model or one a provider's list leaves out is still a real model to it. A typed id
// that was picked once shows as a normal row under its provider from then on (Hermes Desktop's "Custom model").
// Shared by all profiles, like favourites: an id whose provider isn't connected on this profile just doesn't show.
import { useSyncExternalStore } from 'react'

export type CustomModel = { p: string; m: string }
type Row = { slug: string; models?: string[] | null }

const KEY = 'hm.customModels.v1'
const subs = new Set<() => void>()

function read(): CustomModel[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter(x => x && typeof x.p === 'string' && typeof x.m === 'string') : []
  } catch {
    return []
  }
}

let customs = read()

function save(next: CustomModel[]): void {
  customs = next
  try {
    localStorage.setItem(KEY, JSON.stringify(customs))
  } catch {
    /* ignore */
  }
  subs.forEach(cb => cb())
}

export const isCustom = (list: CustomModel[], p: string, m: string) => list.some(c => c.p === p && c.m === m)

/** A typed model id: anything without whitespace (ids look like `org/model:tag` or `model@date`; Hermes decides). */
export function customSlug(text: string): string | null {
  const s = text.trim()
  return s && !/\s/.test(s) ? s : null
}

/** The id the search text would add, or null when it isn't an id or some provider already lists it exactly. */
export function customCandidate(search: string, providers: Row[]): string | null {
  const s = customSlug(search)
  if (!s) return null
  const q = s.toLowerCase()
  return providers.some(p => (p.models || []).some(m => m.toLowerCase() === q)) ? null : s
}

/** Provider rows with the remembered ids appended to their provider. Returns `providers` itself when nothing applies. */
export function withCustoms<T extends Row>(providers: T[], list: CustomModel[]): T[] {
  if (!list.length) return providers
  let changed = false
  const next = providers.map(p => {
    const models = p.models || []
    const extra = list.filter(c => c.p === p.slug && !models.includes(c.m)).map(c => c.m)
    if (!extra.length) return p
    changed = true
    return { ...p, models: [...models, ...extra] }
  })
  return changed ? next : providers
}

export function addCustom(p: string, m: string): void {
  const s = customSlug(m)
  if (s && !isCustom(customs, p, s)) save([...customs, { p, m: s }])
}

export function removeCustom(p: string, m: string): void {
  if (isCustom(customs, p, m)) save(customs.filter(c => !(c.p === p && c.m === m)))
}

export const useCustoms = (): CustomModel[] =>
  useSyncExternalStore(
    cb => (subs.add(cb), () => subs.delete(cb)),
    () => customs
  )
