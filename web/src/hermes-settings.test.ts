// The Hermes settings catalog: every option is one the pinned Hermes has, and typed values are checked and shown right.
import { readFileSync } from 'fs'
import { expect, test } from 'vitest'
import { HERMES_SETTINGS, hasPath, inputText, nested, parseInput, readPath, shown, type HSetting } from './hermes-settings'

const defaults = JSON.parse(readFileSync(new URL('../../tools/web-e2e/fixtures/hermes-config-defaults.json', import.meta.url), 'utf8'))
const all = HERMES_SETTINGS.flatMap(g => g.items)
const find = (k: string) => all.find(s => s.key === k) as HSetting

test('every option exists in the pinned Hermes, once, with a default of its kind', () => {
  expect(new Set(all.map(s => s.key)).size).toBe(all.length)
  for (const s of all) {
    expect(hasPath(defaults, s.key), s.key).toBe(true)
    const d = readPath(defaults, s.key)
    if (s.kind === 'toggle') expect(typeof d, s.key).toBe('boolean')
    if (s.kind === 'list') expect(Array.isArray(d), s.key).toBe(true)
    if (s.kind === 'text') expect(typeof d, s.key).toBe('string')
    if (s.kind === 'choice') expect(s.options.some(o => JSON.stringify(o.value) === JSON.stringify(d)), s.key).toBe(true)
    if (s.kind === 'number') {
      if (d === null) expect(s.nullLabel, s.key).toBeTruthy()
      else expect(d as number, s.key).toBeGreaterThanOrEqual(s.min), expect(d as number, s.key).toBeLessThanOrEqual(s.max)
    }
    expect(s.help.length, s.key).toBeGreaterThan(5)
  }
})

test('numbers: range, whole numbers, percentages', () => {
  const retries = find('agent.api_max_retries')
  expect(parseInput(retries, '2')).toEqual({ value: 2 })
  expect(parseInput(retries, '11')).toEqual({ error: 'Between 1 and 10' })
  expect(parseInput(find('agent.max_turns'), '1,000')).toEqual({ value: 1000 }) // thousands, as the rows show numbers
  expect(parseInput(find('web.extract_char_limit'), '15,000')).toEqual({ value: 15000 })
  expect(parseInput(retries, '1.5')).toEqual({ error: 'Enter a whole number' })
  expect(parseInput(retries, 'abc')).toEqual({ error: 'Enter a number' })
  expect(parseInput(retries, '')).toEqual({ error: 'Enter a number' })
  const at = find('compression.threshold')
  expect(parseInput(at, '75')).toEqual({ value: 0.75 })
  expect(parseInput(at, '75 %')).toEqual({ value: 0.75 })
  expect(parseInput(at, '99')).toEqual({ error: 'Between 10 % and 95 %' })
  expect(inputText(at, 0.5)).toBe('50')
  expect(shown(at, 0.5)).toBe('50 %')
})

test('shown: units, zero and null meanings, choices, lists', () => {
  expect(shown(find('terminal.timeout'), 180)).toBe('180 s')
  expect(shown(find('memory.nudge_interval'), 0)).toBe('Off')
  expect(shown(find('agent.max_turns'), null)).toBe('No limit')
  expect(shown(find('agent.verify_on_stop'), 'auto')).toBe('For coding')
  expect(shown(find('agent.verify_on_stop'), false)).toBe('Off')
  expect(shown(find('approvals.deny'), ['a', 'b'])).toBe('2 items')
  expect(shown(find('timezone'), '')).toBe('Not set')
})

test('lists and time zones', () => {
  expect(parseInput(find('approvals.deny'), ' rm -rf /*\n\n sudo * ')).toEqual({ value: ['rm -rf /*', 'sudo *'] })
  const tz = find('timezone')
  expect(parseInput(tz, 'Europe/Amsterdam', ['Europe/Amsterdam', 'UTC'])).toEqual({ value: 'Europe/Amsterdam' })
  expect(parseInput(tz, '', ['UTC'])).toEqual({ value: '' })
  expect('error' in parseInput(tz, 'Mars/Base', ['UTC'])).toBe(true)
  expect(parseInput(tz, 'Mars/Base', [])).toEqual({ value: 'Mars/Base' }) // no list from Hermes: Hermes checks it
})

test('nested writes the dotted path as PUT /api/config merges it', () => {
  expect(nested('security.website_blocklist.enabled', true)).toEqual({ security: { website_blocklist: { enabled: true } } })
})
