import { describe, expect, it } from 'vitest'
import { addQuote, clearQuotes, getQuotes, removeQuote, splitQuote, withQuotes } from './quote'

describe('withQuotes', () => {
  it('quotes one line', () => expect(withQuotes(['a'], 'why?')).toBe('> a\n\nwhy?'))
  it('quotes multi-line', () => expect(withQuotes(['a\nb'], 'why?')).toBe('> a\n> b\n\nwhy?'))
  it('separates quotes with a blank line', () => expect(withQuotes(['a', 'b'], 'x')).toBe('> a\n\n> b\n\nx'))
  it('allows empty text', () => expect(withQuotes(['a'], '')).toBe('> a'))
  it('normalises CRLF', () => expect(withQuotes(['a\r\nb'], 't')).toBe('> a\n> b\n\nt'))
  it('no quotes returns the text', () => expect(withQuotes([], 't')).toBe('t'))
})

describe('splitQuote', () => {
  const cases: [string[], string][] = [
    [['a'], 'why?'],
    [['a\nb'], 'why?'],
    [['a', 'b'], 'x\n\ny'],
    [['a\n\nb'], 'x'],
    [['a', 'b', 'c'], ''],
    [[], 'plain']
  ]
  for (const [q, t] of cases) it(`round trip ${JSON.stringify(q)}`, () => expect(splitQuote(withQuotes(q, t))).toEqual({ quotes: q, body: t }))
  it('leaves plain text', () => expect(splitQuote('no quote')).toEqual({ quotes: [], body: 'no quote' }))
  it('counts ">x" without a space as a quote line', () => expect(splitQuote('>x\n\nhi')).toEqual({ quotes: ['x'], body: 'hi' }))
  it('ignores quote lines later in the text', () => expect(splitQuote('hi\n> a')).toEqual({ quotes: [], body: 'hi\n> a' }))
})

describe('quote list', () => {
  it('keeps the last 3 and removes', () => {
    clearQuotes()
    ;['1', '2', '3', '4'].forEach(addQuote)
    expect(getQuotes()).toEqual(['2', '3', '4'])
    removeQuote(0)
    expect(getQuotes()).toEqual(['3', '4'])
    clearQuotes()
    expect(getQuotes()).toEqual([])
  })
})
