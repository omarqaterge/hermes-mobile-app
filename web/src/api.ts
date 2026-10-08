// REST calls to the Hermes dashboard on the phone (skills, cron, files, plugin memory API).
// Inside the app the Java bridge performs them (it holds the session token, and a file:// page
// can't make cross-origin requests); in a desktop browser the dev server proxies /__api/*.
import { getState } from './store'

interface HttpBridge {
  httpAsync?(id: number, method: string, path: string, body: string | null): void
}

declare global {
  interface Window {
    __hmHttp?: (id: number, status: number, body: string) => void
  }
}

const pending = new Map<number, { resolve: (v: { status: number; body: string }) => void }>()
let seq = 0

window.__hmHttp = (id, status, body) => {
  pending.get(id)?.resolve({ status, body })
  pending.delete(id)
}

function nativeHttp(method: string, path: string, body: string | null): Promise<{ status: number; body: string }> {
  const bridge = window.HermesAndroid as unknown as HttpBridge
  return new Promise(resolve => {
    const id = ++seq
    pending.set(id, { resolve })
    bridge.httpAsync!(id, method, path, body)
  })
}

async function devHttp(method: string, path: string, body: string | null) {
  const r = await fetch(`/__api${path}`, {
    method,
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body ?? undefined
  })
  return { status: r.status, body: await r.text() }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** `path` is relative to the dashboard root, e.g. `/api/skills`. Adds `profile=` automatically. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { profile?: boolean } = {}): Promise<T> {
  let full = path
  if (opts.profile !== false && !/[?&]profile=/.test(path)) {
    full += `${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(getState().profile)}`
  }
  const payload = body === undefined ? null : JSON.stringify(body)
  const bridge = window.HermesAndroid as unknown as HttpBridge | undefined
  const res = bridge?.httpAsync ? await nativeHttp(method, full, payload) : await devHttp(method, full, payload)
  let data: unknown = null
  try {
    data = res.body ? JSON.parse(res.body) : null
  } catch {
    data = res.body
  }
  if (res.status === 0) throw new ApiError(`Hermes unreachable: ${res.body}`, 0)
  if (res.status >= 400) {
    const detail = (data as { detail?: unknown })?.detail
    throw new ApiError(typeof detail === 'string' ? detail : `HTTP ${res.status}`, res.status)
  }
  return data as T
}

export const qs = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

/** Renews an expired Claude-subscription token on the phone (never throws), so the next model list can be the live one. */
export const refreshLogins = (): Promise<unknown> =>
  api('POST', '/api/plugins/hermes-mobile/refresh-logins', {}, { profile: false }).catch(() => null)
