// Start-up timing: where the seconds go between launch and a usable chat (ms since the page started loading).
// Read it in Settings → About → Last start-up; the native side logs its own stages to logcat (tag hmboot).
import { useSyncExternalStore } from 'react'

const KEY = 'hm.boot.v1'
let marks: Array<[string, number]> = []
const subs = new Set<() => void>()

/** Note a start-up stage, the first time only (a later reconnect doesn't move it). */
export function bootMark(stage: string, ms: number = Math.round(performance.now())): void {
  if (marks.some(m => m[0] === stage)) return
  marks.push([stage, ms])
  console.info(`[hm-boot] ${stage} +${ms}ms`)
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Math.round(performance.timeOrigin), marks }))
  } catch {
    /* quota: timing is best effort */
  }
  subs.forEach(fn => fn())
}

/** The marks of the latest start-up (this one, or the previous run's before this one has any). */
export function lastBoot(): Array<[string, number]> {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}')?.marks
    return Array.isArray(m) ? m : []
  } catch {
    return []
  }
}

/** "script 0.1s · token 0.9s · …" */
export const bootSummary = (m: Array<[string, number]>): string => m.map(([s, ms]) => `${s} ${(ms / 1000).toFixed(1)}s`).join(' · ')

/** Call `fn` after each new mark; returns the way to stop. */
export function onBootMark(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** The Last start-up line, kept current: marks can arrive while Settings is open (Hermes restarting). */
export const useBootSummary = (): string => useSyncExternalStore(onBootMark, () => bootSummary(lastBoot()))

export function resetBootForTest(): void {
  marks = []
}
