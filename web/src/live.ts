// Live mode: a hands-free voice conversation.
//   listen → (you pause for 2 s) → send what you said → wait for the reply → read it aloud → listen again …
// until you press the button again. Interrupt cuts the reading short and listens at once.
// Android does the listening/speaking (Voice.java); this is the loop.
// The microphone is off while Hermes thinks. While it speaks it stays on (barge-in, a setting): what it hears is
// compared with what Hermes is saying, and only words that aren't Hermes's own echo cut it off.
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { answerRequest, errText, sendPrompt } from './gateway'
import { leaveLockView } from './lockview'
import { getState, toast } from './store'
import { canListenOver, liveBridge, onTtsDone, setLiveMuted, setLivePhase, speak, speakable, startListening, startListeningOver, stopListening, stopSpeaking, voiceErrorText, voiceInputAvailable } from './voice'

const PAUSE_KEY = 'hm.live.pause'
/** Seconds of silence after your last words before the message is sent (Settings → Voice). */
export function getLivePause(): number {
  try {
    const v = parseFloat(localStorage.getItem(PAUSE_KEY) || '')
    return v >= 0.5 && v <= 10 ? v : 2
  } catch {
    return 2
  }
}
export function setLivePause(sec: number): void {
  try {
    localStorage.setItem(PAUSE_KEY, String(sec))
  } catch {
    /* ignore */
  }
}
const BARGE_KEY = 'hm.live.bargein'
/** Talking while Hermes speaks cuts it off (Settings → Voice → Live mode → Interrupt by talking; on by default). */
export function getLiveBargeIn(): boolean {
  try {
    return localStorage.getItem(BARGE_KEY) !== '0'
  } catch {
    return true
  }
}
export function setLiveBargeIn(on: boolean): void {
  try {
    localStorage.setItem(BARGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
/** Barge-in can work here: the setting is on and the phone app can listen while it speaks. */
export const bargeInAvailable = (): boolean => getLiveBargeIn() && canListenOver()

const THINK_MAX_MS = 10 * 60_000 // give up waiting for a reply after this and listen again
const IDLE_MAX_MS = 5 * 60_000 // live mode ends itself after this long without any speech (it sends what it hears to an agent that can run commands)

let buffer = '' // finished phrases of the current message
let partial = '' // the phrase being recognised right now
let phase: 'off' | 'listening' | 'thinking' | 'speaking' = 'off'
let pauseTimer: ReturnType<typeof setTimeout> | null = null
let thinkTimer: ReturnType<typeof setTimeout> | null = null
let unTts: (() => void) | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let muted = false // mic off, session still running
// The pause ran out while the last phrase was only a preview (an on-device model finishes a phrase a moment after you
// stop, and its previews lag behind): wait this long for the phrase itself before sending, so no words are cut off.
const FINAL_WAIT_MS = 1500
let finalWait = false
// Barge-in: the microphone is on while Hermes speaks (`over`). `spoken` holds the words of what it is saying, so its
// own voice coming back through the microphone can be told from yours.
let over = false
let spoken = new Set<string>()

const wordsOf = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean)
const STOP_WORDS = new Set(['stop', 'wait', 'hold', 'enough', 'pause', 'quiet', 'shush', 'hermes'])

/** Words heard while Hermes speaks: the user (true) or Hermes's own voice through the microphone (false). Two or more
 * words, most of them not in what Hermes is saying, are the user; so is a lone stop word ("stop", "wait"…) that Hermes
 * isn't saying. One stray word is not enough: a misheard echo would cut every long reply. */
export function isUserSpeech(heard: string, spokenWords: Set<string>): boolean {
  const w = wordsOf(heard)
  const novel = w.filter(x => !spokenWords.has(x))
  if (w.length === 1) return novel.length === 1 && STOP_WORDS.has(novel[0])
  return novel.length >= 2 && novel.length / w.length > 0.5
}
/** Only stop words: you cut Hermes off, there is nothing to send. */
const onlyStop = (t: string): boolean => wordsOf(t).every(x => STOP_WORDS.has(x))

export const liveAvailable = (): boolean => voiceInputAvailable()
export const liveOn = (): boolean => phase !== 'off'

const join = (a: string, b: string) => [a, b].filter(Boolean).join(' ').trim()

function clearTimers() {
  if (pauseTimer) clearTimeout(pauseTimer)
  if (thinkTimer) clearTimeout(thinkTimer)
  if (idleTimer) clearTimeout(idleTimer)
  pauseTimer = thinkTimer = idleTimer = null
  finalWait = false
}

/** (Re)start the "nobody is talking" countdown; any recognised speech resets it. */
function armIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (phase !== 'listening') return
    toast('Live mode ended: no speech for 5 minutes')
    stopLive()
  }, IDLE_MAX_MS)
}

