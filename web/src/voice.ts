// Voice: read replies aloud and dictate into the composer. Android does the work (TextToSpeech /
// SpeechRecognizer, see Voice.java) through the bridge; in a plain browser we fall back to the Web Speech API.
import { onSttModels } from './stt'
import { useSyncExternalStore } from 'react'
import { getState, toast } from './store'

export interface TtsVoice {
  name: string
  locale: string
  label: string
  quality: number
  online: boolean
}
export interface TtsCatalog {
  engines: Array<{ name: string; label: string }>
  engine: string
  voices: TtsVoice[]
}

interface VoiceState {
  speakingId: string | null // chat item being read, or 'auto'
  listening: boolean
  partial: string // live transcript while listening
  catalog: TtsCatalog | null // engines + voices offered by the phone (Settings → App → Voice)
  live: 'off' | 'listening' | 'thinking' | 'speaking' // hands-free conversation mode (live.ts)
  liveMuted: boolean // live mode's microphone is switched off (replies are still read aloud)
  player: Player | null // the pop-up reading player (null when nothing is being read)
}

/** What the reading player shows: where we are in the spoken text (characters), and whether it is paused. */
export interface Player {
  id: string
  total: number
  pos: number
  paused: boolean
}

let state: VoiceState = { speakingId: null, listening: false, partial: '', catalog: null, live: 'off', liveMuted: false, player: null }
const subs = new Set<() => void>()
const set = (p: Partial<VoiceState>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const setLivePhase = (live: VoiceState['live']): void => set({ live })
export const setLiveMuted = (liveMuted: boolean): void => set({ liveMuted })

/** Hooks between live mode (live.ts) and the rest of the app, kept here so gateway.ts needn't import it. */
export const liveBridge: {
  active: boolean
  onReply: (text: string) => void
  /** An approval arrived: live mode reads it out and listens for "allow" / "deny" (the sheet shows too). */
  onApproval: (req: import('@hermes/shared/json-rpc-channel').ServerRequest) => void
  /** Ends live mode (set by live.ts; gateway calls it when you open another chat). */
  stop: () => void
} = { active: false, onReply: () => {}, onApproval: () => {}, stop: () => {} }
const ttsDone = new Set<() => void>()
export const onTtsDone = (fn: () => void): (() => void) => (ttsDone.add(fn), () => ttsDone.delete(fn))

/** The current voice state (tests, and code outside React). */
export const voiceState = (): VoiceState => state
export const useVoice = <T,>(sel: (s: VoiceState) => T): T => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => sel(state))

type Listener = (kind: 'partial' | 'final' | 'error' | 'quiet' | 'end', text: string) => void
let onSpeech: Listener | null = null

declare global {
  interface Window {
    __hmVoice?: (kind: string, text: string) => void
  }
}

