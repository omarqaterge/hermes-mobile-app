// Small pure helpers for OpenUI cards in chat (components/OpenUIBlock.tsx). No OpenUI imports: this stays in the
// main bundle while OpenUI itself loads lazily.

/** What OpenUI's Renderer passes to onAction (react-lang ActionEvent, the parts we use). */
export interface UiAction {
  type: string
  params?: Record<string, unknown>
  humanFriendlyMessage?: string
  formState?: Record<string, unknown>
  formName?: string
}

function show(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(show).filter(Boolean).join(', ')
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).trim()
}

/** Field name → shown value from OpenUI's form state ({ form: { field: { value } } } or { field: { value } }). */
export function formFields(state: unknown): [string, string][] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const out: [string, string][] = []
  for (const [k, raw] of Object.entries(state as Record<string, unknown>)) {
    if (k.startsWith('$')) continue // UI state ($filters, tabs), not an answer
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>
      if ('value' in o) {
        const s = show(o.value)
        if (s) out.push([k, s])
      } else out.push(...formFields(o)) // a whole form
      continue
    }
    const s = show(raw)
    if (s) out.push([k, s])
  }
  return out
}

/** The user turn a card button sends: its words, then any form values as "- field: value" lines. */
export function actionMessage(e: UiAction): string {
  const parts: string[] = []
  const head = (e.humanFriendlyMessage || '').trim()
  if (head) parts.push(head)
  const fields = formFields(e.formState)
  if (fields.length) parts.push(fields.map(([k, v]) => `- ${k}: ${v}`).join('\n'))
  const ctx = e.params?.context
  if (ctx !== undefined && ctx !== null && ctx !== '') parts.push(`(${typeof ctx === 'string' ? ctx : JSON.stringify(ctx)})`)
  return parts.join('\n\n')
}

/** A link a card may open: http(s) only, never javascript:, file: or app-internal schemes. */
export function safeHttpUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const x = new URL(u)
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null
  } catch {
    return null
  }
}

// Form/$variable state per card, so a reopened chat shows what you typed. Key = `${storedChatId}:${hashText(code)}`.
// Bounded: the newest 150 cards and 300K chars in total.
const KEY = 'hm.openui.v1'
const MAX = 150
const MAX_CHARS = 300_000
type Saved = Record<string, { at: number; s: Record<string, unknown> }>

function readAll(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export function loadUiState(k: string): Record<string, unknown> | undefined {
  return readAll()[k]?.s
}

export function saveUiState(k: string, s: Record<string, unknown>, now = Date.now()): void {
  const all = readAll()
  if (Object.keys(s).length) all[k] = { at: now, s }
  else delete all[k]
  const newestFirst = Object.keys(all).sort((a, b) => all[b].at - all[a].at)
  for (const old of newestFirst.slice(MAX)) delete all[old]
  let json = JSON.stringify(all)
  for (const old of newestFirst.slice(0, MAX).reverse()) {
    if (json.length <= MAX_CHARS) break
    delete all[old]
    json = JSON.stringify(all)
  }
  try {
    localStorage.setItem(KEY, json)
  } catch {
    /* storage full: the card just starts empty next time */
  }
}
