// A phone-data approval from the Hermux plugin (docs/status/phone-data.md): the agent wants to read the phone's contacts,
// calendar, call log, messages, location or latest photos. The description is
//   phone_data:v1:<kind>:<12 lowercase hex nonce>:<hex of the canonical args text>
// This file parses it strictly and writes the plain wording the user is asked to allow, from the decoded args and nothing
// else (never the plugin's own text). The decoded text is data: callers render it as text, never as markup. Anything
// that doesn't parse exactly gets a warning and no Allow at all. HermesService.java (PhoneDataRoute.wording) does the
// same for notifications; keep the two in step.

export const PHONE_DATA_KINDS = ['contacts', 'calendar', 'calls', 'sms', 'location', 'photos'] as const
export type PhoneDataKind = (typeof PHONE_DATA_KINDS)[number]

export interface PhoneDataRequest {
  kind: PhoneDataKind
  nonce: string
  /** The decoded canonical args text, exactly as the plugin made it (a read must match it to the letter). */
  argsText: string
  args: Record<string, unknown>
}

const MAX_ARGS = 1024
const MAX_TEXT = 64
const KEYS: Record<PhoneDataKind, string[]> = {
  contacts: ['limit', 'query'],
  calendar: ['limit', 'from_ms', 'to_ms'],
  calls: ['limit', 'from_ms', 'to_ms'],
  sms: ['limit', 'box', 'sender'],
  location: [],
  photos: ['limit']
}

/** True for any text that claims to be a phone-data request, well formed or not. */
export const isPhoneDataText = (s: unknown): s is string => typeof s === 'string' && s.startsWith('phone_data:')

const isHex = (s: string, min: number, max: number): boolean => s.length >= min && s.length <= max && /^[0-9a-f]*$/.test(s)

/** Strictly parses the description; null for anything that is not exactly the contract's text with the contract's args
 *  (an unknown kind, key or type, a limit outside 1 to 50, text over 64 characters, bad hex, non-ASCII, ...). */
export function parsePhoneData(description: unknown): PhoneDataRequest | null {
  if (typeof description !== 'string' || description.length > 14 + 40 + 2 * MAX_ARGS) return null
  const p = description.split(':')
  if (p.length !== 5 || p[0] !== 'phone_data' || p[1] !== 'v1') return null
  const kind = p[2] as PhoneDataKind
  if (!PHONE_DATA_KINDS.includes(kind) || !isHex(p[3], 12, 12) || !isHex(p[4], 2, 2 * MAX_ARGS) || p[4].length % 2 !== 0) return null
  const bytes = new Uint8Array(p[4].length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(p[4].slice(2 * i, 2 * i + 2), 16)
  let argsText: string
  try {
    argsText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  if (!/^[\x20-\x7e]*$/.test(argsText) || !argsText.startsWith('{') || !argsText.endsWith('}')) return null
  let args: unknown
  try {
    args = JSON.parse(argsText)
  } catch {
    return null
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const a = args as Record<string, unknown>
  for (const k of Object.keys(a)) if (!KEYS[kind].includes(k)) return null
  if ('limit' in a && !(Number.isInteger(a.limit) && (a.limit as number) >= 1 && (a.limit as number) <= 50)) return null
  for (const k of ['query', 'sender']) if (k in a && !(typeof a[k] === 'string' && (a[k] as string).length <= MAX_TEXT)) return null
  for (const k of ['from_ms', 'to_ms']) if (k in a && !Number.isSafeInteger(a[k])) return null
  if ('box' in a && !(a.box === 'inbox' || a.box === 'sent' || a.box === 'all')) return null
  return { kind, nonce: p[3], argsText, args: a }
}

/** Decoded text made safe to show: control and invisible formatting characters become spaces. */
const clean = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ').trim()

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function range(a: Record<string, unknown>, dflt: string): string {
  const has = (k: string) => typeof a[k] === 'number'
  if (!has('from_ms') && !has('to_ms')) return ` ${dflt}`
  const f = (k: string, none: string) => (has(k) ? new Date(a[k] as number).toLocaleString() : none)
  return ` between ${f('from_ms', 'now')} and ${f('to_ms', 'the end of the default range')}`
}

/** The sentence the user is asked to allow, from the decoded args. */
export function phoneDataWording(r: PhoneDataRequest): string {
  const a = r.args
  const limit = typeof a.limit === 'number' ? a.limit : 20
  switch (r.kind) {
    case 'contacts': {
      const q = typeof a.query === 'string' ? clean(a.query) : ''
      return `Read up to ${plural(limit, 'contact', 'contacts')}${q ? ` matching “${q}”` : ''} from your address book`
    }
    case 'calendar':
      return `Read up to ${plural(limit, 'calendar event', 'calendar events')}${range(a, 'in the next 7 days')}`
    case 'calls':
      return `Read up to ${plural(limit, 'call log entry', 'call log entries')}${range(a, 'from the last 7 days')}`
    case 'sms': {
      const s = typeof a.sender === 'string' ? clean(a.sender) : ''
      return `Read up to ${plural(limit, 'text message', 'text messages')}${a.box === 'inbox' ? ' you received' : a.box === 'sent' ? ' you sent' : ''}${s ? ` from or to “${s}”` : ''}`
    }
    case 'location':
      return 'Read your approximate location'
    case 'photos':
      return `Read the date, size and dimensions of your latest ${plural(limit, 'photo', 'photos')} (no pictures)`
  }
}

export const PHONE_DATA_WARNING = 'Hermux got a phone data request it can’t read, so it can’t be allowed. Deny it.'

/** What the sheet, the fingerprint prompt and a voice prompt say: the wording, or the warning (no Allow) if it is unreadable. */
export function phoneDataView(description: string): { ok: true; request: PhoneDataRequest; text: string } | { ok: false; text: string } {
  const request = parsePhoneData(description)
  return request ? { ok: true, request, text: phoneDataWording(request) } : { ok: false, text: PHONE_DATA_WARNING }
}

// ── the shell's side (PhoneDataGrants.java), through the per-page-key bridge that secure-bridge.ts wraps ──

type PhoneDataBridge = {
  phoneDataGrant?: (description: string) => unknown
  phoneDataFullAccess?: (session: string, on: boolean) => void
}
const bridge = () => window.HermesAndroid as unknown as PhoneDataBridge | undefined

/** The user tapped Allow on this phone-data request: asks the shell for the one-use grant for exactly this read. False
 *  when it can't (no shell, an older shell, or the shell refused the text): the Allow must not go to Hermes then. */
export function mintPhoneDataGrant(description: string): boolean {
  try {
    const b = bridge()
    if (typeof b?.phoneDataGrant !== 'function') return false
    const r = b.phoneDataGrant(description)
    return !(r === false || r === 'false' || r === 0 || r === '0' || r === 'no')
  } catch {
    return false
  }
}

/** This chat (its stored id) is, or is no longer, in Full access: the shell keeps the pass in memory only. An empty
 *  session turned off clears every chat. Does nothing without the shell's method. */
export function setPhoneDataFullAccess(session: string, on: boolean): void {
  try {
    bridge()?.phoneDataFullAccess?.(session, on)
  } catch {
    // no shell: nothing can read the phone anyway
  }
}

/** The phone-data text of an approval's params (the description; the command as a fallback), or null for an ordinary approval. */
export function phoneDataTextOf(params: Record<string, unknown>): string | null {
  for (const v of [params.description, params.command]) {
    const first = typeof v === 'string' ? v.split('\n')[0] : ''
    if (isPhoneDataText(first)) return first
  }
  return null
}
