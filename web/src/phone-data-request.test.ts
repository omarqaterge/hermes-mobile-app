// @vitest-environment happy-dom
// Phone-data approvals: strict parsing of the description, the app's own wording, hostile decoded text, bad input, and
// the shell's grant / Full access pass calls.
import { afterEach, expect, test, vi } from 'vitest'
import {
  isPhoneDataText,
  mintPhoneDataGrant,
  parsePhoneData,
  PHONE_DATA_WARNING,
  phoneDataTextOf,
  phoneDataView,
  setPhoneDataFullAccess
} from './phone-data-request'

const hex = (s: string) => Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
const NONCE = '0123456789ab'
const make = (kind: string, args: unknown, nonce = NONCE) => `phone_data:v1:${kind}:${nonce}:${hex(typeof args === 'string' ? args : JSON.stringify(args))}`
const text = (kind: string, args: unknown) => {
  const v = phoneDataView(make(kind, args))
  return v.ok ? v.text : null
}

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
})

test('a well-formed text parses to kind, nonce and the exact args text', () => {
  const args = '{"limit":5,"query":"ann"}'
  const r = parsePhoneData(make('contacts', args))
  expect(r).toMatchObject({ kind: 'contacts', nonce: NONCE, argsText: args, args: { limit: 5, query: 'ann' } })
})

test('wording is written from the decoded args', () => {
  expect(text('contacts', { limit: 20 })).toBe('Read up to 20 contacts from your address book')
  expect(text('contacts', { limit: 1, query: 'Ann' })).toBe('Read up to 1 contact matching “Ann” from your address book')
  expect(text('sms', { limit: 20, box: 'inbox', sender: '+15551234567' })).toBe('Read up to 20 text messages you received from or to “+15551234567”')
  expect(text('sms', { limit: 3, box: 'sent' })).toBe('Read up to 3 text messages you sent')
  expect(text('sms', {})).toBe('Read up to 20 text messages')
  expect(text('location', {})).toBe('Read your approximate location')
  expect(text('photos', { limit: 10 })).toBe('Read the date, size and dimensions of your latest 10 photos (no pictures)')
  expect(text('calendar', {})).toBe('Read up to 20 calendar events in the next 7 days')
  expect(text('calls', {})).toBe('Read up to 20 call log entries from the last 7 days')
  expect(text('calls', { limit: 2, from_ms: 1_700_000_000_000, to_ms: 1_700_100_000_000 })).toMatch(/^Read up to 2 call log entries between .+ and .+/)
})

test('the plugin\'s own words are never used: the wording comes from the args only', () => {
  const v = phoneDataView(make('location', {}))
  expect(v.ok && v.text).toBe('Read your approximate location')
})

test('hostile decoded text stays plain text', () => {
  const evil = '<img src=x onerror=alert(1)> **bold** [x](javascript:alert(1))'
  const r = text('contacts', { query: evil.slice(0, 64) })
  expect(r).toContain('<img src=x')
  // it is returned as a string for React to render as text; control and invisible characters are turned into spaces
  expect(text('contacts', { query: 'a‮b' })).toBe(null) // raw non-ASCII is not even parseable (the contract is ASCII)
  // escaped control and direction characters decode in the JSON; the wording turns them into spaces
  expect(text('contacts', '{"query":"a\\u202eb\\u0007c"}')).toBe('Read up to 20 contacts matching “a b c” from your address book')
})

test('anything that is not exactly the contract does not parse', () => {
  const ok = make('contacts', { limit: 5 })
  const bad: unknown[] = [
    null,
    undefined,
    42,
    '',
    'phone_data:',
    ok.replace('v1', 'v2'),
    ok.replace('phone_data', 'Phone_data'),
    ok.replace('contacts', 'files'),
    make('contacts', { limit: 5 }, '0123456789a'),
    make('contacts', { limit: 5 }, '0123456789abc'),
    make('contacts', { limit: 5 }, '0123456789AB'),
    make('contacts', { limit: 5 }, '0123456789ag'),
    ok + '0',
    ok + ':00',
    ok.slice(0, ok.lastIndexOf(':')),
    `phone_data:v1:contacts:${NONCE}:`,
    `phone_data:v1:contacts:${NONCE}:ff7b7d`,
    make('contacts', '[1]'),
    make('contacts', 'x'),
    make('contacts', '{"limit":5'),
    make('contacts', { limit: 0 }),
    make('contacts', { limit: 51 }),
    make('contacts', { limit: 1.5 }),
    make('contacts', { limit: '5' }),
    make('contacts', { query: 'a'.repeat(65) }),
    make('contacts', { query: 5 }),
    make('contacts', { sender: 'x' }),
    make('contacts', { surprise: 1 }),
    make('location', { limit: 5 }),
    make('sms', { box: 'drafts' }),
    make('calendar', { from_ms: 'now' }),
    make('calendar', { from_ms: 1.5 }),
    make('contacts', '{"q":"é"}'),
    make('contacts', '{"q":"a\nb"}'),
    make('contacts', { query: 'a'.repeat(5000) })
  ]
  for (const b of bad) expect(parsePhoneData(b), String(b).slice(0, 80)).toBeNull()
})

test('unparseable phone_data text shows the warning and no Allow', () => {
  const v = phoneDataView('phone_data:v1:contacts:zz')
  expect(v).toEqual({ ok: false, text: PHONE_DATA_WARNING })
  expect(isPhoneDataText('phone_data:anything') && !isPhoneDataText('rm -rf /') && !isPhoneDataText(null)).toBe(true)
})

test('the approval text is found in the description, or the command', () => {
  const d = make('location', {})
  expect(phoneDataTextOf({ description: d })).toBe(d)
  expect(phoneDataTextOf({ description: 'ordinary', command: d })).toBe(d)
  expect(phoneDataTextOf({ description: `${d}\nextra line` })).toBe(d)
  expect(phoneDataTextOf({ description: 'delete the temp folder', command: 'rm -rf /tmp/x' })).toBeNull()
  expect(phoneDataTextOf({ description: 'see phone_data:v1 in the middle' })).toBeNull()
})

test('the grant and the pass go to the shell, and fail closed without it', () => {
  const d = make('location', {})
  expect(mintPhoneDataGrant(d)).toBe(false) // no shell
  expect(() => setPhoneDataFullAccess('chat', true)).not.toThrow()
  const grant = vi.fn(() => true)
  const full = vi.fn()
  ;(window as unknown as { HermesAndroid: unknown }).HermesAndroid = { phoneDataGrant: grant, phoneDataFullAccess: full }
  expect(mintPhoneDataGrant(d)).toBe(true)
  expect(grant).toHaveBeenCalledWith(d)
  setPhoneDataFullAccess('chat', true)
  expect(full).toHaveBeenCalledWith('chat', true)
  ;(window as unknown as { HermesAndroid: unknown }).HermesAndroid = { phoneDataGrant: () => false }
  expect(mintPhoneDataGrant(d)).toBe(false) // the shell refused
  ;(window as unknown as { HermesAndroid: unknown }).HermesAndroid = {
    phoneDataGrant: () => {
      throw new Error('boom')
    }
  }
  expect(mintPhoneDataGrant(d)).toBe(false)
})
