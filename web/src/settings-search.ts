// Settings search: one flat list of everything the Settings screen offers (its page, the words on screen, extra
// search words), searched as the user types. Choosing a result opens that page and flashes the row whose title (or
// section heading) is `find`. The Hermux settings come from the catalog in hermes-settings.ts; the rest is kept here
// by hand, so a new setting in Settings.tsx belongs in this list too.
import { HERMES_SETTINGS } from './hermes-settings'

export type SettingsPageId = 'hub' | 'appearance' | 'voice' | 'stt' | 'models' | 'accounts' | 'keys' | 'connectors' | 'hermes' | 'config'

export interface SettingsEntry {
  /** The page to open. */
  page: SettingsPageId
  /** The row title or section heading to scroll to and flash (none: the page itself). */
  find?: string
  title: string
  sub?: string
  /** Where it lives, shown under the title ("Voice › Live mode"). */
  where: string
  /** Extra words that should find it. */
  words?: string
}

const PAGE_NAME: Record<SettingsPageId, string> = { hub: 'Settings', appearance: 'Appearance', voice: 'Voice', stt: 'Speech recognition', models: 'Default models', accounts: 'Model providers', keys: 'API keys', connectors: 'Connectors', hermes: 'Hermux settings', config: 'Advanced settings' }

const e = (page: SettingsPageId, title: string, where: string, sub?: string, words?: string, find: string | null = title): SettingsEntry => ({ page, title, where, sub, words, find: find ?? undefined })

const STATIC: SettingsEntry[] = [
  // Hub
  e('appearance', 'Appearance', 'Settings', 'Theme and text size', 'theme dark light oled font look', null),
  e('hub', 'Read every reply aloud', 'Settings › Voice', 'In all chats', 'tts speak speech auto read'),
  e('voice', 'Voice', 'Settings', 'Engine, voice, speed and pitch', 'tts speech speak', null),
  e('models', 'Default models', 'Settings › Hermux', 'Which model each bot starts with', 'model bot profile', null),
  e('accounts', 'Model providers', 'Settings › Hermux', 'Sign-ins, API keys, your own server', 'login account chatgpt claude openai nous grok minimax', null),
  e('keys', 'API keys', 'Settings › Hermux', 'Providers and tools', 'token secret env openai tavily', null),
  e('connectors', 'Connectors', 'Settings › Hermux', 'MCP servers, web search, Home Assistant and other services', 'mcp integrations services plugins skills', null),
  e('hermes', 'Hermux settings', 'Settings › Hermux', 'Limits, memory, long chats, sub-agents, safety', 'agent hermes config', null),
  e('config', 'Advanced settings', 'Settings › Hermux', 'Every Hermux option, by its config name', 'config yaml hermes agent options', null),
  e('hub', 'Auto for all chats', 'Settings › Permissions', 'What new and existing chats start in', 'yolo full access approve run without asking permission'),
  e('hub', 'Confirm approvals with fingerprint', 'Settings › Permissions', undefined, 'biometric lock screen security approval'),
  e('hub', 'Dynamic UI', 'Settings › Replies', 'Tables, charts and forms you can tap', 'openui cards plugin'),
  e('hub', 'Phone data for the agent', 'Settings', 'Contacts, calendar, call log, messages, location and latest photos', 'read permission privacy sms contacts calls location photos'),
  e('hub', 'Let the agent read phone data', 'Settings › Phone data for the agent', undefined, 'contacts calendar call log messages sms location photos privacy master'),
  e('hub', 'Allow banking, payment, password and 2FA apps', 'Settings › Background apps', "Off: Hermux won't open them in the background", 'hidden screen phone control sensitive'),
  e('hub', 'Status', 'Settings › Connection', undefined, 'connected offline'),
  e('hub', 'Reconnect / start Hermux', 'Settings › Connection', undefined, 'restart connection'),
  e('hub', 'Setup check', 'Settings › Connection', 'Permissions, background running, the plugin', 'battery notifications diagnose'),
  e('hub', 'Check for updates', 'Settings › About', undefined, 'update app version install download'),
  e('hub', 'Report a problem', 'Settings › About', 'Becomes a public issue on GitHub', 'bug issue feedback'),
  e('hub', 'Keep a diagnostic log', 'Settings › About', undefined, 'debug logs'),
  e('hub', 'Hermux agent', 'Settings › About', undefined, 'hermes version'),
  e('hub', 'Hermux plugin', 'Settings › About', undefined, 'plugin update sync'),
  e('hub', 'Share anonymous usage stats', 'Settings › About', undefined, 'analytics telemetry privacy'),
  e('hub', 'Remote debugging', 'Settings › About', undefined, 'developer adb'),
  e('hub', 'Uninstall Hermux', 'Settings › Danger zone', 'Hermux, Debian, chats, Termux and the helper apps', 'remove delete backup'),
  // Appearance
  e('appearance', 'Theme', 'Appearance', 'Default, OLED black, Light or System', 'dark light oled black system colors'),
  e('appearance', 'Text size', 'Appearance', undefined, 'font bigger larger smaller zoom'),
  // Voice
  e('voice', 'Speech engine', 'Voice', undefined, 'tts text to speech'),
  e('voice', 'Speed', 'Voice › Sound', undefined, 'rate faster slower'),
  e('voice', 'Pitch', 'Voice › Sound', undefined, 'tone'),
  e('voice', 'Speech recognition', 'Voice › Dictation', 'Speech-to-text for the microphone button and Live mode', 'stt dictation microphone whisper model offline'),
  e('voice', 'Live mode', 'Voice', undefined, 'conversation hands free'),
  e('voice', 'Pause before sending', 'Voice › Live mode', undefined, 'silence wait'),
  e('voice', 'Interrupt by talking', 'Voice › Live mode', 'Talk over Hermux to cut it off', 'barge in'),
  e('voice', 'Test voice', 'Voice', 'Plays a sample sentence with these settings'),
  e('voice', 'Reset voice settings', 'Voice'),
  e('stt', "Phone’s speech recognition", 'Speech recognition', 'Android’s recogniser (usually Google’s)', 'stt google'),
  e('stt', 'Add from Hugging Face', 'Speech recognition', 'Paste the model’s link', 'model download onnx'),
  e('stt', 'Add files from this phone', 'Speech recognition', 'The model’s .onnx files and tokens.txt, or a .zip', 'model import'),
  // Models, providers, keys
  e('models', 'Set one model for all bots', 'Default models'),
  e('accounts', 'Fallback models', 'Model providers', 'Tried when a model fails', 'rotation backup failover'),
  e('keys', 'Only keys that are set', 'API keys', 'Turn off to see every key Hermux supports'),
  e('keys', 'Add a custom key', 'API keys', undefined, 'env variable secret'),
  // Connectors
  e('connectors', 'Apps and services (MCP)', 'Connectors', 'Notion, Linear, GitHub, your own server…', 'mcp server notion github linear'),
  e('connectors', 'Add from the catalog', 'Connectors', 'Services Hermux knows how to connect', 'mcp'),
  e('connectors', 'Add a server', 'Connectors', 'By its address, or a command that starts it', 'mcp url'),
  e('connectors', 'Tools with a key or an account', 'Connectors', undefined, 'web search home assistant toolsets'),
  e('connectors', 'Keys for skills', 'Connectors', 'Hermux’s skills read the key from the bot’s .env', 'skills api key')
]

