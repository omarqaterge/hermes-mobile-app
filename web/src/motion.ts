// The look's two switches and the motion system's helpers (docs/decisions/glass-and-motion.md).
//
// - Glass effects: the floating bars, sheets, dialogs and toasts are a translucent, blurred material (glass.css), or solid
//   surfaces when off. Stored in localStorage `hm.glass` ('1' | '0'); absent = on.
// - Animations: 'full' | 'reduced' | 'off', stored in `hm.motion`; absent = the phone decides: Off when it asks for no
//   animations (Android's "Remove animations", seen as prefers-reduced-motion), else Full.
// Both are decided once at start-up from what the browser reports (no timer, no bridge call) and written on <html> as
// data-glass="on|off" and data-motion="full|reduced|off", which glass.css and motion.css read. The shell cannot say
// whether battery saver is on (no bridge method tells the page), so it plays no part.
import { useSyncExternalStore } from 'react'

export type MotionLevel = 'full' | 'reduced' | 'off'

const MOTION_KEY = 'hm.motion'
const GLASS_KEY = 'hm.glass'
const LEVELS: MotionLevel[] = ['full', 'reduced', 'off']

const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f))

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: the choice lasts until the page reloads */
  }
}

function phoneAsksNoMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** The level when the person has not chosen one: Off when the phone asks for no animations, else Full. */
export function defaultMotion(noMotion = phoneAsksNoMotion()): MotionLevel {
  return noMotion ? 'off' : 'full'
}

/** The stored choice, or null when the phone decides. */
export function motionChoice(): MotionLevel | null {
  const v = read(MOTION_KEY)
  return LEVELS.includes(v as MotionLevel) ? (v as MotionLevel) : null
}

/** Glass when the person has not chosen: on. */
export const defaultGlass = (): boolean => true

/** The stored glass choice, or null when the phone decides. */
export function glassChoice(): boolean | null {
  const v = read(GLASS_KEY)
  return v === '1' ? true : v === '0' ? false : null
}

/** The level in force now: what <html> says (a test may set it there), else the choice, else the default. */
export function motionLevel(): MotionLevel {
  const v = document.documentElement.dataset.motion
  if (LEVELS.includes(v as MotionLevel)) return v as MotionLevel
  return motionChoice() ?? defaultMotion()
}

export function glassOn(): boolean {
  const v = document.documentElement.dataset.glass
  if (v === 'on' || v === 'off') return v === 'on'
  return glassChoice() ?? defaultGlass()
}

/** Writes both onto <html>. Called once at start-up (main.tsx) and after each change in Appearance. */
export function applyLook(): void {
  const el = document.documentElement
  el.dataset.motion = motionChoice() ?? defaultMotion()
  el.dataset.glass = (glassChoice() ?? defaultGlass()) ? 'on' : 'off'
}

export function setMotionLevel(level: MotionLevel): void {
  write(MOTION_KEY, level)
  document.documentElement.dataset.motion = level
  emit()
}

export function setGlass(on: boolean): void {
  write(GLASS_KEY, on ? '1' : '0')
  document.documentElement.dataset.glass = on ? 'on' : 'off'
  emit()
}

/** The motion level, re-rendering when Appearance changes it. */
export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribe, motionLevel)
}

export function useGlass(): boolean {
  return useSyncExternalStore(subscribe, glassOn)
}

/** True when movement should be left out: the level is not Full, or the phone asks for reduced motion. */
export function lessMotion(): boolean {
  return motionLevel() !== 'full' || phoneAsksNoMotion()
}

/** Inline style that delays a row's arrival by its place in a list (the row has motion.css `.motion-in`): the first `max`
 *  rows arrive `step` ms apart, the rest with the last of them. */
export function stagger(i: number, step = 28, max = 10): React.CSSProperties {
  return { animationDelay: `${Math.min(Math.max(0, i), max) * step}ms` }
}

// ── keeping repeating animations cheap ──────────────────────

const paused = new Set<HTMLElement>()
let away = false

function paint(el: HTMLElement, onScreen: boolean): void {
  el.toggleAttribute('data-motion-paused', away || !onScreen)
}

/** Called by App on the shell's hermesPause / hermesResume (and the page's own visibilitychange): every CSS animation
 *  stands still while the app is away (<html data-app-away>) and runs on when it is back; elements given to
 *  `pauseWhenHidden` also wait for being on screen. */
export function setAppAway(isAway: boolean): void {
  if (away === isAway) return
  away = isAway
  document.documentElement.toggleAttribute('data-app-away', away) // motion.css pauses every CSS animation meanwhile
  paused.forEach(el => paint(el, el.dataset.motionVisible !== '0'))
}

/** Pauses the CSS animations of `el` (and its children, motion.css `[data-motion-paused]`) while the app is in the
 *  background or `el` is off screen, and resumes them when both are back. Returns the cleanup. A repeating animation
 *  is given to this from the moment it starts; it needs no timer. */
export function pauseWhenHidden(el: HTMLElement): () => void {
  paused.add(el)
  el.dataset.motionVisible = '1'
  paint(el, true)
  let io: IntersectionObserver | null = null
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        el.dataset.motionVisible = e.isIntersecting ? '1' : '0'
        paint(el, e.isIntersecting)
      }
    })
    io.observe(el)
  }
  return () => {
    io?.disconnect()
    paused.delete(el)
    el.removeAttribute('data-motion-paused')
    delete el.dataset.motionVisible
  }
}
