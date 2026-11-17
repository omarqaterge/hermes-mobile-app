// Pins + custom chat order, per profile: kept in localStorage, mirrored to the phone's Hermes
// (plugin /prefs, newest wins) and shared by everything that shows or changes them (drawer, chat menu).
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'

export interface Order {
  pinned: string[]
  manual: string[] | null // null = group by date (most recent first)
  at?: number // last change (ms); the newest copy wins when syncing with the phone's Hermes
}

const KEY = (p: string) => `hm.order.v1.${p}`
const PREFS = '/api/plugins/hermes-mobile/prefs'

function load(profile: string): Order {
  try {
    const o = JSON.parse(localStorage.getItem(KEY(profile)) || 'null')
    if (o && Array.isArray(o.pinned)) return { pinned: o.pinned, manual: Array.isArray(o.manual) ? o.manual : null, at: Number(o.at) || 0 }
  } catch {
    /* fresh */
  }
  return { pinned: [], manual: null }
}

function saveLocal(profile: string, o: Order) {
  try {
    localStorage.setItem(KEY(profile), JSON.stringify(o))
  } catch {
    /* ignore */
  }
}

const cache = new Map<string, Order>()
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export function getOrder(profile: string): Order {
  let o = cache.get(profile)
  if (!o) {
    o = load(profile)
    cache.set(profile, o)
  }
  return o
}

let pushTimer: ReturnType<typeof setTimeout> | null = null
function push(o: Order) {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    api('PUT', PREFS, { pinned: o.pinned, manual: o.manual, at: o.at || 0 }).catch(() => {})
  }, 1000)
}

export function updateOrder(profile: string, fn: (o: Order) => Order): void {
  const next = { ...fn(getOrder(profile)), at: Date.now() }
  cache.set(profile, next)
  saveLocal(profile, next)
  emit()
  push(next)
}

const synced = new Set<string>()
/** Pull the phone's copy once per profile per run; adopt it if newer, else upload ours (debounced like any change). The
 *  local copy is compared as it is when the answer arrives, not when it was asked for: a pin or a reorder made while the
 *  answer was on its way is newer than the phone's copy and must not be overwritten by it. */
export function syncOrder(profile: string): void {
  if (synced.has(profile)) return
  synced.add(profile)
  api<{ order: Order | null }>('GET', PREFS)
    .then(r => {
      const local = getOrder(profile)
      const remote = r.order
      if (remote && Array.isArray(remote.pinned) && (remote.at || 0) > (local.at || 0)) {
        const next: Order = { pinned: remote.pinned, manual: Array.isArray(remote.manual) ? remote.manual : null, at: remote.at }
        cache.set(profile, next)
        saveLocal(profile, next)
        emit()
      } else if ((local.at || 0) > (remote?.at || 0) || (!remote && (local.pinned.length || local.manual))) {
        const o = { ...local, at: local.at || Date.now() }
        cache.set(profile, o)
        saveLocal(profile, o)
        push(o) // the same debounced upload as a change: one PUT, the newest copy, when a change is already on its way
      }
    })
    .catch(() => synced.delete(profile)) // retry on the next mount
}

export function useOrder(profile: string) {
  const order = useSyncExternalStore(
    cb => (subs.add(cb), () => subs.delete(cb)),
    () => getOrder(profile)
  )
  useEffect(() => syncOrder(profile), [profile])
  const setOrder = (fn: (o: Order) => Order) => updateOrder(profile, fn)
  return [order, setOrder] as const
}
