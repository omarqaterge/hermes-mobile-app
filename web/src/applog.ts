// What the page itself adds to the diagnostic log (diaglog.ts): the shape of page errors, unhandled promise failures,
// console errors and error toasts, never their words, because those can hold the user's own text. It also knows the open
// chat's text, for the scrubber to take out.
import { logEvent, stackFrames } from './diaglog'
import { getState, subscribe } from './store'

const CHAT_ITEMS = 300 // of the open chat, checked against the log

/** The title and latest messages of the open chat, to keep out of the log. */
export function openChatText(): string[] {
  const a = getState().active
  return [a?.title || '', ...(a?.items || []).slice(-CHAT_ITEMS).map(i => ('text' in i && typeof i.text === 'string' ? i.text : ''))]
}

/** An error's type and where it happened, never its words. */
const keepError = (event: string, e: unknown): void => {
  if (e instanceof Error) logEvent('web', event, { type: e.name, at: stackFrames(e) })
  else logEvent('web', event, { type: 'not_an_error' })
}

let started = false
/** Starts collecting (main.tsx, once). */
export function startAppLog(): void {
  if (started) return
  started = true
  window.addEventListener('error', e => keepError('js_error', e.error))
  window.addEventListener('unhandledrejection', e => keepError('js_error', e.reason))
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    keepError('console_error', args.find(a => a instanceof Error))
    orig(...args)
  }
  let toastSeen = 0
  subscribe(() => {
    for (const t of getState().toasts) {
      if (t.id <= toastSeen) continue
      toastSeen = t.id
      if (t.level === 'error') logEvent('web', 'error_toast')
    }
  })
}
