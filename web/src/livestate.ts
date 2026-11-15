// Live mode as an explicit state machine. live.ts keeps the timers and the bridge calls; every "may this happen now?"
// it used to answer with a guard like `phase !== 'listening' || muted` is a function below, defined once.
//
// The phase is one of four; the flags `muted`, `over` and `finalWait` and the pending send countdown split them into
// the states that really occur (`liveState`):
//
//   state            phase      muted  over   finalWait  microphone
//   off              off        no     no     no         closed
//   listening        listening  no     no     no         open, the recogniser hears you
//   finishing        listening  no     no     yes        open; the pause ran out on a preview, waiting 1.5 s for the finished phrase
//   listening-muted  listening  yes    no     no         closed (stays on until unmuted)
//   thinking         thinking   any    no     no         closed (a prompt, or an answer to an approval, is on its way)
//   speaking         speaking   any    no     no         closed (barge-in off or unavailable, or muted); only the Interrupt button
//   speaking-over    speaking   no     yes    no         open to catch you talking over Hermes (barge-in)
//
//   off ──startLive──▶ listening ──pause, then text──▶ thinking ──reply──▶ speaking ──speech ends──▶ listening
//                          ▲  └─partial, pause ran out─▶ finishing ──final or 1.5 s──┘                 │
//                          └─────── bargeIn (speaking-over, your words) ─────────────────────────────────┤
//                          └─────── empty reply, send failed, 10 min wait ───────────────────────────────┘
//   any state ──stopLive (button, error, 5 min idle, app hidden, another chat opened)──▶ off
//   Mute is a flag, not a phase: it closes the microphone in listening and speaking-over and keeps the phase.
//
// An approval being asked by voice (`approval` in live.ts: none / voice / tap-only) rides on thinking and speaking.
// This file only names it (`approvalKind`); what is accepted as an answer stays in live.ts (`voiceChoice`, `voiceMayAnswer`).
//
// Events (the recogniser's `kind`): partial = a preview of the phrase, final = the finished phrase, quiet = silence,
// end = the recogniser stopped by itself, error = it failed. Others: reply arrived, speech finished, mute toggled,
// approval arrived, page hidden, stop.

export type LivePhase = 'off' | 'listening' | 'thinking' | 'speaking'
export type HearKind = 'partial' | 'final' | 'error' | 'quiet' | 'end'
export type LiveStateName = 'off' | 'listening' | 'finishing' | 'listening-muted' | 'thinking' | 'speaking' | 'speaking-over'
export type ApprovalKind = 'none' | 'voice' | 'tap-only'

/** What the decisions look at: the phase, the flags, and whether the send countdown (`pauseTimer`) is running. */
export interface LiveFlags {
  phase: LivePhase
  muted: boolean
  over: boolean
  finalWait: boolean
  pausePending: boolean
}

/** The named state the flags amount to (see the table above). */
export function liveState(s: LiveFlags): LiveStateName {
  if (s.phase === 'listening') return s.muted ? 'listening-muted' : s.finalWait ? 'finishing' : 'listening'
  if (s.phase === 'speaking') return s.over ? 'speaking-over' : 'speaking'
  return s.phase
}

/** Is Live mode running (any phase but off)? */
export const isOn = (phase: LivePhase): boolean => phase !== 'off'

/** What an approval being asked by voice is: none, one a spoken answer may settle, or a phone-data request (tap only). */
export function approvalKind(a: { tapOnly?: boolean } | null): ApprovalKind {
  return !a ? 'none' : a.tapOnly ? 'tap-only' : 'voice'
}

/** Where words from the recogniser go: `over` = barge-in handling (speaking while listening over Hermes), `listening` =
 *  the normal send countdown, `ignore` = late words after we sent, after stopping, or while muted. */
export function hearRoute(s: LiveFlags): 'over' | 'listening' | 'ignore' {
  if (s.phase === 'speaking' && s.over) return 'over'
  return s.phase !== 'listening' || s.muted ? 'ignore' : 'listening'
}

