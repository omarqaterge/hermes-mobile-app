/** Pure helpers for the context ring above the composer. */

export type CtxLevel = 'ok' | 'warn' | 'full'

/** Ring fill: where the filled arc starts and how long it is, for a circle of radius `r`. Percent is clamped to 0..100. */
export function ringDash(percent: number, r: number): { dasharray: number; dashoffset: number } {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const c = 2 * Math.PI * r
  return { dasharray: c, dashoffset: c - (p / 100) * c }
}

/** Colour level: amber from 80 %, red from 90 %. */
export function ctxLevel(percent: number): CtxLevel {
  return percent >= 90 ? 'full' : percent >= 80 ? 'warn' : 'ok'
}

/** Cost for the context sheet: 4 decimals under $1, 2 from there. */
export function fmtCost(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`
}
