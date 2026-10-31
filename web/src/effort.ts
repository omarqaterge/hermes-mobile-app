// Reasoning effort as a level for the model chip's bars.

const LEVELS: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5 }

/** none 0, minimal 1, low 2, medium 3, high 4, xhigh 5; null for a level this app doesn't know (the chip then shows the text). */
export function effortLevel(effort: string): number | null {
  const n = LEVELS[effort.trim().toLowerCase()]
  return n === undefined ? null : n
}
