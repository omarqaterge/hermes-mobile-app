// Wide screens (tablets, unfolded foldables, landscape; styles.css `@media (min-width: 840px)`) dock the chat list as a
// column on the left. The user can hide that column (☰ in the chat header, or « at the top of the list) to give the
// chat and the sheets the whole width; the choice is remembered in localStorage hm.sideHidden.v1. While hidden, the
// layout is the phone one: a swipe right opens the list over the chat, and ☰ docks it again.
// The CSS reads it from `html[data-side="hidden"]`, so the column never flashes in before React starts.
import { useSyncExternalStore } from 'react'
import { setState } from './store'

const KEY = 'hm.sideHidden.v1'
const WIDE = window.matchMedia('(min-width: 840px)')
const subs = new Set<() => void>()

let hidden = (() => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

function apply() {
  if (hidden) document.documentElement.dataset.side = 'hidden'
  else delete document.documentElement.dataset.side
}
apply()

export function sideHidden(): boolean {
  return hidden
}

export function setSideHidden(v: boolean) {
  hidden = v
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: still applies for this run */
  }
  apply()
  // The overlay drawer (phone layout) must not stay open under a docked column.
  setState({ drawer: false })
  subs.forEach(f => f())
}

export function toggleSide() {
  setSideHidden(!hidden)
}

function subscribe(f: () => void) {
  subs.add(f)
  WIDE.addEventListener?.('change', f)
  return () => {
    subs.delete(f)
    WIDE.removeEventListener?.('change', f)
  }
}

/** [wide screen?, chat list hidden?] for the header button. */
export function useSidePanel(): [boolean, boolean] {
  const wide = useSyncExternalStore(subscribe, () => WIDE.matches)
  const h = useSyncExternalStore(subscribe, () => hidden)
  return [wide, h]
}
