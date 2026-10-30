// Answers typed into a notification (Android RemoteInput): HermesService hands them to this page, which owns
// the connection Hermes asked on. window.hermesAnswer returns 'y' when it takes the answer, 'n' otherwise
// (the service then offers to open the app with the text prefilled).
//   kind 'ask'   → the pending clarify question of that chat gets the text as its answer
//   kind 'reply' → the text is sent to that chat as a new message (opening it first if another chat is open)
import { answerRequest, connectionAlive, errText, queueAndReconnect, resumeSession, sendPrompt } from './gateway'
import { lockView } from './lockview'
import { getState, toast } from './store'

declare global {
  interface Window {
    hermesAnswer?: (kind: string, session: string, text: string) => string
  }
}

function clarifyFor(session: string) {
  // One question, plain or as a one-item batch (models often send that); a real batch needs the app.
  const asks = getState().requests.filter(r => r.method === 'clarify' && (!Array.isArray(r.params.questions) || r.params.questions.length === 1))
  const a = getState().active
  const mine = asks.filter(r => r.params.session_id === session || (a?.storedId === session && r.params.session_id === a.runtimeId))
  if (mine.length) return mine[0]
  return asks.length === 1 ? asks[0] : null // the plugin may know the chat by another id
}

export function answerFromNotification(kind: string, session: string, text: string): boolean {
  const t = text.trim()
  if (!t || getState().conn !== 'open') return false
  if (kind === 'ask') {
    const req = clarifyFor(session)
    if (!req) return false
    const qs = req.params.questions as { qid?: string }[] | undefined
    if (Array.isArray(qs) && qs.length === 1) return answerRequest(req, { answers: { [String(qs[0]?.qid ?? '_')]: t } })
    return answerRequest(req, { answer: t })
  }
  if (kind === 'reply') {
    if (!session || lockView()) return false // over the lock screen: the service opens the app to unlock instead
    void (async () => {
      if (!(await connectionAlive())) {
        queueAndReconnect(session, t)
        return
      }
      try {
        if (getState().active?.storedId !== session) await resumeSession(session)
        await sendPrompt(t)
      } catch (err) {
        toast(errText(err), 'error')
      }
    })()
    return true
  }
  return false
}

window.hermesAnswer = (kind, session, text) => (answerFromNotification(String(kind), String(session || ''), String(text || '')) ? 'y' : 'n')
