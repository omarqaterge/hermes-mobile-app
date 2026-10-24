import { useSyncExternalStore } from 'react'
import { rpc, errText } from './gateway'
import { getState } from './store'

/** A /btw side chat: questions about the open chat that run on a snapshot of it, detached from the main turn. */
export interface BtwMsg {
  id: string
  q: string
  a: string | null // null = waiting
  error?: boolean
}

let state: { open: boolean; session: string; msgs: BtwMsg[] } = { open: false, session: '', msgs: [] }
const listeners = new Set<() => void>()
const set = (p: Partial<typeof state>) => {
  state = { ...state, ...p }
  listeners.forEach(l => l())
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export const useBtw = () => useSyncExternalStore(subscribe, () => state)

const tasks = new Map<string, string>() // task_id → message id
let seq = 0

/** Open the mini chat for the current chat (a different chat starts a fresh one), optionally asking right away. */
export function openBtw(question = ''): void {
  const sid = getState().active?.runtimeId || ''
  set({ open: true, session: sid, msgs: sid === state.session ? state.msgs : [] })
  if (question.trim()) void askBtw(question)
}

export const btwOpen = (): boolean => state.open

export function closeBtw(): void {
  set({ open: false })
}

export async function askBtw(question: string): Promise<void> {
  const a = getState().active
  const q = question.trim()
  if (!a || !q) return
  const id = `btw${++seq}`
  // Each call sees a fresh snapshot of the main chat; earlier side answers ride along so follow-ups make sense.
  const prior = state.msgs.filter(m => m.a && !m.error).slice(-6)
  const text = prior.length ? `Earlier side questions:\n${prior.map(m => `Q: ${m.q}\nA: ${m.a}`).join('\n\n')}\n\nNew question: ${q}` : q
  set({ msgs: [...state.msgs, { id, q, a: null }] })
  const patch = (p: Partial<BtwMsg>) => set({ msgs: state.msgs.map(m => (m.id === id ? { ...m, ...p } : m)) })
  try {
    const r = await rpc<{ task_id: string }>('prompt.btw', { session_id: a.runtimeId, text })
    tasks.set(r.task_id, id)
    setTimeout(() => {
      if (tasks.delete(r.task_id)) patch({ a: 'No answer came back.', error: true })
    }, 180000)
  } catch (e) {
    patch({ a: errText(e), error: true })
  }
}

/** Called for every btw.complete event; true = it belonged to the mini chat. */
export function btwDone(taskId: string, text: string): boolean {
  const id = tasks.get(taskId)
  if (!id) return false
  tasks.delete(taskId)
  set({ msgs: state.msgs.map(m => (m.id === id ? { ...m, a: text || '(empty answer)' } : m)) })
  return true
}
