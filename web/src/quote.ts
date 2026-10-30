import { useSyncExternalStore } from 'react'

export const QUOTE_MAX = 2000
export const QUOTES_MAX = 3

/** "> " in front of every line of each quote, quotes separated by a blank line, then the message. */
export function withQuotes(quotes: string[], text: string): string {
  const blocks = quotes.map(q =>
    q
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(l => (l ? `> ${l}` : '>'))
      .join('\n')
  )
  const body = text.replace(/\r\n?/g, '\n')
  if (!blocks.length) return body
  return body ? `${blocks.join('\n\n')}\n\n${body}` : blocks.join('\n\n')
}

/** Splits leading quote lines (a line starting with ">", with or without the space) off a sent message. */
export function splitQuote(text: string): { quotes: string[]; body: string } {
  const lines = text.split('\n')
  const quotes: string[] = []
  let i = 0
  while (i < lines.length && lines[i].startsWith('>')) {
    const block: string[] = []
    while (i < lines.length && lines[i].startsWith('>')) {
      block.push(lines[i].replace(/^> ?/, ''))
      i++
    }
    quotes.push(block.join('\n'))
    // One blank line separates quotes, and the last quote from the message.
    if (i < lines.length && lines[i] === '') {
      if (i + 1 < lines.length && lines[i + 1].startsWith('>')) i++
      else {
        i++
        break
      }
    }
  }
  if (!quotes.length) return { quotes: [], body: text }
  return { quotes, body: lines.slice(i).join('\n') }
}

// The quotes waiting in the composer (taken from the chat that is open; cleared when it changes).
let list: string[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export function addQuote(text: string): void {
  const t = text.trim()
  if (!t) return
  list = [...list, t].slice(-QUOTES_MAX)
  emit()
}
export function removeQuote(i: number): void {
  list = list.filter((_, j) => j !== i)
  emit()
}
export function clearQuotes(): void {
  if (!list.length) return
  list = []
  emit()
}
/** Put quotes back (a send failed). */
export function setQuotes(q: string[]): void {
  list = q.slice(-QUOTES_MAX)
  emit()
}
export function getQuotes(): string[] {
  return list
}
export function useQuotes(): string[] {
  return useSyncExternalStore(
    f => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => list
  )
}
