/** Pure helpers for the context ring above the composer. */

import type { Ctx } from './store'

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

const STAT_CTX = /(?:^| · )ctx (<1|\d+(?:\.\d+)?)% · ([\d.]+[kM]?)\/([\d.]+[kM]?)/

/** Older builds put "ctx 5% · 47k/1M" at the end of each reply's stats; read it back for the ring. */
export function ctxFromStatText(meta: string): Ctx | null {
  const m = STAT_CTX.exec(meta)
  if (!m) return null
  const n = (s: string) => parseFloat(s) * (s.endsWith('M') ? 1e6 : s.endsWith('k') ? 1000 : 1)
  const max = n(m[3])
  if (!max) return null
  return { used: n(m[2]), max, percent: m[1] === '<1' ? 0.5 : parseFloat(m[1]) }
}

/** The same stats without the context part (the ring shows it now); empty when nothing else was there. */
export function stripCtxStat(meta: string): string {
  return meta.replace(/(?:^| · )ctx .*$/, '')
}
