/** Hermes status lines the chat leaves out of the status bar. */

// A title that failed because the provider is busy (429 rate limit, overload, timeout, 5xx) changes nothing the user
// can see or fix: the chat keeps the title it already has, and Hermes asks again on a later turn (hermes/patches/0004
// backs off). Other title failures (billing, a wrong model) still show: the user has to act on those.
const BUSY = /\b(429|rate.?limit|too many requests|overloaded|capacity|timed? ?out|timeout|connection|5\d\d)\b/i
const QUIET = [(t: string) => /^\W*Auxiliary title generation failed\b/i.test(t) && BUSY.test(t)]

/** True for a `status.update` text the status bar should not show. */
export function quietStatus(text: string): boolean {
  return QUIET.some(q => q(text))
}
