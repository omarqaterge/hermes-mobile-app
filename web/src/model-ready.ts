// Can the current bot think yet? The setup check's own question (`modelConnected`, Setup.tsx: Hermes's
// setup.runtime_check), shared by the places that show a "connect a model" hint: the empty new-chat screen, the Settings
// main page's Connect a model card and the Models page. No polling: it is asked once per bot while the connection is
// open (`fresh` asks again each time the asking screen opens, as the Settings main page always did), and again after a
// provider was connected or a model chosen (`recheckModel`). A dropped connection forgets the answers.
import { useEffect, useSyncExternalStore } from 'react'
import { getState, subscribe, useStore } from './store'
import { modelConnected } from './components/Setup'

const answers = new Map<string, boolean | null>()
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

function ask(profile: string): void {
  if (asking.has(profile)) return
  asking.add(profile)
  void modelConnected()
    .then(v => {
      if (getState().conn !== 'open') return
      answers.set(profile, v)
      changed()
    })
    .finally(() => asking.delete(profile))
}

/** Ask again for the current bot (a provider was connected or removed, or a model chosen). */
export function recheckModel(): void {
  if (getState().conn === 'open') ask(getState().profile)
}

/** true: the bot has a working model; false: it has none; null: not known (offline, or no answer yet). */
export function useModelReady({ fresh = false }: { fresh?: boolean } = {}): boolean | null {
  const conn = useStore(s => s.conn)
  const profile = useStore(s => s.profile)
  useSyncExternalStore(
    f => (subs.add(f), () => subs.delete(f)),
    () => version
  )
  useEffect(() => {
    if (conn !== 'open') return
    if (fresh || !answers.has(profile)) ask(profile)
  }, [conn, profile, fresh])
  return conn === 'open' ? (answers.get(profile) ?? null) : null
}
