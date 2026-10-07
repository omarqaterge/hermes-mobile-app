// Live "what is Hermes doing" feed for the banner: polls the plugin's /activity while the app is open.
// It covers work the chat stream doesn't show, e.g. the background memory/skills review after a reply.
import { api } from './api'
import { loadSessionsSoon } from './gateway'
import { getState, setState, type ActivityItem } from './store'

let timer: ReturnType<typeof setInterval> | null = null

async function poll(): Promise<void> {
  if (document.visibilityState !== 'visible' || getState().conn !== 'open') return
  try {
    const r = await api<{ items: ActivityItem[] }>('GET', '/api/plugins/hermes-mobile/activity')
    const items = r.items ?? []
    const before = getState().activity
    if (JSON.stringify(items) !== JSON.stringify(before)) {
      setState({ activity: items })
      // A chat stopped working (its reply is in): refresh the list so its unread dot and time show.
      if (before.some(b => !items.some(i => i.session === b.session))) loadSessionsSoon()
    }
  } catch {
    /* keep the last value; the connection banner covers outages */
  }
}

/** What ActivityBanner shows: everything except the open chat's own live turn (it has the status line). */
export function bannerItems(items: ActivityItem[], activeId: string | undefined, running: boolean): ActivityItem[] {
  return items.filter(i => !(running && i.session === activeId && !i.review))
}

function bannerVisible(items: ActivityItem[], activeId: string | undefined, running: boolean): boolean {
  return bannerItems(items, activeId, running).length > 0
}

export function startActivityPolling(): void {
  if (timer) return
  void poll()
  // Every 3 s while the banner shows something (another chat working, the review after a reply), once right after
  // the open chat's turn ends (its review starts then), every 9 s otherwise: the open chat's own turn is not in
  // the banner, and each poll also wakes Hermes's dashboard (battery).
  let tick = 0
  let wasRunning = false
  timer = setInterval(() => {
    tick++
    const s = getState()
    const running = Boolean(s.active?.running)
    const ended = wasRunning && !running
    wasRunning = running
    if (bannerVisible(s.activity, s.active?.storedId, running) || ended || tick % 3 === 0) void poll()
  }, 3000)
  document.addEventListener('visibilitychange', () => void poll())
}