window.__hmVoice = (kind, text) => {
  switch (kind) {
    case 'tts-done':
      // 'stop' = the notification's ✕ (or a headset stop): final even while paused
      if (text !== 'stop' && state.player?.paused) break // we stopped it ourselves to pause
      if (text !== 'stop' && Date.now() < reseekUntil) break // the speech we just replaced (seek / speed) reporting that it ended
      nativePausedAt = null
      stopSegments()
      set({ speakingId: null, player: null })
      ttsDone.forEach(f => f())
      break
    case 'tts-seg': {
      // A new stretch of the text started playing (Android reports it as the audio reaches it).
      const [at, len] = text.split(',').map(n => parseInt(n, 10))
      if (Number.isFinite(at) && Number.isFinite(len)) startSegment(playFrom + at, len)
      break
    }
    case 'tts-pace': {
      // Voice.java's reading pace (chars/second): the page uses the same one so the bar and the time label agree with the card
      const v = Number(text)
      if (Number.isFinite(v) && v >= 2 && v <= 120) cps = v
      break
    }
    case 'tts-paused': {
      // Voice.java paused (the in-app button, the notification, a headset) or moved while paused: `text` = where in the
      // spoken text it will read on from (the start of the chunk). The page may be frozen when it happens; this catches up.
      const at = Number(text)
      if (!state.speakingId || !Number.isFinite(at)) break
      const pos = Math.min(playText.length, playFrom + at)
      nativePausedAt = pos
      stopSegments()
      const p = state.player ?? { id: state.speakingId, total: playText.length, pos, paused: true } // e.g. Live mode
      set({ player: { ...p, paused: true, pos } })
      break
    }
    case 'tts-seek': {
      // Voice.java jumped (back / forward 5 s from the card or a headset): `text` = the character it reads on from. The
      // unfinished stretch must not count as a pace measurement, so the segment is dropped, not closed.
      const at = Number(text)
      if (!state.player || !Number.isFinite(at)) break
      stopSegments()
      nativePausedAt = null
      setPos(Math.min(playText.length, playFrom + at))
      break
    }
    case 'tts-resumed':
      nativePausedAt = null
      if (state.player?.paused) set({ player: { ...state.player, paused: false } })
      break
    case 'voices':
      try {
        set({ catalog: JSON.parse(text) as TtsCatalog })
      } catch {
        /* ignore */
      }
      break
    case 'ready':
      set({ listening: true, partial: '' })
      break
    case 'stt-models':
      onSttModels(text)
      break
    case 'stt-fallback':
      // the on-device model couldn't start: Voice.java carries on with the phone's own recogniser
      toast('The on-device speech model couldn’t start, so the phone’s speech recognition is used. Check it in Settings → Voice → Speech recognition.', 'error', 8000)
      break
    case 'partial':
      set({ partial: text })
      onSpeech?.('partial', text)
      break
    case 'error':
      if (text.startsWith('tts-') || text === 'voices-failed') {
        // read-aloud, not dictation: never hand it to the dictation listener (it showed "Voice input failed")
        set({ speakingId: null, player: null })
        toast(voiceErrorText(text), 'error', 8000)
        break
      }
      onSpeech?.(kind, text)
      break
    case 'final':
    case 'quiet':
      onSpeech?.(kind, text)
      break
    case 'end':
      set({ listening: false, partial: '' })
      onSpeech?.('end', '')
      break
  }
}

const native = () => window.HermesAndroid

/** What to tell the user when dictation fails (`code` from Voice.java: stt-<SpeechRecognizer error>, stt-start, …). */
export function voiceErrorText(code: string, live = false): string {
  if (code === 'mic-denied') return live ? 'Allow the microphone to use live mode' : 'Allow the microphone to dictate'
  if (code === 'tts-unavailable')
    return 'Read-aloud isn’t working on this phone: no text-to-speech engine would start. Install “Speech Recognition & Synthesis from Google” (or another text-to-speech app), then pick it in Settings → Voice.'
  if (code === 'voices-failed') return 'Couldn’t load the voices of this text-to-speech engine.'
  if (code === 'stt-unavailable')
    return 'This phone has no speech recognition. Install the Google app (or “Speech Recognition & Synthesis from Google”) to use voice input.'
  const n = parseInt(code.replace('stt-', ''), 10)
  if (n === 1 || n === 2) return 'Voice input needs an internet connection (or an offline language pack in your voice input settings).'
  if (n === 3) return 'The microphone is busy or unavailable. Close other apps using it and try again.'
  if (n === 9) return 'Your voice input app has no microphone permission. Allow it in Android settings.'
  if (n === 12 || n === 13) return 'Voice input doesn’t have your language yet. Download it in your voice input settings.'
  if (n === 4 || n === 5 || n === 10 || n === 11 || code === 'stt-start')
    return `Voice input isn’t working on this phone (${code}). Install or update the Google app, or choose another voice input in Android settings.`
  return `Voice input failed (${code})`
}

