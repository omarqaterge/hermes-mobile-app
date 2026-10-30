// Stepping through a batch of questions in the request sheet (RequestSheet.tsx).

/** How long a picked choice stays on screen before the sheet moves to the next question. */
export const ADVANCE_MS = 300

/** The question to show after `step`: the first unanswered one after it, else the next one, never past the last. */
export function nextStep(answers: Record<string, string>, questions: Array<{ qid: string }>, step: number): number {
  const last = questions.length - 1
  for (let i = step + 1; i <= last; i++) if (!(answers[questions[i].qid] || '').trim()) return i
  return Math.min(step + 1, last)
}
