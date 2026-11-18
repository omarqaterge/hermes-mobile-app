// Settings search: one flat list of everything the Settings screen offers (its page, the words on screen, extra
// search words), searched as the user types. Choosing a result opens that page and flashes the row whose title (or
// section heading) is `find`. The Behaviour page's options come from the catalog in hermes-settings.ts; the rest is kept
// here by hand, so a new setting in Settings.tsx belongs in this list too. `where` names the place as the pages show it
// (Settings → Access & privacy → Approvals).
import { HERMES_SETTINGS } from './hermes-settings'

export type SettingsPageId = 'hub' | 'appearance' | 'voice' | 'stt' | 'models' | 'defaults' | 'accounts' | 'keys' | 'connectors' | 'hermes' | 'memory' | 'config' | 'access' | 'about'

export interface SettingsEntry {
  /** The page to open. */
  page: SettingsPageId
  /** The row title or section heading to scroll to and flash (none: the page itself). */
  find?: string
  title: string
  sub?: string
  /** Where it lives, shown under the title ("Voice → Live mode"). */
  where: string
  /** Extra words that should find it. */
  words?: string
}

/** Each page's name, also the top bar's title (Settings.tsx). `hermes` is Behaviour, once "Hermux settings". */
const PAGE_NAME: Record<SettingsPageId, string> = {
  hub: 'Settings', appearance: 'Appearance', voice: 'Voice', stt: 'Speech recognition', models: 'Models', defaults: 'Default models',
  accounts: 'Model providers', keys: 'API keys', connectors: 'Connectors', hermes: 'Behaviour', memory: 'Memory', config: 'Advanced settings',
  access: 'Access & privacy', about: 'About & help'
}

const e = (page: SettingsPageId, title: string, where: string, sub?: string, words?: string, find: string | null = title): SettingsEntry => ({ page, title, where, sub, words, find: find ?? undefined })

