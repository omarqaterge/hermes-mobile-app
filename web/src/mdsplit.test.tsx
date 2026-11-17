// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, test } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { MIN_PART, splitStream, type Split } from './mdsplit'
import { Markdown } from './components/Markdown'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: true }).freeze()
// The blocks of a text without their positions (a part's positions start at its own first line).
const blocks = (md: string): unknown[] =>
  JSON.parse(JSON.stringify(parser.parse(md).children, (k, v) => (k === 'position' ? undefined : v)))

// Everyday Markdown plus the places where a cut on a blank line, or on a line still arriving, would be wrong.
const PLAIN = [
  '# Title\n\nA first paragraph with **bold**, `code` and a [link](https://example.com/a).\nIts second line.\n',
  '***Note:*** a line that starts like a rule.\n#hashtag starts like a heading\n```not a fence` either\n',
  '\n- one\n- two\n\n  still item two\n\n- three\n    - nested\n\n1. first\n2. second\n\nAfter the lists.\n',
  '\n| Name | Value |\n|---|---|\n| a | 1<br>2 |\n| b | 3 |\nText right after the table.\n\n',
  '```python\ndef f(x):\n\n    return x\n\n# not a heading\n```\n\n    indented code\n\n    more of it\n\nPlain again.\n',
  '> a quote\n> on two lines\n\n> another quote\n\nSetext title\n===\n\nSecond one\n---\n\n---\n\n* * *\n',
  '$$\nx = 1\n\ny = 2\n$$\n\nInline $a+b$ and a paragraph\nthat ends here.\n\n~~~\ntilde fence\n\n~~~\n\nLast words.\n'
].join('\n')

/** Feeds `text` to splitStream `step` characters at a time, checking after each step; returns the last split. */
function stream(text: string, step: number, each: (s: Split, sofar: string) => void, minPart = 1, lookEvery = 1): Split {
  let s: Split | null = null
  for (let n = step; ; n += step) {
    const sofar = text.slice(0, n)
    s = splitStream(s, sofar, minPart, lookEvery)
    each(s, sofar)
    if (n >= text.length) return s
  }
}

test('the parts always join to the text, and a finished part never changes', () => {
  let before: string[] = []
  const end = stream(PLAIN, 5, (s, sofar) => {
    expect(s.parts.join('')).toBe(sofar)
    expect(s.parts.slice(0, before.length)).toEqual(before)
    before = s.parts.slice(0, -1)
  })
  expect(end.parts.length).toBeGreaterThan(10)
})

test('the parts read one by one give the same blocks as the whole text, at every step of a stream', () => {
  for (const step of [1, 7]) {
    stream(PLAIN, step, (s, sofar) => {
      expect(s.parts.flatMap(blocks)).toEqual(blocks(sofar))
    })
  }
})

// Blocks of every kind in a random order, joined with or without a blank line: the places a hand-written text misses.
const PIECES = [
  'A paragraph.', 'Two lines\nof a paragraph.', '# Heading', '## Heading two ##', 'Setext\n===', 'Setext two\n---', '---', '***', '* * *', '___',
  '- a\n- b', '- a\n\n- b', '* star\n* list', '+ plus', '1. one\n2. two', '3) three', '- item\n\n  more of the item', '- a\n  - nested\n    - deeper',
  '> quote', '> quote\nlazy line', '> - list in a quote', '```\ncode\n```', '```js\nlet a\n\nlet b\n```', '~~~\ntilde\n~~~', '    indented code', '\tcode with a tab',
  '| a | b |\n|---|---|\n| 1 | 2 |', 'a | b\n- | -\n1 | 2', '$$\nx\n$$', '$$\nx\n\ny\n$$', 'Inline $x$ math.', '***bold italic*** start', '#hashtag', '-not a list',
  '1986. A year.', '2. two first', '`code` span', '``` not a fence `', '**bold**', '_em_ text', '[link](https://example.com)', '![img](/a.png)', 'https://example.com/page',
  'line one<br>line two', '- [link](https://example.com) in a list', '  two spaces in', '   three spaces in', '>', '-', '1.', '#', '```', '$$', '\\[ not math', 'a\\\nb'
]
test('random texts: the parts give the same blocks as the whole text at every step', () => {
  let seed = 20261117
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  for (let doc = 0; doc < Number(process.env.HM_SPLIT_DOCS || 60); doc++) {
    let text = ''
    for (let i = 0, n = 4 + rnd(10); i < n; i++) text += PIECES[rnd(PIECES.length)] + (rnd(3) ? '\n\n' : '\n')
    stream(text, 1 + rnd(4), (s, sofar) => {
      expect(s.parts.join('')).toBe(sofar)
      expect(s.parts.flatMap(blocks), JSON.stringify(sofar)).toEqual(blocks(sofar))
    })
  }
}, 600_000) // HM_SPLIT_DOCS=4000 takes about three minutes

