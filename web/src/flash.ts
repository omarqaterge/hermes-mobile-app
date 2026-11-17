// Scroll a Settings row or section into view and flash it briefly (the `.hit-flash` ring also used for chat search hits).
import { lessMotion } from './motion'

const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The row or section whose title (`.set-title`) or heading (`.set-heading`) is `text`, inside `root`. */
export function findSettingsTarget(root: ParentNode, text: string): HTMLElement | null {
  const want = norm(text)
  for (const n of root.querySelectorAll<HTMLElement>('.set-title, .set-heading')) {
    const got = norm(n.textContent)
    // A title may carry a badge after its words (for example "Changed"), so a leading match counts.
    if (got === want || got.startsWith(`${want} `)) return (n.closest('.set-row') || n.closest('.set-section')) as HTMLElement | null
  }
  return null
}

/** Centre `el` and flash it for 2.5 s. */
export function flashElement(el: HTMLElement): void {
  const reduced = lessMotion() // Reduced or Off in Appearance, or the phone asks for reduced motion
  el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  el.classList.remove('hit-flash')
  void el.offsetWidth // restart the animation when it is flashed twice in a row
  el.classList.add('hit-flash')
  setTimeout(() => el.classList.remove('hit-flash'), 2500)
}