/** Markdown → text a voice can read: no code, links, tables, media tokens, or symbols read out loud. */
export function speakable(md: string): string {
  return md
    .replace(/```openui(?:-lang)?[\s\S]*?(?:```|$)/g, ' (card shown in the app). ')
    .replace(/```[\s\S]*?```/g, ' (code omitted). ')
    .replace(/^\s*MEDIA:.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^[-=*_]{3,}\s*$/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
    .replace(/\n{2,}/g, '.\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// What the player is reading: the whole speakable text and where this stretch of speech began in it
// (Android's TextToSpeech can't pause or seek, so pause / seek / speed re-speak the rest from a position).
let playText = ''
let playFrom = 0
let reseekUntil = 0
// Where Voice.java holds its paused place (absolute position), so a resume can just say 'play'; null = it has none
// (not paused natively, or the page moved the place / changed the speed since).
let nativePausedAt: number | null = null
const showPlayer = (id: string): boolean => id !== 'live' && id !== 'test'

function setPos(pos: number): void {
  if (state.player && Math.abs(pos - state.player.pos) >= 1) set({ player: { ...state.player, pos } })
}

// Position while Android reads: it tells us when each short stretch starts, and between those moments the
// position moves at the reading speed measured on the stretches before (chars per second), never past the
// end of the current stretch. (Its per-word callbacks run while the engine synthesizes, ahead of the audio.)
let seg: { at: number; len: number; t0: number } | null = null
let cps = 0
let segTimer: ReturnType<typeof setInterval> | undefined

/** m:ss (h:mm:ss from an hour) for a number of seconds. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Characters per second the reading runs at: what Voice.java measured (tts-pace), else a typical pace scaled by the speed. */
export function readingPace(): number {
  return cps > 0 ? cps : 14 * (ttsConfig().rate || 1)
}

/** '0:12 / ~1:40': time read so far / estimated total (the '~' marks the total as an estimate from the pace). */
export function readingClock(pos: number, total: number, pace = readingPace()): string {
  const p = pace > 0 ? pace : 14
  return `${fmtClock(pos / p)} / ~${fmtClock(total / p)}`
}

function stopSegments(): void {
  seg = null
  clearInterval(segTimer)
  segTimer = undefined
}

function startSegment(at: number, len: number): void {
  const now = Date.now()
  if (seg && now > seg.t0) {
    const measured = (seg.len / (now - seg.t0)) * 1000
    cps = cps ? cps * 0.5 + measured * 0.5 : measured
  }
  seg = { at, len, t0: now }
  setPos(at)
  if (!segTimer) segTimer = setInterval(tickSegment, 200)
}

function tickSegment(): void {
  if (!state.player) return stopSegments()
  if (!seg || state.player.paused) return
  const rate = cps || 14 * (ttsConfig().rate || 1)
  setPos(Math.min(seg.at + seg.len, seg.at + ((Date.now() - seg.t0) / 1000) * rate))
}

function say(id: string, from: number, reseek = false): void {
  reseekUntil = reseek ? Date.now() + 300 : 0
  stopSegments()
  if (!reseek) cps = 0
  const text = playText.slice(from)
  playFrom = from
  nativePausedAt = null
  set({ speakingId: id, player: showPlayer(id) ? { id, total: playText.length, pos: from, paused: false } : null })
  const n = native()
  if (n?.speak) {
    // notify: the "Reading aloud" card with pause / skip / stop (not for the Settings voice test)
    const chat = getState().active
    n.speak(text, JSON.stringify({ ...ttsConfig(), base: from, notify: id !== 'test', title: chat?.title || '', session: chat?.storedId || '' }))
  }
  else if ('speechSynthesis' in window) {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = ttsConfig().rate
    u.onboundary = e => state.player && !state.player.paused && setPos(Math.min(playText.length, from + e.charIndex))
    u.onend = u.onerror = () => {
      if (state.player?.paused) return
      set({ speakingId: null, player: null })
    }
    speechSynthesis.speak(u)
  } else set({ speakingId: null, player: null })
}

export function speak(id: string, markdown: string): void {
  const text = speakable(markdown)
  if (!text) return
  playText = text
  say(id, 0)
}

export function stopSpeaking(): void {
  const n = native()
  if (n?.stopSpeaking) n.stopSpeaking()
  else if ('speechSynthesis' in window) speechSynthesis.cancel()
  set({ speakingId: null, player: null })
}

/** Pause = stop speaking but keep the position (resume reads on from there). */
export function pauseSpeaking(): void {
  const p = state.player
  if (!p || p.paused) return
  set({ player: { ...p, paused: true } })
  const n = native()
  // Voice.java keeps the place (one state with the notification); its tts-paused moves pos to the chunk start
  if (n?.ttsControl) n.ttsControl('pause')
  else if (n?.stopSpeaking) n.stopSpeaking()
  else if ('speechSynthesis' in window) speechSynthesis.cancel()
}

export function resumeSpeaking(): void {
  const p = state.player
  if (!p?.paused) return
  const n = native()
  if (n?.ttsControl && nativePausedAt !== null && Math.abs(p.pos - nativePausedAt) < 1) {
    nativePausedAt = null
    set({ player: { ...p, paused: false } })
    n.ttsControl('play')
  } else say(p.id, Math.min(p.pos, Math.max(0, p.total - 1)), true)
}

/** Jump to a character position. Keeps paused if it was paused. */
export function seekSpeaking(pos: number): void {
  const p = state.player
  if (!p) return
  const to = Math.max(0, Math.min(p.total - 1, Math.round(pos)))
  if (p.paused) set({ player: { ...p, pos: to } })
  else say(p.id, to, true)
}

export const JUMP_SECONDS = 5

/** Back (-1) / forward (+1) 5 s. In the app it is the card's own path (Voice.java), so there is one state; else the browser voice. */
export function jumpSpeaking(dir: -1 | 1): void {
  const p = state.player
  if (!p) return
  const n = native()
  const shared = n?.ttsControl && (!p.paused || (nativePausedAt !== null && Math.abs(p.pos - nativePausedAt) < 1))
  if (shared && n?.ttsControl) n.ttsControl(dir < 0 ? 'rew' : 'ff')
  else seekSpeaking(p.pos + dir * JUMP_SECONDS * readingPace())
}

/** Reading speed from the player: saved like the Settings slider, applied from the current position. */
export function setReadingSpeed(rate: number): void {
  if (cps) cps = (cps * rate) / (ttsConfig().rate || 1) // the measured pace scales with the speed
  saveTtsConfig({ ...ttsConfig(), rate })
  const p = state.player
  if (p && !p.paused) say(p.id, p.pos, true)
  else {
    nativePausedAt = null // Voice.java would resume at the old speed: re-speak instead
    set({})
  }
}

export function toggleSpeak(id: string, markdown: string): void {
  if (state.speakingId === id) stopSpeaking()
  else speak(id, markdown)
}

export function voiceInputAvailable(): boolean {
  return Boolean(native()?.startListening)
}

export function startListening(cb: Listener): void {
  onSpeech = cb
  set({ speakingId: null, player: null })
  native()?.startListening?.()
}

/** Live mode's barge-in: listen while a reply is being read, without stopping it (only the phone app can). */
export const canListenOver = (): boolean => !!native()?.startListeningOver
export function startListeningOver(cb: Listener): void {
  onSpeech = cb
  native()?.startListeningOver?.()
}

export function stopListening(): void {
  native()?.stopListening?.()
}

// ── read-aloud mode ──────────────────────────────────────────
// On for every chat (Settings) or for one chat (chat ⋮ menu). A per-chat choice wins over the global one.
// While the app is on screen the page speaks; otherwise the background service does (see HermesService),
// so replies are read with the phone locked or the app closed. Both need this mode copied to the native side.
const AUTO = 'hm.autoread'
const AUTO_CHATS = 'hm.autoread.chats'

function readChats(): Record<string, boolean> {
  try {
    const o = JSON.parse(localStorage.getItem(AUTO_CHATS) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

let auto = { global: (() => { try { return localStorage.getItem(AUTO) === '1' } catch { return false } })(), chats: readChats() }
const autoSubs = new Set<() => void>()

function pushAuto(): void {
  try {
    localStorage.setItem(AUTO, auto.global ? '1' : '0')
    localStorage.setItem(AUTO_CHATS, JSON.stringify(auto.chats))
  } catch {
    /* ignore */
  }
  syncReadAloud()
  autoSubs.forEach(f => f())
}

/** Copy the mode + voice settings to the Android service (so it can read replies in the background). */
export function syncReadAloud(): void {
  const n = window.HermesAndroid as unknown as { setReadAloud?: (j: string) => void } | undefined
  n?.setReadAloud?.(JSON.stringify({ global: auto.global, sessions: auto.chats, tts: ttsConfig() }))
}

export const autoReadOn = (): boolean => auto.global
export const setAutoRead = (on: boolean): void => {
  auto = { ...auto, global: on }
  pushAuto()
}
/** Effective mode for a chat: its own choice if it has one, else the global setting. */
export const autoReadFor = (storedId?: string | null): boolean =>
  storedId != null && storedId in auto.chats ? auto.chats[storedId] : auto.global
export const hasChatOverride = (storedId?: string | null): boolean => storedId != null && storedId in auto.chats

/** Turn read-aloud on/off for one chat. Choosing what the global setting already is clears the override. */
export function setAutoReadFor(storedId: string, on: boolean): void {
  const chats = { ...auto.chats }
  if (on === auto.global) delete chats[storedId]
  else chats[storedId] = on
  auto = { ...auto, chats }
  pushAuto()
}

// The empty "new chat" screen has no chat id yet: remember the choice and apply it when the chat is created.
let draftRead: boolean | null = null
export const draftReadValue = (): boolean => (draftRead === null ? auto.global : draftRead)
export function setDraftRead(on: boolean | null): void {
  draftRead = on
  autoSubs.forEach(f => f())
}
/** Called when a new chat gets its id: give it the choice made on the empty screen. */
export function applyDraftRead(storedId: string): void {
  const d = draftRead
  draftRead = null
  if (d !== null) setAutoReadFor(storedId, d)
}
export function useDraftAutoRead(): boolean {
  return useSyncExternalStore(
    cb => (autoSubs.add(cb), () => autoSubs.delete(cb)),
    () => draftReadValue()
  )
}

export function useAutoRead(storedId?: string | null): boolean {
  return useSyncExternalStore(
    cb => (autoSubs.add(cb), () => autoSubs.delete(cb)),
    () => autoReadFor(storedId)
  )
}

// ── voice settings (Settings → App → Voice) ──────────────────
export interface TtsConfig {
  engine: string // package name; '' = the phone's default engine
  voice: string // voice name; '' = default for the phone's language
  rate: number // 0.5 – 2
  pitch: number // 0.5 – 2
}
const TTS = 'hm.tts'
export function ttsConfig(): TtsConfig {
  try {
    const o = JSON.parse(localStorage.getItem(TTS) || '{}')
    return {
      engine: typeof o.engine === 'string' ? o.engine : '',
      voice: typeof o.voice === 'string' ? o.voice : '',
      rate: Number.isFinite(o.rate) ? o.rate : 1,
      pitch: Number.isFinite(o.pitch) ? o.pitch : 1
    }
  } catch {
    return { engine: '', voice: '', rate: 1, pitch: 1 }
  }
}
export function saveTtsConfig(c: TtsConfig): void {
  try {
    localStorage.setItem(TTS, JSON.stringify(c))
  } catch {
    /* ignore */
  }
  syncReadAloud()
}

/** Ask the phone which engines/voices exist (result arrives in the store as `catalog`). */
export function loadVoices(): void {
  native()?.listVoices?.(JSON.stringify(ttsConfig()))
}

export const ttsAvailable = (): boolean => Boolean(native()?.listVoices)

export function testVoice(): void {
  speak('test', 'This is how Hermes will sound when reading your replies aloud.')
}

// Tell the service about the current mode as soon as the page loads.
syncReadAloud()