function goto(p: typeof phase) {
  phase = p
  setLivePhase(p)
}

function listen() {
  if (phase === 'off') return
  clearTimers()
  buffer = ''
  partial = ''
  goto('listening')
  if (muted) return // stay on, but with the microphone closed until the user unmutes
  armIdle()
  over = false
  startListening(hear)
}

/** What the recogniser hears, in every phase. */
function hear(kind: 'partial' | 'final' | 'error' | 'quiet' | 'end', t: string) {
  if (phase === 'speaking' && over) return overheard(kind, t)
  if (phase !== 'listening' || muted) return // late words after we already sent, after stopping, or while muted
  if (kind === 'partial') {
    partial = t
    armIdle()
    arm() // still speaking: restart the 2 s countdown
  } else if (kind === 'final') {
    buffer = join(buffer, t)
    partial = ''
    if (finalWait) {
      // the phrase we were waiting for: send now
      if (pauseTimer) clearTimeout(pauseTimer)
      fire()
    } else if (!pauseTimer) arm() // a phrase that arrived only as a final still counts as speech
  } else if (kind === 'error') {
    toast(voiceErrorText(t, true), 'error', 8000)
    stopLive()
  } else if (kind === 'end') {
    // The recogniser stopped by itself (not because we sent): start it again.
    setTimeout(() => phase === 'listening' && !muted && !pauseTimer && listen(), 400)
  }
}

/** Read `text` aloud, listening meanwhile when barge-in is on. */
function speakLive(text: string) {
  goto('speaking')
  spoken = new Set(wordsOf(speakable(text)))
  speak('live', text)
  listenOver()
}

function listenOver() {
  over = false
  if (phase !== 'speaking' || muted || !bargeInAvailable()) return
  over = true
  startListeningOver(hear)
}

/** Heard while Hermes speaks: its own voice is ignored; yours cuts it off and becomes the start of your message. */
function overheard(kind: 'partial' | 'final' | 'error' | 'quiet' | 'end', t: string) {
  if (kind === 'error') {
    over = false // no barge-in for this reply (the tap still works); the error shows if it happens while listening
    stopListening()
    return
  }
  if (kind === 'end') {
    setTimeout(() => phase === 'speaking' && over && !muted && startListeningOver(hear), 400) // stopped by itself: again
    return
  }
  if ((kind !== 'partial' && kind !== 'final') || !isUserSpeech(t, spoken)) return
  bargeIn()
  hear(kind, onlyStop(t) ? '' : t)
}

/** You talked over Hermes: it stops, and the recogniser that heard you goes on as the normal listening phase. */
function bargeIn() {
  over = false
  stopSpeaking() // its late tts-done is ignored: the phase is no longer 'speaking'
  clearTimers()
  buffer = ''
  partial = ''
  goto('listening')
  armIdle()
}

function arm() {
  finalWait = false
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = setTimeout(fire, getLivePause() * 1000)
}

function fire() {
  pauseTimer = null
  if (partial && !finalWait && phase === 'listening') {
    finalWait = true
    pauseTimer = setTimeout(fire, FINAL_WAIT_MS)
    return
  }
  finalWait = false
  const text = join(buffer, partial)
  if (!text || phase !== 'listening') return
  goto('thinking')
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  stopListening()
  thinkTimer = setTimeout(() => phase === 'thinking' && listen(), THINK_MAX_MS)
  if (approval) return answerByVoice(text)
  sendPrompt(text).catch(e => {
    toast(errText(e), 'error')
    listen()
  })
}

/** gateway.ts calls this when a reply finishes (empty text = failed or nothing to read). */
function onReply(text: string) {
  if (phase !== 'thinking') return
  if (thinkTimer) clearTimeout(thinkTimer)
  thinkTimer = null
  if (!text.trim()) return listen()
  speakLive(text)
}

// ── approvals by voice ──
// Hermes asks to run something: read it out, listen, and map what you say to an answer. The sheet stays on
// screen, so a tap works too; two answers that aren't clear leave it to the sheet.
let approval: { req: ServerRequest; tries: number } | null = null

