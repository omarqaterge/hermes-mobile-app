import { haptic } from './bridge'
import { openBtw, btwOpen } from './btw'
import { getState } from './store'

// Pull up past the last message of a chat: the list stretches like a rubber band, and a firm pull opens the
// side chat (/btw) about this chat. Released early, it springs back and nothing happens.

/** Finger travel (px) that arms the gesture. */
export const PULL_TRIGGER_PX = 110
/** The list never stretches further than this (px), however far the finger goes. */
export const PULL_MAX_PX = 120

/** How far the list shows stretched (px) for a finger travel of `dy` px: about half at first, flattening out. */
export function rubber(dy: number): number {
  if (!(dy > 0)) return 0
  return PULL_MAX_PX * (1 - 1 / ((dy / PULL_MAX_PX) * 0.55 + 1))
}

export function shouldOpen(fingerDy: number, atBottomAtStart: boolean, hasChat: boolean): boolean {
  return atBottomAtStart && hasChat && fingerDy >= PULL_TRIGGER_PX
}

const SKIP = '.scrubber,input,textarea,select,[contenteditable],[role=dialog],.hm-openui,pre,table,.katex-display,.mermaid,.diagram,.slider,.tts-player'

function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 2
}

/**
 * Adds the pull gesture to a chat scroller. The stretch is a CSS variable (`--pull`, px) on the scroller that
 * moves its children (scrollTop is never touched, so auto-scroll and the jump button are unaffected).
 * Returns the cleanup.
 */
export function installPullToBtw(el: HTMLElement): () => void {
  let start: { x: number; y: number } | null = null
  let pulling = false
  let armed = false
  let dy = 0
  let release: ReturnType<typeof setTimeout> | undefined

  const reset = () => {
    if (pulling || armed) {
      // One-shot spring back (CSS transition), then the helper classes go.
      el.classList.add('pull-release')
      clearTimeout(release)
      release = setTimeout(() => el.classList.remove('pull-release'), 320)
    }
    el.classList.remove('pulling', 'pull-armed')
    el.style.removeProperty('--pull')
    el.style.removeProperty('--pull-ratio')
    start = null
    pulling = false
    armed = false
    dy = 0
  }

  const down = (e: TouchEvent) => {
    start = null
    const s = getState()
    if (e.touches.length !== 1 || s.drawer || s.screen || s.sheet || btwOpen() || !s.active?.runtimeId) return
    if (!atBottom(el)) return
    const t = e.target as Element | null
    if (!t || t.closest(SKIP)) return
    clearTimeout(release)
    el.classList.remove('pull-release')
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  const move = (e: TouchEvent) => {
    if (!start) return
    const t = e.touches[0]
    if (!t) return
    const up = start.y - t.clientY
    const side = Math.abs(t.clientX - start.x)
    if (!pulling) {
      if (up < -8 || (side > 12 && side > Math.abs(up))) {
        start = null // scrolling back down, or a sideways swipe (drawer)
        return
      }
      if (up < 8) return
      pulling = true
      el.classList.add('pulling')
    }
    if (up <= 0) {
      reset() // finger went back below where it began: normal scrolling resumes
      return
    }
    dy = up
    if (e.cancelable) e.preventDefault()
    el.style.setProperty('--pull', `${-rubber(up).toFixed(1)}px`)
    el.style.setProperty('--pull-ratio', Math.min(1, up / PULL_TRIGGER_PX).toFixed(2))
    const nowArmed = up >= PULL_TRIGGER_PX
    if (nowArmed !== armed) {
      armed = nowArmed
      el.classList.toggle('pull-armed', armed)
      if (armed) haptic()
    }
  }

  const end = () => {
    const open = pulling && shouldOpen(dy, true, Boolean(getState().active?.runtimeId))
    reset()
    if (open) openBtw()
  }

  el.addEventListener('touchstart', down, { passive: true })
  el.addEventListener('touchmove', move, { passive: false })
  el.addEventListener('touchend', end, { passive: true })
  el.addEventListener('touchcancel', reset, { passive: true })
  return () => {
    el.removeEventListener('touchstart', down)
    el.removeEventListener('touchmove', move)
    el.removeEventListener('touchend', end)
    el.removeEventListener('touchcancel', reset)
    clearTimeout(release)
    el.classList.remove('pulling', 'pull-armed', 'pull-release')
    el.style.removeProperty('--pull')
    el.style.removeProperty('--pull-ratio')
  }
}