export type ListeningAction = 'note-partial' | 'final-send' | 'final-arm' | 'final-keep' | 'fail' | 'restart' | 'ignore'
/** What a recogniser result does while listening: a preview restarts the countdown; a finished phrase is added and
 *  sends at once when the countdown was waiting for it (`final-send`), starts the countdown when none runs
 *  (`final-arm`) or leaves the one running (`final-keep`); an error ends Live mode; `end` restarts the recogniser. */
export function listeningAction(kind: HearKind, s: LiveFlags): ListeningAction {
  if (kind === 'partial') return 'note-partial'
  if (kind === 'final') return s.finalWait ? 'final-send' : s.pausePending ? 'final-keep' : 'final-arm'
  if (kind === 'error') return 'fail'
  if (kind === 'end') return 'restart'
  return 'ignore'
}

/** The recogniser stopped by itself while listening; 0.4 s later, is it still right to start it again? */
export const restartDue = (s: LiveFlags): boolean => s.phase === 'listening' && !s.muted && !s.pausePending

export type OverAction = 'give-up' | 'restart' | 'bargein' | 'ignore'
/** What a result does while Hermes speaks and the microphone listens over it: an error gives up barge-in for this reply;
 *  `end` restarts it; your words (`userSpeech`, from `isUserSpeech`) in a preview or phrase cut Hermes off; the rest is ignored. */
export function overAction(kind: HearKind, userSpeech: boolean): OverAction {
  if (kind === 'error') return 'give-up'
  if (kind === 'end') return 'restart'
  return (kind === 'partial' || kind === 'final') && userSpeech ? 'bargein' : 'ignore'
}

/** The barge-in recogniser stopped by itself; 0.4 s later, is it still right to start it again? */
export const overRestartDue = (s: LiveFlags): boolean => s.phase === 'speaking' && s.over && !s.muted

/** May the microphone listen over Hermes now? Only while it speaks, unmuted, with barge-in available. */
export const mayListenOver = (s: LiveFlags, bargeInAvailable: boolean): boolean => s.phase === 'speaking' && !s.muted && bargeInAvailable

export type FireStep = 'wait-final' | 'drop' | 'send'
/** The send countdown ran out. A preview with no finished phrase yet waits once more (`wait-final`); nothing to say, or
 *  not listening any more, drops it; else the text is sent. */
export function fireStep(s: LiveFlags, hasPartial: boolean, hasText: boolean): FireStep {
  if (hasPartial && !s.finalWait && s.phase === 'listening') return 'wait-final'
  return !hasText || s.phase !== 'listening' ? 'drop' : 'send'
}

/** A reply arrived (empty text = failed or nothing to read): only while thinking, and then it is read or listening resumes. */
export function replyAction(phase: LivePhase, text: string): 'ignore' | 'listen' | 'speak' {
  if (phase !== 'thinking') return 'ignore'
  return text.trim() ? 'speak' : 'listen'
}

export type MuteStep = 'none' | 'mute' | 'mute-close-mic' | 'unmute-listen' | 'unmute-listen-over' | 'unmute'
/** Mute toggled. Off, or no change: nothing. Muting closes the microphone when listening or listening over Hermes
 *  (`mute-close-mic`). Unmuting while listening restarts the recogniser, while speaking re-opens barge-in. */
export function muteStep(s: LiveFlags, on: boolean): MuteStep {
  if (!isOn(s.phase) || on === s.muted) return 'none'
  if (on) return s.phase === 'listening' || s.over ? 'mute-close-mic' : 'mute'
  return s.phase === 'listening' ? 'unmute-listen' : s.phase === 'speaking' ? 'unmute-listen-over' : 'unmute'
}

/** The page went out of sight: a reply being read keeps playing, an approval question is cut (answering needs the microphone). */
export const hiddenKeepsSpeech = (phase: LivePhase, approval: ApprovalKind): boolean => phase === 'speaking' && approval === 'none'