test('parts are not cut smaller than needed: a part is long, or stands before a long block', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with enough words to fill a line of the reply and a little more.\n`).join('\n')
  const end = stream(long, 12, () => {}, MIN_PART, 200)
  expect(end.parts.length).toBeGreaterThan(3)
  for (const p of end.parts.slice(0, -1)) expect(p.length).toBeGreaterThanOrEqual(MIN_PART)
  const code = 'Intro.\n\n```\n' + 'a line of code\n'.repeat(120) + '```\n\nAfter.\n\nMore.\n'
  expect(stream(code, 12, () => {}, MIN_PART, 200).parts[0]).toBe('Intro.\n\n')
})

test('a line still arriving is not cut on', () => {
  const s = splitStream(null, 'One paragraph.\n\nAnother paragraph\n***', 1, 1)
  expect(s.parts).toEqual(['One paragraph.\n\n', 'Another paragraph\n***'])
})

test('raw HTML, a task box and a video link keep the rest of the reply in one part; <br> does not', () => {
  const tail = '\n\nNext paragraph.\n\nAnd another.\n\nThe end.\n'
  for (const [what, md] of [
    ['html', '<details>\n<summary>More</summary>\n\nInside.\n\n</details>'],
    ['inline html', 'Some <b>bold text'],
    ['task', '- [ ] to do\n- [x] done'],
    ['video', 'Watch https://youtu.be/dQw4w9WgXcQ now']
  ]) {
    const end = stream('Start.\n\nSecond.\n\n' + md + tail, 3, () => {})
    expect(end.open, what).toBe(false)
    expect(end.parts, what).toEqual(['Start.\n\n', 'Second.\n\n', md + tail])
  }
  const br = stream('Start.\n\nline one<br>line two\n\nNext.\n\nThe end.\n', 3, () => {})
  expect(br.open).toBe(true)
  expect(br.parts.length).toBe(4)
})

test('a link or footnote definition makes the reply one part again', () => {
  for (const def of ['[1]: https://example.com/source', '[^1]: The footnote.']) {
    const text = 'See [the source][1] and a note[^1].\n\nSecond paragraph.\n\nThird.\n\n' + def + '\n'
    let most = 0
    const end = stream(text, 4, s => (most = Math.max(most, s.parts.length)))
    expect(most).toBeGreaterThan(1) // cut before the definition arrived
    expect(end.parts).toEqual([text])
    expect(end.open).toBe(false)
  }
})

test('a text that no longer starts the same is split from its start', () => {
  const a = stream('First.\n\nSecond.\n\nThird.\n', 4, () => {})
  expect(a.parts.length).toBe(3)
  const b = splitStream(a, 'Other first.\n\nSecond.\n\nThird.\n', 1, 1)
  expect(b.parts.join('')).toBe('Other first.\n\nSecond.\n\nThird.\n')
  expect(b.parts[0]).toBe('Other first.\n\nSecond.\n\n')
})

// The page: a reply drawn while it streams is the same elements as the reply drawn at once.
const html = (el: Element) => el.innerHTML.replace(/>\n+</g, '><')
async function draw(text: string, streaming: boolean, host = document.createElement('div'), root = createRoot(host)) {
  await act(async () => root.render(<Markdown text={text} streaming={streaming} />))
  return { host, root }
}
const PAGE =
  Array.from({ length: 16 }, (_, i) => `## Part ${i}\n\nSome words about part ${i}, long enough to make a real paragraph of text that fills the line.\n\n- a point\n- another point\n\n\`\`\`js\nconst v${i} = ${i}\n\`\`\`\n`).join('\n') +
  '\n<details>\n<summary>More</summary>\n\nHidden **words**.\n\n</details>\n\n- [ ] a task\n- [x] a done task\n\nThe end.\n'

test('a streamed reply ends as the same page as the reply drawn at once, and its finished parts are not drawn again', async () => {
  const { host, root } = await draw(PAGE.slice(0, 40), true)
  let firstHeading: Element | null = null
  for (let n = 80; n < PAGE.length; n += 40) {
    await draw(PAGE.slice(0, n), true, host, root)
    firstHeading ??= n > 2000 ? host.querySelector('h2') : null
  }
  await draw(PAGE, true, host, root)
  await draw(PAGE, false, host, root)
  const whole = await draw(PAGE, false)
  expect(html(host)).toBe(html(whole.host))
  expect(host.querySelectorAll('pre').length).toBe(16)
  expect(firstHeading).not.toBeNull()
  expect(host.querySelector('h2')).toBe(firstHeading) // the same element, not a new one
  // Task boxes are numbered as in the whole reply.
  expect([...host.querySelectorAll('.task-box')].map(b => b.getAttribute('aria-checked'))).toEqual(['false', 'true'])
})

// Chat text is untrusted: the sanitizer runs on every part, and HTML is never cut across parts.
test('scripts, event handlers and javascript: links stay out of a reply drawn in parts', async () => {
  const filler = (i: number) => `Paragraph ${i} of ordinary words, long enough that the splitter makes parts of the text before the HTML.\n\n`
  const bad =
    Array.from({ length: 6 }, (_, i) => filler(i)).join('') +
    '[a link](javascript:alert(1)) and ![x](javascript:alert(2))\n\n' +
    Array.from({ length: 6 }, (_, i) => filler(i + 6)).join('') +
    '<div onclick="alert(3)">\n\nInside the box.\n\n<script>window.__evil = 1</script>\n\n<img src="x" onerror="window.__evil = 2">\n\n</div>\n\n' +
    Array.from({ length: 4 }, (_, i) => filler(i + 12)).join('') +
    '<iframe src="javascript:alert(4)"></iframe>\n\nThe end.\n'
  const { host, root } = await draw(bad.slice(0, 30), true)
  for (let n = 60; n < bad.length; n += 30) {
    await draw(bad.slice(0, n), true, host, root)
    expect(host.querySelector('script, iframe, [onclick], [onerror]')).toBeNull()
    expect(host.innerHTML).not.toMatch(/javascript:/i)
  }
  await draw(bad, false, host, root)
  const whole = await draw(bad, false)
  expect(html(host)).toBe(html(whole.host))
  expect(host.querySelector('script, iframe, [onclick], [onerror]')).toBeNull()
  expect(host.innerHTML).not.toMatch(/javascript:/i)
  expect((window as unknown as { __evil?: number }).__evil).toBeUndefined()
  expect(host.textContent).toContain('Inside the box.')
})
