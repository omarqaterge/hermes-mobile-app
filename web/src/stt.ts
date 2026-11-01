// On-device dictation models (the Android shell's LocalStt): what Settings → Voice → Speech recognition shows.
// The shell owns the files and downloads; the page asks for the list (listSttModels) and gets every change through
// window.__hmVoice('stt-models', json), which voice.ts hands to onSttModels.
import { useSyncExternalStore } from 'react'

export interface SttTest {
  ok?: boolean
  text?: string
  wer?: number // word error rate on the sample (0 = every word right)
  ms?: number // time to transcribe it
  audioMs?: number // length of the sample
  loadMs?: number
  error?: string
}

export interface SttModel {
  id: string
  name: string
  kind: string
  size: number // bytes to download (catalogue) or on the phone (your own)
  onDisk?: number
  live: boolean // words appear while you speak
  punctuation: boolean
  good?: string
  weak?: string
  licence?: string
  recommended?: boolean
  custom: boolean
  source?: string
  state: 'none' | 'downloading' | 'checking' | 'ready' | 'failed'
  done?: number
  total?: number
  error?: string
  test?: SttTest
}

export interface SttList {
  chosen: string // '' = the phone's own speech recognition
  sample?: string
  importing?: string
  importError?: string
  models: SttModel[]
}

interface SttBridge {
  listSttModels?(): string
  downloadSttModel?(id: string): void
  cancelSttDownload?(id: string): void
  deleteSttModel?(id: string): void
  setSttModel?(id: string): void
  testSttModel?(id: string): void
  addSttModelUrl?(url: string): void
  pickSttModelFiles?(): void
}

const native = () => window.HermesAndroid as unknown as SttBridge | undefined

let list: SttList | null = null
const subs = new Set<() => void>()

function parse(json: string): SttList | null {
  try {
    const o = JSON.parse(json) as SttList
    return Array.isArray(o?.models) ? o : null
  } catch {
    return null
  }
}

/** voice.ts: the shell's 'stt-models' event. */
export function onSttModels(json: string): void {
  const next = parse(json)
  if (!next) return
  list = next
  subs.forEach(f => f())
}

export const sttAvailable = (): boolean => Boolean(native()?.listSttModels)

export function loadSttModels(): void {
  const json = native()?.listSttModels?.()
  if (json) onSttModels(json)
}

export const useSttModels = (): SttList | null => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => list)

export const downloadSttModel = (id: string): void => native()?.downloadSttModel?.(id)
export const cancelSttDownload = (id: string): void => native()?.cancelSttDownload?.(id)
export const deleteSttModel = (id: string): void => native()?.deleteSttModel?.(id)
export const chooseSttModel = (id: string): void => native()?.setSttModel?.(id)
export const testSttModel = (id: string): void => native()?.testSttModel?.(id)
export const addSttModelUrl = (url: string): void => native()?.addSttModelUrl?.(url)
export const pickSttModelFiles = (): void => native()?.pickSttModelFiles?.()

/** "140 MB" / "1.2 GB" */
export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** The row value on the Voice page: the chosen model's name, or the phone's recogniser. */
export function chosenSttName(l: SttList | null): string {
  const m = l?.models.find(x => x.id === l.chosen && x.state === 'ready')
  return m ? m.name.replace(/ \(English\)$/, '') : 'Phone’s speech recognition'
}

/** "Heard 17 of 17 words right · 0.6 s for 6.6 s of speech" */
export function testSummary(t: SttTest, sample?: string): string {
  const words = (sample || '').split(/\s+/).filter(Boolean).length
  const right = t.wer != null && words ? Math.max(0, Math.round(words * (1 - t.wer))) : null
  const speed = t.ms != null && t.audioMs ? `${(t.ms / 1000).toFixed(1)} s for ${(t.audioMs / 1000).toFixed(1)} s of speech` : ''
  return [right != null ? `${right} of ${words} words right` : '', speed].filter(Boolean).join(' · ')
}