const HERMUX: SettingsEntry[] = HERMES_SETTINGS.flatMap(g => g.items.map(s => ({ page: 'hermes' as const, find: s.label, title: s.label, sub: s.help, where: `Hermux settings › ${g.title}`, words: s.key.replace(/[._]/g, ' ') })))

/** Dotted config paths the running Hermes has (set by the Hermux settings page once loaded); null: not known yet. */
let known: ((key: string) => boolean) | null = null
export function setKnownHermesKeys(has: ((key: string) => boolean) | null): void {
  known = has
}

function all(): SettingsEntry[] {
  if (!known) return [...STATIC, ...HERMUX]
  const keys = new Map(HERMES_SETTINGS.flatMap(g => g.items.map(s => [s.label, s.key] as const)))
  return [...STATIC, ...HERMUX.filter(h => known!(keys.get(h.title) || ''))]
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ’']/g, '')

/** Entries whose title, text, place or search words contain every word typed, best first (title starts > title has > rest). */
export function searchSettings(query: string, limit = 30): SettingsEntry[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: Array<[number, SettingsEntry]> = []
  for (const en of all()) {
    const title = norm(en.title)
    const hay = `${title} ${norm(en.sub || '')} ${norm(en.where)} ${norm(PAGE_NAME[en.page])} ${norm(en.words || '')}`
    if (!terms.every(t => hay.includes(t))) continue
    const score = terms.every(t => title.startsWith(t) || title.includes(` ${t}`)) ? 0 : terms.every(t => title.includes(t)) ? 1 : 2
    scored.push([score, en])
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(x => x[1])
}

export { PAGE_NAME as SETTINGS_PAGE_NAME }
