// A bound on how long a screen waits for the phone: a call that never answers (Hermes busy, a lost bridge callback)
// must end in an error with Try again, never a "Loading…" that stays.

/** How long a screen's load may take before it shows an error (a late answer still fills the screen). */
export const LOAD_LIMIT_MS = 20000

export class TimeLimitError extends Error {}

/** `p`, or a TimeLimitError after `ms`. The timer is cleared as soon as `p` settles. */
export function timeLimit<T>(p: Promise<T>, ms: number, message = 'Hermux didn’t answer in time.'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeLimitError(message)), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}
