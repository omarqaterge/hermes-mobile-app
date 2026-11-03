// What Report a problem may include: the diagnostic log of every layer, put together on the phone and scrubbed, and the
// switch and delete button of Settings → About. Nothing leaves the phone from here: the sheet shows the text, and only
// its Submit sends it (report.ts).
import { api } from './api'
import { openChatText } from './applog'
import { diagBridge, isNative } from './bridge'
import { clearMemoryEvents, memoryEvents } from './diaglog'
import { scrubLog } from './report'

const ROUTE = '/api/plugins/hermes-mobile/diag'
const OFF = 'hm.diagOff'
const PENDING = 'hm.diagPending' // what Hermes's side hasn't been told yet: {enabled?, clear?}
const PLUGIN_WAIT_MS = 5000
const MAX_EVENTS = 22_000
const MAX_AGENT = 22_000

interface NativeLog {
  enabled?: boolean
  phone?: Record<string, unknown>
  lines?: string[]
}
interface PluginLog {
  enabled?: boolean
  facts?: Record<string, unknown>
  events?: string[]
  services?: Array<{ name: string; alive: boolean; log_kb: number }>
  crashes?: Array<{ service: string; type: string; at: string[]; count: number }>
}

function nativeLog(): NativeLog | null {
  if (!isNative) return null
  try {
    return JSON.parse(diagBridge.read() || '{}') as NativeLog
  } catch {
    return {}
  }
}

async function pluginLog(): Promise<PluginLog | null> {
  const wait = new Promise<null>(resolve => setTimeout(() => resolve(null), PLUGIN_WAIT_MS))
  return Promise.race([api<PluginLog>('GET', ROUTE, undefined, { profile: false }).catch(() => null), wait])
}

const facts = (o: Record<string, unknown> = {}): string =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')

/** The newest lines that fit in `max` characters. */
function newest(lines: string[], max: number): string[] {
  const out: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0 && size + lines[i].length + 1 <= max; i--) {
    out.unshift(lines[i])
    size += lines[i].length + 1
  }
  return out
}

/** Sections in this order because a GitHub link that's too long loses the top first (fallbackUrl), and the phone's
 *  facts and the app's own events say the most in the least space. */
export function diagnosticsText(native: NativeLog | null, plugin: PluginLog | null, chat: string[], browserEvents: string[]): string {
  const sections: string[] = []
  const section = (title: string, lines: string[]) => {
    if (lines.length) sections.push(`# ${title}\n${lines.join('\n')}`)
  }
  if (plugin) {
    const crashes = (plugin.crashes || []).map(c => `crash service=${c.service} type=${/^[A-Za-z0-9_.]{1,32}$/.test(c.type) ? c.type : 'unknown'} count=${c.count} at=${(c.at || []).join(',') || 'none'}`)
    const services = (plugin.services || []).map(s => `service name=${s.name} alive=${s.alive} log_kb=${s.log_kb}`)
    section('Agent side', newest([facts(plugin.facts), ...services, ...crashes, ...(plugin.events || [])].filter(Boolean), MAX_AGENT))
  } else section('Agent side', ['Not available: Hermux is offline, or its plugin is older than this app.'])
  section('App events', newest(native ? native.lines || [] : browserEvents, MAX_EVENTS))
  if (native) section('Phone', [facts(native.phone)].filter(Boolean))
  return scrubLog(sections.join('\n\n'), chat)
}

/** The text the sheet shows, and sends only if the user submits it. */
export async function collectDiagnostics(): Promise<string> {
  return diagnosticsText(nativeLog(), await pluginLog(), openChatText(), memoryEvents())
}

export function diagnosticsEnabled(): boolean {
  const n = diagBridge.enabled()
  if (typeof n === 'boolean') return n
  try {
    return localStorage.getItem(OFF) !== '1'
  } catch {
    return true
  }
}

function pending(): { enabled?: boolean; clear?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PENDING) || '{}') as { enabled?: boolean; clear?: boolean }
  } catch {
    return {}
  }
}
function setPending(p: { enabled?: boolean; clear?: boolean }): void {
  try {
    if (p.enabled === undefined && !p.clear) localStorage.removeItem(PENDING)
    else localStorage.setItem(PENDING, JSON.stringify(p))
  } catch {
    /* private mode */
  }
}

/** Tells Hermes's side what the user chose: now, or at the next connection if it is offline. */
export function flushDiagToPlugin(): void {
  const p = pending()
  if (p.enabled !== undefined) {
    api('PUT', ROUTE, { enabled: p.enabled }, { profile: false }).then(
      () => {
        const now = pending()
        if (now.enabled === p.enabled) setPending({ clear: now.clear })
      },
      () => {}
    )
  }
  if (p.clear) {
    api('DELETE', ROUTE, undefined, { profile: false }).then(
      () => setPending({ enabled: pending().enabled }),
      () => {}
    )
  }
}

export function clearDiagnostics(): void {
  diagBridge.clear()
  clearMemoryEvents()
  setPending({ ...pending(), clear: true })
  flushDiagToPlugin()
}

/** Off stops the log on every layer and deletes what was kept. */
export function setDiagnosticsEnabled(on: boolean): void {
  diagBridge.setEnabled(on)
  try {
    if (on) localStorage.removeItem(OFF)
    else localStorage.setItem(OFF, '1')
  } catch {
    /* private mode */
  }
  if (!on) clearMemoryEvents()
  setPending({ ...pending(), enabled: on })
  flushDiagToPlugin()
}
