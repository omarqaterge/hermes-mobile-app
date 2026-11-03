import { describe, expect, it } from 'vitest'
import { EMBED_HOST, MAX_VIDEOS, embedOf, embedsInText, frameEmbed, frameSrc } from './videoembed'

describe('embedOf', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ']
  ])('finds the YouTube video in %s', url => {
    const e = embedOf(url)
    expect(e?.label).toBe('YouTube')
    expect(e?.src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?')).toBe(true)
    expect(e?.thumb).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(e?.url).toBe(url)
  })

  it('keeps the start time and playlist', () => {
    expect(embedOf('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.src).toContain('start=90')
    expect(embedOf('https://youtu.be/dQw4w9WgXcQ?t=90')?.src).toContain('start=90')
    expect(embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123')?.src).toContain('list=PLabc123')
    const list = embedOf('https://www.youtube.com/playlist?list=PLabc123')
    expect(list?.src).toContain('listType=playlist')
    expect(list?.thumb).toBeUndefined()
  })

  it('finds the other video sites', () => {
    expect(embedOf('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871?autoplay=1')
    expect(embedOf('https://vimeo.com/76979871/abcdef1234')?.src).toContain('&h=abcdef1234')
    expect(embedOf('https://www.dailymotion.com/video/x8abcde')?.src).toBe('https://www.dailymotion.com/embed/video/x8abcde?autoplay=1')
    expect(embedOf('https://dai.ly/x8abcde')?.label).toBe('Dailymotion')
    expect(embedOf('https://streamable.com/abc123')?.src).toBe('https://streamable.com/e/abc123?autoplay=1')
    expect(embedOf('https://www.loom.com/share/0123456789abcdef0123')?.src).toBe('https://www.loom.com/embed/0123456789abcdef0123?autoplay=1')
  })

  it('plays links to video files with the video element', () => {
    const e = embedOf('https://example.com/a/clip.mp4?x=1')
    expect(e?.file).toBe(true)
    expect(e?.src).toBe('https://example.com/a/clip.mp4?x=1')
  })

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@somebody',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=a"b<c>d',
    'https://youtu.be/',
    'https://vimeo.com/channels/staffpicks',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://example.com/page',
    'javascript:alert(1)',
    'not a url'
  ])('leaves %s as a link', url => {
    expect(embedOf(url)).toBeNull()
  })
})

describe('frameEmbed', () => {
  it('takes any https page, named by its host', () => {
    expect(frameEmbed('https://Player.Example.com/v/1')).toMatchObject({ label: 'player.example.com', src: 'https://player.example.com/v/1' })
  })
  it('uses the site player when it knows the site', () => {
    expect(frameEmbed('https://youtu.be/dQw4w9WgXcQ')?.label).toBe('YouTube')
  })
  it('refuses anything but https', () => {
    expect(frameEmbed('http://example.com/')).toBeNull()
    expect(frameEmbed('file:///sdcard/a.html')).toBeNull()
    expect(frameEmbed('data:text/html,hi')).toBeNull()
    expect(frameEmbed(`https://example.com/${'a'.repeat(2000)}`)).toBeNull()
  })
})

describe('frameSrc', () => {
  it('goes through the shell page in the app, straight to the player elsewhere', () => {
    const src = 'https://www.youtube-nocookie.com/embed/x?autoplay=1&rel=0'
    expect(frameSrc(src, false)).toBe(src)
    const inApp = new URL(frameSrc(src, true))
    expect(inApp.hostname).toBe(EMBED_HOST)
    expect(inApp.searchParams.get('u')).toBe(src)
  })
})

describe('embedsInText', () => {
  it('finds links in plain text, without repeats, up to the limit', () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']
    const text = `see https://youtu.be/${ids[0]} and https://youtu.be/${ids[0]}, ${ids.map(i => `https://youtu.be/${i}`).join(' ')} https://example.com`
    const out = embedsInText(text)
    expect(out).toHaveLength(MAX_VIDEOS)
    expect(out.map(e => e.thumb)).toEqual(ids.slice(0, 3).map(i => `https://i.ytimg.com/vi/${i}/hqdefault.jpg`))
  })
  it('finds nothing in ordinary text', () => {
    expect(embedsInText('hello https://example.com')).toEqual([])
  })
})