/** "allow" / "yes" → once, "… this chat/session" → session, "deny" / "no" / "don't" → deny, else null. */
export function voiceChoice(said: string, choices: string[]): string | null {
  const t = ` ${said.toLowerCase().replace(/[^a-z' ]+/g, ' ')} `
  if (/ (deny|no|nope|don't|do not|dont|stop|cancel|reject|never) /.test(t)) return choices.includes('deny') ? 'deny' : null
  const yes = / (allow|yes|yeah|yep|ok|okay|sure|approve|go ahead|do it|fine) /.test(t)
  if (yes && / (session|this chat|for now|this conversation) /.test(t) && choices.includes('session')) return 'session'
  if (yes) return choices.includes('once') ? 'once' : null
  return null
}

function approvalChoices(req: ServerRequest): string[] {
  const p = req.params as Record<string, unknown>
  if (Array.isArray(p.choices) && p.choices.length) return p.choices as string[]
  return ['once', p.allow_session !== false ? 'session' : '', 'deny'].filter(Boolean)
}

function stillOpen(req: ServerRequest): boolean {
  return getState().requests.some(r => r.id === req.id)
}

/** What Live mode says when Hermes asks for approval: just the question (the details are on the screen; reading a
 * long command out loud took ages). "Allow for this chat" still works when said (voiceChoice). */
export function approvalPrompt(_choices: string[]): string {
  return 'Hermes needs your permission. Allow or deny?'
}

function onApproval(req: ServerRequest) {
  if (phase === 'off') return
  approval = { req, tries: 0 }
  askAloud(approvalPrompt(approvalChoices(req)))
}

function askAloud(text: string) {
  if (thinkTimer) clearTimeout(thinkTimer)
  thinkTimer = null
  stopListening()
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = null
  speakLive(text)
}

function answerByVoice(said: string) {
  const a = approval
  if (!a) return
  if (!stillOpen(a.req)) {
    approval = null // answered on the screen meanwhile
    return
  }
  const choice = voiceChoice(said, approvalChoices(a.req))
  if (choice) {
    approval = null
    if (!answerRequest(a.req, { choice })) return listen() // over the lock screen: it asked for an unlock
    toast(choice === 'deny' ? 'Denied' : choice === 'session' ? 'Allowed for this chat' : 'Allowed once')
    return
  }
  if (++a.tries < 2) return askAloud('Sorry. Say allow, or deny.')
  approval = null
  toast('Answer the approval on the screen', 'warn')
}

export function startLive(): void {
  if (phase !== 'off') return
  muted = false
  setLiveMuted(false)
  liveBridge.active = true
  liveBridge.onReply = onReply
  liveBridge.onApproval = onApproval
  liveBridge.stop = stopLive
  unTts = onTtsDone(onSpoken)
  goto('listening') // listen() does nothing while the phase is 'off'
  listen()
}

/** Cut Hermes off while it speaks and listen at once (the Interrupt button; talking over it does the same when
 * barge-in is on). An approval question being read stays open: the answer is heard next. */
export function interruptLive(): void {
  if (phase !== 'speaking') return
  stopSpeaking() // its late tts-done is ignored: the phase is no longer 'speaking'
  relisten()
}

/** The reading ended by itself: listen. */
function onSpoken() {
  if (phase === 'speaking') relisten()
}

/** Listen afresh. A recogniser left on during the reading (barge-in) is restarted, so the last bit of Hermes's own
 * voice it was still working on never reaches the message. */
function relisten() {
  if (over) stopListening()
  over = false
  listen() // muted: listening with the microphone closed, as after a reply
}

/** Mic off/on without ending the conversation. Muting throws away what was said but not yet sent. */
export function setLiveMute(on: boolean): void {
  if (phase === 'off' || on === muted) return
  muted = on
  setLiveMuted(on)
  if (on) {
    if (pauseTimer) clearTimeout(pauseTimer)
    if (idleTimer) clearTimeout(idleTimer) // nothing is being heard, so nothing can be sent by accident
    pauseTimer = idleTimer = null
    buffer = partial = ''
    if (phase === 'listening' || over) stopListening()
    over = false
  } else if (phase === 'listening') listen()
  else if (phase === 'speaking') listenOver()
}

/** End Live mode. `keepSpeech`: let a reply that is being read play to the end (Android's TTS engine runs in its own
 * service, so it carries on with the app off screen). */
export function stopLive(opts?: { keepSpeech?: boolean }): void {
  if (phase === 'off') return
  muted = false
  setLiveMuted(false)
  liveBridge.active = false
  approval = null
  over = false
  clearTimers()
  unTts?.()
  unTts = null
  goto('off')
  stopListening()
  if (!opts?.keepSpeech) stopSpeaking()
  leaveLockView() // shown over the lock screen for talking: the lock screen comes back
}

/** Leaving the app ends Live mode: the microphone can't stay open off screen. A reply being read keeps playing;
 * an approval question is cut (answering it needs the microphone). */
function onLiveHidden(): void {
  stopLive({ keepSpeech: phase === 'speaking' && !approval })
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') onLiveHidden()
})

/** "2 seconds", "1.5 seconds" for hints. */
export const fmtPause = (sec: number): string => `${sec} ${sec === 1 ? 'second' : 'seconds'}`
