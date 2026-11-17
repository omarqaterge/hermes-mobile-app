// @vitest-environment happy-dom
// The look's two settings and the motion helpers (motion.ts) and the bars' heights (barinsets.ts).
import { afterEach, expect, test, vi } from 'vitest'
import { applyLook, defaultGlass, defaultMotion, glassChoice, motionChoice, motionLevel, pauseWhenHidden, setAppAway, setGlass, setMotionLevel, stagger } from './motion'
import { barInsets, onBarInsets, watchBars } from './barinsets'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.motion
  delete document.documentElement.dataset.glass
  setAppAway(false)
  vi.unstubAllGlobals()
})

test('defaults: Animations follows the phone asking for no animations, glass is on', () => {
  expect(defaultMotion(true)).toBe('off')
  expect(defaultMotion(false)).toBe('full')
  expect(defaultGlass()).toBe(true)
})

test('the defaults do not depend on the phone\'s memory or cores', () => {
  vi.stubGlobal('navigator', { ...navigator, hardwareConcurrency: 2, deviceMemory: 1 })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  applyLook()
  expect(document.documentElement.dataset.motion).toBe('full')
  expect(document.documentElement.dataset.glass).toBe('on')
})

test('a choice is kept, written on <html> and wins over the default', () => {
  expect(motionChoice()).toBe(null)
  expect(glassChoice()).toBe(null)
  setMotionLevel('reduced')
  setGlass(false)
  expect(localStorage.getItem('hm.motion')).toBe('reduced')
  expect(localStorage.getItem('hm.glass')).toBe('0')
  expect(document.documentElement.dataset.motion).toBe('reduced')
  expect(document.documentElement.dataset.glass).toBe('off')
  delete document.documentElement.dataset.motion
  applyLook()
  expect(motionLevel()).toBe('reduced')
  localStorage.setItem('hm.motion', 'bogus') // an unknown value counts as no choice
  expect(motionChoice()).toBe(null)
})

test('stagger: rows arrive a step apart, the late ones together', () => {
  expect(stagger(0)).toEqual({ animationDelay: '0ms' })
  expect(stagger(3, 30)).toEqual({ animationDelay: '90ms' })
  expect(stagger(40, 30, 10)).toEqual({ animationDelay: '300ms' })
})

test('away: every animation stands still, and an element given to pauseWhenHidden too, until the app is back and it is on screen', () => {
  let seen: ((e: Array<{ isIntersecting: boolean }>) => void) | null = null
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
      seen = cb
    }
    observe() {}
    disconnect() {}
  })
  const el = document.createElement('div')
  const stop = pauseWhenHidden(el)
  expect(el.hasAttribute('data-motion-paused')).toBe(false)
  setAppAway(true)
  expect(document.documentElement.hasAttribute('data-app-away')).toBe(true)
  expect(el.hasAttribute('data-motion-paused')).toBe(true)
  setAppAway(false)
  expect(el.hasAttribute('data-motion-paused')).toBe(false)
  seen!([{ isIntersecting: false }])
  expect(el.hasAttribute('data-motion-paused')).toBe(true)
  seen!([{ isIntersecting: true }])
  expect(el.hasAttribute('data-motion-paused')).toBe(false)
  stop()
  setAppAway(true)
  expect(el.hasAttribute('data-motion-paused')).toBe(false) // no longer followed
})

test('bars: their heights become the list padding and listeners hear a change', () => {
  const stage = document.createElement('div')
  const top = document.createElement('div')
  const bottom = document.createElement('div')
  let h = { top: 57, bottom: 102 }
  top.getBoundingClientRect = () => ({ height: h.top }) as DOMRect
  bottom.getBoundingClientRect = () => ({ height: h.bottom }) as DOMRect
  let fire = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) {
      fire = cb
    }
    observe() {}
    disconnect() {}
  })
  const heard: number[] = []
  const off = onBarInsets(now => heard.push(now.bottom))
  const stop = watchBars(stage, top, bottom)
  expect(stage.style.getPropertyValue('--bar-top')).toBe('57px')
  expect(stage.style.getPropertyValue('--bar-bottom')).toBe('102px')
  h = { top: 57, bottom: 130 }
  fire()
  expect(barInsets()).toEqual({ top: 57, bottom: 130 })
  fire() // no change: nobody is told again
  expect(heard).toEqual([102, 130])
  off()
  stop()
})

// Off names the older animations one by one (a `*` rule would slow every restyle): this keeps the list whole.
test('Off: every animation and transition in styles.css is named in motion.css, so Off makes it instant', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const styles = read('./styles.css')
  const motion = read('./motion.css').replace(/\s+/g, ' ')
  const moving: string[] = []
  const walk = (css: string) => {
    let i = 0
    for (;;) {
      const open = css.indexOf('{', i)
      if (open < 0) return
      const prelude = css.slice(i, open).replace(/^[\s\S]*[;}]/, '').trim()
      let depth = 1
      let j = open + 1
      for (; depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0
      const body = css.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        if (!prelude.startsWith('@keyframes')) walk(body)
      } else {
        const moves = [...body.matchAll(/(?:^|[;\s])(animation|transition)(?:-name|-duration)?\s*:\s*([^;]+)/g)].some(
          m => !/^(none|paused|running)\b/.test(m[2].trim()),
        )
        if (moves) for (const sel of prelude.split(',')) moving.push(sel.replace(/\s+/g, ' ').trim())
      }
      i = j
    }
  }
  walk(styles)
  expect(moving.length).toBeGreaterThan(20)
  const missing = moving.filter(sel => {
    const named = [`html[data-motion='off'] ${sel}`, `html:not([data-motion='full']) ${sel}`]
    if (sel.startsWith('html')) named.push(sel.replace(/^html/, "html[data-motion='off']"))
    return !named.some(n => motion.includes(`${n},`) || motion.includes(`${n} {`))
  })
  expect(missing).toEqual([])
})
