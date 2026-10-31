import type { ActiveSession } from './store'

/** A chat just became the one on screen: `new` = created (`newSession`), `resume` = opened or reopened (`resumeSession`). */
export type ChatOpen = { chat: ActiveSession; kind: 'new' | 'resume' }

/** The extra work each feature does when a chat opens (read its goal, put its access mode back, show its context fill…).
 * A feature adds its own step here, next to its own code, instead of editing the middle of `newSession`/`resumeSession`:
 * parallel branches then add separate lines instead of changing the same ones. Steps run in the order they were added,
 * after the chat is on screen; they must not block (start async work with `void`). */
const steps: { name: string; run: (o: ChatOpen) => void }[] = []

/** Add a step under a unique name; adding the same name again replaces it (a module evaluated twice). Returns a remover. */
export function onChatOpen(name: string, run: (o: ChatOpen) => void): () => void {
  const i = steps.findIndex(s => s.name === name)
  const step = { name, run }
  if (i >= 0) steps[i] = step
  else steps.push(step)
  return () => {
    const j = steps.indexOf(step)
    if (j >= 0) steps.splice(j, 1)
  }
}

/** Run every step for a chat that just opened. One step failing doesn't stop the others or the opening. */
export function runChatOpen(o: ChatOpen): void {
  for (const s of [...steps]) {
    try {
      s.run(o)
    } catch (err) {
      console.warn(`chat-open step ${s.name} failed`, err)
    }
  }
}

/** The step names in order (for tests and debugging). */
export function chatOpenSteps(): string[] {
  return steps.map(s => s.name)
}
