// Version order and the "What's new" text for Settings → About (update.ts): pure, so the unit tests can load it.

export type ReleaseNotes = { version: string; date: string; text: string }

/** "0.8.21" → [0,8,21]; anything that isn't dotted numbers sorts as 0. */
const parts = (v: string) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d > 0
  }
  return false
}

/** The `## vX.Y.Z (date)` sections of a CHANGELOG.md newer than `current` and not newer than `latest`, newest first. */
export function notesSince(changelog: string, current: string, latest: string): ReleaseNotes[] {
  const out: ReleaseNotes[] = []
  const heads = [...changelog.matchAll(/^## +v?(\d+(?:\.\d+)*)(?: +\(([^)]*)\))?[ \t]*$/gm)]
  heads.forEach(m => {
    const version = m[1]
    if (!isNewer(version, current) || isNewer(version, latest)) return
    const start = (m.index ?? 0) + m[0].length
    const next = changelog.slice(start).search(/^## /m)
    const text = (next < 0 ? changelog.slice(start) : changelog.slice(start, start + next)).trim()
    if (text) out.push({ version, date: m[2] || '', text })
  })
  return out.sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1))
}
