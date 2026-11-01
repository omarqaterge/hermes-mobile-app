// The drawer's "N msgs" counts the messages the user sent: session.list's message_count also counts every reply and
// tool call. The plugin counts them (POST /sent-counts); a chat is asked again only when its message_count moved.
import { api } from './api'
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'
import { getState, setState } from './store'

/** message_count each chat had when its sent count was last fetched. */
const seenAt = new Map<string, number>()

export async function loadSentCounts(rows: SessionListRow[]): Promise<void> {
  const known = getState().sentCounts
  const stale = rows.filter(r => !(r.id in known) || seenAt.get(r.id) !== (r.message_count ?? 0))
  if (!stale.length) return
  try {
    const r = await api<{ counts?: Record<string, number> }>('POST', '/api/plugins/hermes-mobile/sent-counts', {
      ids: stale.map(s => s.id)
    })
    for (const s of stale) seenAt.set(s.id, s.message_count ?? 0)
    setState({ sentCounts: { ...getState().sentCounts, ...(r.counts ?? {}) } })
  } catch {
    /* an older plugin, or Hermes restarting: the rows show no count until the next list */
  }
}
