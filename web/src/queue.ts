// Follow-ups typed while Hermes works (localStorage hm.queue.v1: stored chat id → messages, oldest first).
// They wait in the page and are sent one by one when the chat's turn ends (the draining lives in gateway.ts).
import { useSyncExternalStore } from 'react'
import { newId } from './store'

const KEY = 'hm.queue.v1'
export const QUEUE_MAX = 10

export interface Queued {
  id: string
  text: string
  at: number
}

const NONE: Queued[] = []
const listeners = new Set<() => void>()
let version = 0
let mem: Record<string, Queued[]> = {} // used when localStorage is unavailable
let lastRaw: string | null | undefined
let lastAll: Record<string, Queued[]> = {}
const paused = new Set<string>() // in memory only: a chat opens paused and pauses after an error or Stop

function valid(v: unknown): v is Queued {
  const q = v as Queued
  return !!q && typeof q.id === 'string' && typeof q.text === 'string' && typeof q.at === 'number'
}

function all(): Record<string, Queued[]> {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return mem
  }
  if (raw === lastRaw) return lastAll
  lastRaw = raw
  const out: Record<string, Queued[]> = {}
  try {
    const m = JSON.parse(raw || '{}')
    if (m && typeof m === 'object' && !Array.isArray(m))
      for (const [k, v] of Object.entries(m)) if (Array.isArray(v)) {
        const l = v.filter(valid)
        if (l.length) out[k] = l
      }
  } catch {
    /* corrupt: start empty */
  }
  lastAll = out
  return out
}

function save(m: Record<string, Queued[]>): void {
  mem = m
  try {
    const raw = JSON.stringify(m)
    localStorage.setItem(KEY, raw)
    lastRaw = raw
    lastAll = m
  } catch {
    /* ignore */
  }
  version++
  listeners.forEach(l => l())
}

const put = (chat: string, list: Queued[]) => {
  const m = { ...all() }
  if (list.length) m[chat] = list
  else delete m[chat]
  save(m)
}

export function queuedFor(chat: string): Queued[] {
  return all()[chat] || NONE
}

/** Add a message at the end; null when the chat already has QUEUE_MAX. */
export function enqueue(chat: string, text: string): Queued | null {
  const l = queuedFor(chat)
  if (l.length >= QUEUE_MAX) return null
  const q = { id: newId('q'), text, at: Date.now() }
  put(chat, [...l, q])
  return q
}

export function editQueued(chat: string, id: string, text: string): void {
  put(chat, queuedFor(chat).map(q => (q.id === id ? { ...q, text } : q)))
}

export function removeQueued(chat: string, id: string): Queued | null {
  const l = queuedFor(chat)
  const q = l.find(x => x.id === id) || null
  if (q) put(chat, l.filter(x => x.id !== id))
  return q
}

export function takeFirst(chat: string): Queued | null {
  const l = queuedFor(chat)
  if (!l.length) return null
  put(chat, l.slice(1))
  return l[0]
}

/** Put a message back at the front (a send that failed). */
export function restoreFirst(chat: string, q: Queued): void {
  put(chat, [q, ...queuedFor(chat).filter(x => x.id !== q.id)])
}

/** Drop a chat's queue (the chat was deleted). */
export function clearQueue(chat: string): void {
  paused.delete(chat)
  if (all()[chat]) put(chat, [])
}

export function isPaused(chat: string): boolean {
  return paused.has(chat)
}

export function setPaused(chat: string, p: boolean): void {
  if (paused.has(chat) === p) return
  if (p) paused.add(chat)
  else paused.delete(chat)
  version++
  listeners.forEach(l => l())
}

export function useQueue(chat: string | undefined): { items: Queued[]; paused: boolean } {
  useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
  return { items: chat ? queuedFor(chat) : NONE, paused: chat ? paused.has(chat) : false }
}
