// Settings → Connectors: what Hermes can reach outside the phone. Hermes's own dashboard routes do all the work:
// MCP servers (/api/mcp/servers, /api/mcp/catalog, OAuth through /api/mcp/servers/{name}/auth), tools that need a key
// or an account (/api/tools/toolsets) and the keys bundled skills read (/api/env rows of category "skill").
// This file holds the pieces without React, so they can be unit-tested.

export interface McpServer {
  name: string
  transport: 'http' | 'stdio' | 'unknown' | string
  url?: string | null
  command?: string | null
  args?: string[]
  auth?: 'oauth' | 'header' | string | null
  enabled: boolean
  source?: 'config' | 'plugin' | string
  plugin?: string | null
}

export interface CatalogEntry {
  name: string
  description?: string
  transport?: string
  auth_type?: 'api_key' | 'oauth' | 'none' | string
  required_env?: Array<{ name: string; prompt?: string; required?: boolean }>
  url?: string | null
  command?: string | null
  needs_install?: boolean
  installed?: boolean
  enabled?: boolean
}

export interface Toolset {
  name: string
  label: string
  description?: string
  enabled: boolean
  configured: boolean
}

export interface ToolProvider {
  name: string
  tag?: string
  badge?: string
  env_vars: Array<{ key: string; prompt?: string; url?: string | null; default?: string | null; is_set: boolean }>
  post_setup?: string | null
  requires_nous_auth?: boolean
  is_active: boolean
  status?: string
}

export interface OAuthFlow {
  flow_id: string
  server_name: string
  status: 'starting' | 'authorization_required' | 'approved' | 'error' | string
  authorization_url?: string | null
  error?: string | null
}

/** The toolsets that reach a service with a key or an account, in the order the page shows them. Toolsets that only
 *  run on the phone (files, terminal, memory…) are not connectors and stay out. */
export const CONNECTOR_TOOLSETS = ['web', 'browser', 'image_gen', 'video_gen', 'tts', 'x_search', 'homeassistant', 'spotify'] as const

/** Plain words for each connector toolset (Hermes's labels are written for a terminal). */
export const TOOLSET_WORDS: Record<string, { title: string; icon: string; sub: string }> = {
  web: { title: 'Web search', icon: '🔍', sub: 'Search the web and read pages (Tavily, Exa, Firecrawl, Brave…)' },
  browser: { title: 'Browser', icon: '🌐', sub: 'Open and use websites in a cloud browser' },
  image_gen: { title: 'Image generation', icon: '🎨', sub: 'Make pictures (FAL, OpenAI, xAI…)' },
  video_gen: { title: 'Video generation', icon: '🎬', sub: 'Make short videos' },
  tts: { title: 'Hermux’s own voice', icon: '🔊', sub: 'Audio files Hermux makes (not the app’s read-aloud)' },
  x_search: { title: 'X (Twitter) search', icon: '🐦', sub: 'Search posts on X with an xAI key or sign-in' },
  homeassistant: { title: 'Home Assistant', icon: '🏠', sub: 'Lights, switches and sensors in your smart home' },
  spotify: { title: 'Spotify', icon: '🎵', sub: 'Playback, search and playlists' }
}

export type ConnState = 'connected' | 'setup' | 'off'
export const STATE_WORDS: Record<ConnState, string> = { connected: 'Connected', setup: 'Needs setup', off: 'Off' }

export const toolsetState = (t: Pick<Toolset, 'enabled' | 'configured'>): ConnState => (!t.enabled ? 'off' : t.configured ? 'connected' : 'setup')
export const serverState = (s: Pick<McpServer, 'enabled'>): ConnState => (s.enabled ? 'connected' : 'off')

/** The connector toolsets this Hermes has, in CONNECTOR_TOOLSETS order. */
export const connectorToolsets = (all: Toolset[]): Toolset[] =>
  CONNECTOR_TOOLSETS.map(n => all.find(t => t.name === n)).filter((t): t is Toolset => !!t)

/** Where a server lives, in one line: its address, or the command it runs. */
export const serverWhere = (s: McpServer): string =>
  s.url || [s.command, ...(s.args || [])].filter(Boolean).join(' ') || '—'

/** MCP server names Hermes accepts: letters, digits, - and _ (it uses the name in tool names and file names). */
export const cleanServerName = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)

/** Splits a typed command line into the command and its arguments, keeping "quoted parts" together. */
export function splitCommand(line: string): { command: string; args: string[] } {
  const parts: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) parts.push(m[1] ?? m[2] ?? m[3])
  return { command: parts[0] || '', args: parts.slice(1) }
}

/** Reads KEY=value lines (environment for a command server); blank lines and lines without "=" are skipped. */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    const k = line.slice(0, at).trim()
    if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = line.slice(at + 1).trim()
  }
  return out
}

/** The request body for POST /api/mcp/servers, or a reason it can't be sent yet. */
export function serverBody(f: { name: string; kind: 'url' | 'command'; url: string; command: string; env: string; auth: 'none' | 'oauth' | 'header'; token: string }):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; why: string } {
  const name = cleanServerName(f.name)
  if (!name) return { ok: false, why: 'Give it a name' }
  if (f.kind === 'url') {
    const url = f.url.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, why: 'The address starts with https://' }
    if (f.auth === 'header' && !f.token.trim()) return { ok: false, why: 'Paste the token' }
    return { ok: true, body: { name, url, auth: f.auth, ...(f.auth === 'header' ? { bearer_token: f.token.trim() } : {}) } }
  }
  const { command, args } = splitCommand(f.command)
  if (!command) return { ok: false, why: 'Type the command that starts the server' }
  return { ok: true, body: { name, command, args, env: parseEnvLines(f.env) } }
}

/** Env rows the Connectors page shows as "keys for skills": what bundled skills read (Notion, Linear, Airtable…) and GitHub. */
export const isSkillKey = (key: string, row: { category?: string; channel_managed?: boolean }) =>
  !row.channel_managed && (row.category === 'skill' || key === 'GITHUB_TOKEN')

/** `hermes …` with the bot's -p flag, for commands the user runs in Termux. */
export const hermesCmd = (rest: string, profile: string) => `hermes ${profile && profile !== 'default' ? `-p ${profile} ` : ''}${rest}`
