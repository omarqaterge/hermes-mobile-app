// Live mode: a hands-free voice conversation.
//   listen → (you pause for 2 s) → send what you said → wait for the reply → read it aloud → listen again …
// until you press the button again. Android does the listening/speaking (Voice.java); this is the loop.
// The microphone is off while Hermes thinks and while it speaks, so it never hears itself.
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { answerRequest, errText, sendPrompt } from './gateway'
import { getState, toast } from './store'
import { liveBridge, onTtsDone, setLiveMuted, setLivePhase, speak, startListening, stopListening, stopSpeaking, voiceErrorText, voiceInputAvailable } from './voice'

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

export const liveAvailable = (): boolean => voiceInputAvailable()
export const liveOn = (): boolean => phase !== 'off'

const join = (a: string, b: string) => [a, b].filter(Boolean).join(' ').trim()

function clearTimers() {
  if (pauseTimer) clearTimeout(pauseTimer)
  if (thinkTimer) clearTimeout(thinkTimer)
  if (idleTimer) clearTimeout(idleTimer)
  pauseTimer = thinkTimer = idleTimer = null
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
  startListening((kind, t) => {
    if (phase !== 'listening' || muted) return // late words after we already sent, after stopping, or while muted
    if (kind === 'partial') {
      partial = t
      armIdle()
      arm() // still speaking: restart the 2 s countdown
    } else if (kind === 'final') {
      buffer = join(buffer, t)
      partial = ''
      if (!pauseTimer) arm() // a phrase that arrived only as a final still counts as speech
    } else if (kind === 'error') {
      toast(voiceErrorText(t, true), 'error', 8000)
      stopLive()
    } else if (kind === 'end') {
      // The recogniser stopped by itself (not because we sent): start it again.
      setTimeout(() => phase === 'listening' && !muted && !pauseTimer && listen(), 400)
    }
  })
}

function arm() {
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = setTimeout(fire, getLivePause() * 1000)
}

function fire() {
  pauseTimer = null
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
  goto('speaking')
  speak('live', text)
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

function onApproval(req: ServerRequest) {
  if (phase === 'off') return
  approval = { req, tries: 0 }
  const p = req.params as Record<string, unknown>
  const what = String(p.description || p.command || 'run a command').slice(0, 220)
  const session = approvalChoices(req).includes('session')
  askAloud(`Hermes wants to ${/^[a-z]/.test(what) ? '' : 'do this: '}${what}. Say allow${session ? ', allow for this chat,' : ''} or deny.`)
}

function askAloud(text: string) {
  if (thinkTimer) clearTimeout(thinkTimer)
  thinkTimer = null
  stopListening()
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = null
  goto('speaking')
  speak('live', text)
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
    answerRequest(a.req, { choice })
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
  unTts = onTtsDone(() => phase === 'speaking' && listen())
  goto('listening') // listen() does nothing while the phase is 'off'
  listen()
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
    if (phase === 'listening') stopListening()
  } else if (phase === 'listening') listen()
}

export function stopLive(): void {
  if (phase === 'off') return
  muted = false
  setLiveMuted(false)
  liveBridge.active = false
  approval = null
  clearTimers()
  unTts?.()
  unTts = null
  goto('off')
  stopListening()
  stopSpeaking()
}

// The microphone can't stay open once the app is off screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopLive()
})

/** "2 seconds", "1.5 seconds" for hints. */
export const fmtPause = (sec: number): string => `${sec} ${sec === 1 ? 'second' : 'seconds'}`
