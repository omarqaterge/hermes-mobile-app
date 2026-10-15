// Starred models (localStorage hm.favModels.v1: [{ p: provider slug, m: model }], in the order starred). Shared by all
// profiles: a favourite whose provider isn't signed in on this profile just doesn't show.
import { useSyncExternalStore } from 'react'

export type FavModel = { p: string; m: string }

const KEY = 'hm.favModels.v1'
const subs = new Set<() => void>()

function read(): FavModel[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter(x => x && typeof x.p === 'string' && typeof x.m === 'string') : []
  } catch {
    return []
  }
}

let favs = read()

export const isFav = (list: FavModel[], p: string, m: string) => list.some(f => f.p === p && f.m === m)

export function toggleFav(p: string, m: string): void {
  favs = isFav(favs, p, m) ? favs.filter(f => !(f.p === p && f.m === m)) : [...favs, { p, m }]
  try {
    localStorage.setItem(KEY, JSON.stringify(favs))
  } catch {
    /* ignore */
  }
  subs.forEach(cb => cb())
}

export const useFavs = (): FavModel[] =>
  useSyncExternalStore(
    cb => (subs.add(cb), () => subs.delete(cb)),
    () => favs
  )