const STATIC: SettingsEntry[] = [
  // The main page: Hermux
  e('models', 'Models', 'Settings → Hermux', 'Default models, model providers and keys', 'model bot profile provider', null),
  e('connectors', 'Connectors', 'Settings → Hermux', 'Mail, web search, apps and services', 'mcp integrations services plugins skills home assistant', null),
  e('hermes', 'Behaviour', 'Settings → Hermux', 'Memory, long chats, limits, sub-agents', 'hermux settings agent hermes config safety', null),
  e('access', 'Access & privacy', 'Settings → Hermux', 'Approvals, phone data, background apps, what stays on this phone', 'permissions privacy security', null),
  // The main page: This app
  e('appearance', 'Appearance', 'Settings → This app', 'Theme, text size and effects', 'theme dark light oled font look glass animations model bar', null),
  e('voice', 'Voice', 'Settings → This app', 'Read aloud, dictation, Live mode', 'tts speech speak', null),
  e('about', 'About & help', 'Settings → This app', 'Updates, help, versions', 'version info', null),
  // Models
  e('defaults', 'Default models', 'Settings → Models', 'Which model each bot starts with', 'model bot profile', null),
  e('accounts', 'Model providers', 'Settings → Models', 'Sign-ins, API keys, your own server', 'login account chatgpt claude openai nous grok minimax', null),
  e('keys', 'All keys', 'Settings → Models', 'Every key of providers and tools', 'api keys token secret env openai tavily', null),
  // Behaviour
  e('hermes', 'Dynamic UI', 'Behaviour → Replies', 'Tables, charts and forms you can tap', 'openui cards plugin'),
  e('memory', 'Memory', 'Behaviour → Memory', 'See what Hermux remembers', 'remember notes profile of you', null),
  e('config', 'Advanced settings', 'Behaviour', 'Every option, by its config name', 'config yaml hermes agent options', null),
  // Access & privacy
  e('access', 'Auto for all chats', 'Access & privacy → Approvals', 'What new and existing chats start in', 'yolo full access approve run without asking permission'),
  e('access', 'Confirm approvals with fingerprint', 'Access & privacy → Approvals', undefined, 'biometric lock screen security approval permission'),
  e('access', 'Phone data for the agent', 'Access & privacy', 'Contacts, calendar, call log, messages, location and latest photos', 'read permission privacy sms contacts calls location photos'),
  e('access', 'Let the agent read phone data', 'Access & privacy → Phone data for the agent', undefined, 'contacts calendar call log messages sms location photos privacy master'),
  e('access', 'Allow banking, payment, password and 2FA apps', 'Access & privacy → Background apps', "Off: Hermux won't open them in the background", 'hidden screen phone control sensitive'),
  e('access', 'Keep a diagnostic log', 'Access & privacy → Kept on this phone', undefined, 'debug logs'),
  e('access', 'Share anonymous usage stats', 'Access & privacy → Kept on this phone', undefined, 'analytics telemetry privacy'),
  // About & help
  e('about', 'Check for updates', 'About & help → Updates', undefined, 'update app version install download'),
  e('about', 'Report a problem', 'About & help → Help', 'Becomes a public issue on GitHub', 'bug issue feedback'),
  e('about', 'Setup check', 'About & help → Help', 'Permissions, background running, the plugin', 'battery notifications diagnose'),
  e('about', 'Status', 'About & help → Help', undefined, 'connected offline connection'),
  e('about', 'Reconnect / start Hermux', 'About & help → Help', undefined, 'restart connection'),
  e('about', 'Hermux agent', 'About & help → Versions', undefined, 'hermes version'),
  e('about', 'Hermux plugin', 'About & help → Versions', undefined, 'plugin update sync'),
  e('about', 'Remote debugging', 'About & help → Developer', undefined, 'developer adb'),
  e('about', 'Uninstall Hermux', 'About & help → Danger zone', 'Hermux, Debian, chats, Termux and the helper apps', 'remove delete backup'),
  // Appearance
  e('appearance', 'Theme', 'Appearance', 'Default, OLED black, Light or System', 'dark light oled black system colors'),
  e('appearance', 'Text size', 'Appearance', undefined, 'font bigger larger smaller zoom'),
  e('appearance', 'Glass effects', 'Appearance → Effects', 'Bars and sheets let the chat show through', 'blur translucent transparent glass solid look battery'),
  e('appearance', 'Animations', 'Appearance → Effects', 'Full, Reduced or Off', 'motion animation reduce remove movement springs battery'),
  e('appearance', 'Model bar', 'Appearance → Chat screen', 'Tucked away or Always open', 'model chip auto context ring status tray handle tucked hide show always open'),
  // Voice
  e('voice', 'Read every reply aloud', 'Voice → Read aloud', 'In all chats', 'tts speak speech auto read'),
  e('voice', 'Speech engine', 'Voice', undefined, 'tts text to speech'),
  e('voice', 'Speed', 'Voice → Sound', undefined, 'rate faster slower'),
  e('voice', 'Pitch', 'Voice → Sound', undefined, 'tone'),
  e('voice', 'Speech recognition', 'Voice → Dictation', 'Speech-to-text for the microphone button and Live mode', 'stt dictation microphone whisper model offline'),
  e('voice', 'Live mode', 'Voice', undefined, 'conversation hands free'),
  e('voice', 'Pause before sending', 'Voice → Live mode', undefined, 'silence wait'),
  e('voice', 'Interrupt by talking', 'Voice → Live mode', 'Talk over Hermux to cut it off', 'barge in'),
  e('voice', 'Test voice', 'Voice', 'Plays a sample sentence with these settings'),
  e('voice', 'Reset voice settings', 'Voice'),
  e('stt', "Phone’s speech recognition", 'Speech recognition', 'Android’s recogniser (usually Google’s)', 'stt google'),
  e('stt', 'Add from Hugging Face', 'Speech recognition', 'Paste the model’s link', 'model download onnx'),
  e('stt', 'Add files from this phone', 'Speech recognition', 'The model’s .onnx files and tokens.txt, or a .zip', 'model import'),
  // Default models, model providers, keys
  e('defaults', 'Set one model for all bots', 'Models → Default models'),
  e('accounts', 'Fallback models', 'Models → Model providers', 'Tried when a model fails', 'rotation backup failover'),
  e('keys', 'Only keys that are set', 'Models → All keys', 'Turn off to see every key Hermux supports'),
  e('keys', 'Add a custom key', 'Models → All keys', undefined, 'env variable secret'),
  // Connectors
  e('connectors', 'Apps and services (MCP)', 'Connectors', 'Notion, Linear, GitHub, your own server…', 'mcp server notion github linear'),
  e('connectors', 'Add from the catalog', 'Connectors', 'Services Hermux knows how to connect', 'mcp'),
  e('connectors', 'Add a server', 'Connectors', 'By its address, or a command that starts it', 'mcp url'),
  e('connectors', 'Tools with a key or an account', 'Connectors', undefined, 'web search home assistant toolsets'),
  e('connectors', 'Keys for skills', 'Connectors', 'Hermux’s skills read the key from the bot’s .env', 'skills api key')
]

const HERMUX: SettingsEntry[] = HERMES_SETTINGS.flatMap(g => g.items.map(s => ({ page: 'hermes' as const, find: s.label, title: s.label, sub: s.help, where: `Behaviour → ${g.title}`, words: s.key.replace(/[._]/g, ' ') })))

/** Dotted config paths the running Hermes has (set by the Behaviour page once loaded); null: not known yet. */
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
