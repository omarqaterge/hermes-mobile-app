// The Hermes settings page's catalog: the config.yaml options that mean something on a phone, grouped, each with a
// plain-language line, the right control and its limits. Values are read and written through the dashboard
// (GET/PUT /api/config, defaults from GET /api/config/defaults); an option the running Hermes doesn't have is hidden.
// Everything else stays reachable, by its config name, under Settings → Advanced settings.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

interface Base {
  /** Dotted config path, e.g. `agent.max_turns`. */
  key: string
  label: string
  /** One line: what it does, in words a user knows. */
  help: string
}
export type HSetting = Base &
  (
    | { kind: 'toggle' }
    | { kind: 'choice'; options: { value: Json; label: string }[] }
    | {
        kind: 'number'
        min: number
        max: number
        /** Whole numbers only (default true). */
        int?: boolean
        unit?: string
        /** Shown as a percentage, stored as a 0–1 ratio. */
        percent?: boolean
        /** null is allowed and means this (e.g. "No limit"). */
        nullLabel?: string
        /** 0 means this (e.g. "Off"). */
        zeroLabel?: string
      }
    | { kind: 'text'; placeholder?: string; /** Allowed values (a timezone list from the schema); empty is always allowed. */ fromSchema?: boolean }
    | { kind: 'list'; placeholder?: string }
  )

export interface HGroup {
  title: string
  footer?: string
  items: HSetting[]
}

const s = 'seconds'
const onOff = (off: string, auto: string, on: string) => [
  { value: false, label: off },
  { value: 'auto', label: auto },
  { value: true, label: on }
]

export const HERMES_SETTINGS: HGroup[] = [
  {
    title: 'When a model fails',
    footer: 'The fallback models themselves are under Settings → Model providers.',
    items: [
      { key: 'agent.api_max_retries', label: 'Retries before a fallback', help: 'How often Hermes retries a failing request before it switches to the next fallback model. 1 switches fastest.', kind: 'number', min: 1, max: 10 },
      { key: 'fallback.min_switch_reset_seconds', label: 'Wait out short rate limits', help: 'If the main model says it is free again within this time, Hermes waits instead of switching.', kind: 'number', min: 0, max: 3600, unit: s, zeroLabel: 'Always switch' },
      { key: 'agent.auto_recovery_cycles', label: 'Recovery rounds', help: 'After retries and fallbacks are used up in an outage, how many more rounds Hermes tries before it gives up.', kind: 'number', min: 0, max: 20 }
    ]
  },
  {
    title: 'Replies',
    items: [
      { key: 'agent.max_turns', label: 'Most steps per reply', help: 'The most model calls and tool uses for one message before Hermes stops.', kind: 'number', min: 1, max: 5000, nullLabel: 'No limit' },
      { key: 'agent.run_budget_seconds', label: 'Time budget per reply', help: 'Hermes wraps up a reply that has run this long, with a warning at 80 %.', kind: 'number', min: 30, max: 86400, unit: s, nullLabel: 'Off' },
      { key: 'agent.text_verbosity', label: 'Answer length (OpenAI)', help: 'How long final answers are on OpenAI’s newer models. Other models ignore it.', kind: 'choice', options: [{ value: '', label: 'Provider default' }, { value: 'low', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'Long' }] },
      { key: 'agent.image_input_mode', label: 'Pictures you send', help: 'Attach them to the model, or describe them in words first for models that can’t see.', kind: 'choice', options: [{ value: 'auto', label: 'Automatic' }, { value: 'native', label: 'Always attach' }, { value: 'text', label: 'Always describe' }] },
      { key: 'agent.verify_on_stop', label: 'Check work before finishing', help: 'Nudges Hermes to test its code changes before it says it is done.', kind: 'choice', options: onOff('Off', 'For coding', 'Always') },
      { key: 'prompt_caching.cache_ttl', label: 'Prompt cache (Claude)', help: 'How long Claude keeps the start of a chat cached. Longer saves money when you reply slowly.', kind: 'choice', options: [{ value: '5m', label: '5 minutes' }, { value: '1h', label: '1 hour' }, { value: 'auto', label: 'Automatic' }, { value: false, label: 'Off' }] },
      { key: 'goals.max_turns', label: 'Goal turns before pausing', help: 'A goal keeps working on its own for at most this many turns, then pauses.', kind: 'number', min: 1, max: 500 },
      { key: 'agent.clarify_timeout', label: 'Question wait', help: 'How long a question Hermes asks you stays open.', kind: 'number', min: 0, max: 86400, unit: s, zeroLabel: 'No limit' },
      { key: 'approvals.timeout', label: 'Approval wait', help: 'How long a command waiting for your approval stays open before it is refused.', kind: 'number', min: 30, max: 86400, unit: s }
    ]
  },
  {
    title: 'Memory',
    items: [
      { key: 'memory.memory_enabled', label: 'Memory', help: 'Hermes keeps notes across chats and reads them at the start of each one.', kind: 'toggle' },
      { key: 'memory.user_profile_enabled', label: 'Profile of you', help: 'A separate note about you: your preferences, habits and how you like answers.', kind: 'toggle' },
      { key: 'memory.write_approval', label: 'Ask before saving', help: 'Hermes asks you before it changes its memory.', kind: 'toggle' },
      { key: 'memory.memory_char_limit', label: 'Memory size', help: 'A longer memory costs more on every message.', kind: 'number', min: 500, max: 50000, unit: 'characters' },
      { key: 'memory.user_char_limit', label: 'Profile size', help: 'How long the note about you may get.', kind: 'number', min: 300, max: 50000, unit: 'characters' },
      { key: 'memory.nudge_interval', label: 'Memory review', help: 'Every this many turns Hermes looks back for things worth remembering.', kind: 'number', min: 0, max: 100, unit: 'turns', zeroLabel: 'Off' }
    ]
  },
  {
    title: 'Long chats',
    items: [
      { key: 'compression.enabled', label: 'Compress long chats', help: 'When a chat fills the model’s memory, older messages are summarised so the chat can go on.', kind: 'toggle' },
      { key: 'compression.threshold', label: 'Compress at', help: 'How full the model’s context gets before compressing (models under 512K start at 75 % at the earliest).', kind: 'number', min: 0.1, max: 0.95, int: false, percent: true },
      { key: 'compression.target_ratio', label: 'Summary size', help: 'How much of the context the compressed chat may take up.', kind: 'number', min: 0.1, max: 0.8, int: false, percent: true },
      { key: 'compression.protect_last_n', label: 'Recent messages kept', help: 'These last messages are never summarised.', kind: 'number', min: 1, max: 500 },
      { key: 'compression.idle_compact_after_seconds', label: 'Compress after a break', help: 'A chat you come back to after this long is compressed before the first reply.', kind: 'number', min: 0, max: 604800, unit: s, zeroLabel: 'Off' }
    ]
  },
  {
    title: 'Sub-agents',
    items: [
      { key: 'delegation.max_concurrent_children', label: 'At the same time', help: 'How many sub-agents may run at once.', kind: 'number', min: 1, max: 50 },
      { key: 'delegation.max_spawn_depth', label: 'Levels', help: '1: sub-agents can’t start their own. Every level multiplies the cost.', kind: 'number', min: 1, max: 5 },
      { key: 'delegation.max_iterations', label: 'Steps per sub-agent', help: 'The most model calls one sub-agent makes.', kind: 'number', min: 10, max: 5000 },
      { key: 'delegation.child_timeout_seconds', label: 'Stop a stuck sub-agent after', help: 'Time without any progress (at least 30 s), not total time.', kind: 'number', min: 0, max: 86400, unit: s, zeroLabel: 'Never' },
      {
        key: 'delegation.reasoning_effort',
        label: 'Sub-agent reasoning',
        help: 'How hard sub-agents think.',
        kind: 'choice',
        options: [{ value: '', label: 'Same as the chat' }, ...['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(v => ({ value: v, label: v }))]
      },
      { key: 'delegation.subagent_auto_approve', label: 'Sub-agents approve commands', help: 'Off: a sub-agent’s risky command is refused. On: it runs without asking you.', kind: 'toggle' }
    ]
  },
  {
    title: 'Web and tools',
    items: [
      { key: 'web.extract_char_limit', label: 'Page text limit', help: 'Longer web pages are cut to this before the model reads them.', kind: 'number', min: 1000, max: 1000000, unit: 'characters' },
      { key: 'web.cache_enabled', label: 'Remember web results', help: 'The same search or page within a short time is answered from the phone.', kind: 'toggle' },
      { key: 'web.cache_ttl_minutes', label: 'Remember them for', help: 'How long a web result is reused.', kind: 'number', min: 1, max: 1440, unit: 'minutes' },
      { key: 'web.keyless_fallback', label: 'Free web search', help: 'Without a search service set up, Hermes uses free ones, and retries a failed paid search on them once.', kind: 'toggle' },
      { key: 'terminal.timeout', label: 'Command time limit', help: 'A terminal command running longer than this is stopped.', kind: 'number', min: 10, max: 86400, unit: s },
      { key: 'tool_output.max_bytes', label: 'Tool output limit', help: 'Longer output of a tool is cut before the model sees it.', kind: 'number', min: 1000, max: 10000000, unit: 'characters' },
      { key: 'browser.inactivity_timeout', label: 'Close the browser after', help: 'Hermes’s web browser closes after this long unused.', kind: 'number', min: 10, max: 3600, unit: s },
      { key: 'checkpoints.enabled', label: 'File checkpoints', help: 'Snapshots files before Hermes changes them, so the change can be undone.', kind: 'toggle' },
      { key: 'checkpoints.max_snapshots', label: 'Checkpoints per folder', help: 'Older ones are dropped.', kind: 'number', min: 1, max: 500 },
      { key: 'checkpoints.retention_days', label: 'Keep checkpoints for', help: 'Checkpoints of folders untouched this long are deleted.', kind: 'number', min: 1, max: 3650, unit: 'days' },
      { key: 'tool_loop_guardrails.hard_stop_enabled', label: 'Stop tool loops', help: 'Stops a reply that keeps repeating failing tool calls (it is warned either way).', kind: 'toggle' },
      { key: 'network.force_ipv4', label: 'IPv4 only', help: 'Turn on when requests hang on a network with broken IPv6.', kind: 'toggle' }
    ]
  },
  {
    title: 'Safety and privacy',
    items: [
      { key: 'security.redact_secrets', label: 'Hide secrets', help: 'Keys and tokens in tool output are masked before the model sees them.', kind: 'toggle' },
      { key: 'privacy.redact_pii', label: 'Hide personal details', help: 'Phone numbers and user ids are removed from what the model sees.', kind: 'toggle' },
      { key: 'security.allow_private_urls', label: 'Local network addresses', help: 'Lets web tools open addresses such as 192.168.x.x and localhost.', kind: 'toggle' },
      { key: 'security.protected_instruction_files', label: 'Protect instruction files', help: 'Changes to AGENTS.md, SOUL.md and the like always need your approval, even with Full access.', kind: 'toggle' },
      { key: 'approvals.denial_breaker_threshold', label: 'Stop after refusals', help: 'After this many refused commands in a row Hermes stops and asks you.', kind: 'number', min: 0, max: 50, zeroLabel: 'Off' },
      { key: 'approvals.deny', label: 'Always blocked commands', help: 'Command patterns (like rm -rf *) that are refused even with Full access. One per line.', kind: 'list', placeholder: 'rm -rf /*' },
      { key: 'security.website_blocklist.enabled', label: 'Block websites', help: 'Web tools refuse the sites listed below.', kind: 'toggle' },
      { key: 'security.website_blocklist.domains', label: 'Blocked websites', help: 'One domain per line.', kind: 'list', placeholder: 'example.com' },
      { key: 'skills.write_approval', label: 'Ask before changing skills', help: 'Hermes asks you before it creates or edits a skill.', kind: 'toggle' }
    ]
  },
  {
    title: 'Chats and housekeeping',
    items: [
      { key: 'timezone', label: 'Time zone', help: 'For dates and scheduled jobs. Empty uses the phone’s.', kind: 'text', placeholder: 'Europe/Amsterdam', fromSchema: true },
      { key: 'sessions.auto_prune', label: 'Delete old chats', help: 'Chats untouched for longer than the time below are deleted for good.', kind: 'toggle' },
      { key: 'sessions.retention_days', label: 'Keep chats for', help: 'Used when Delete old chats is on.', kind: 'number', min: 7, max: 3650, unit: 'days' },
      { key: 'sessions.auto_archive', label: 'Archive idle chats', help: 'Idle chats are hidden (never deleted). Pinned ones stay.', kind: 'toggle' },
      { key: 'sessions.auto_archive_days', label: 'Archive after', help: 'Days without activity.', kind: 'number', min: 1, max: 365, unit: 'days' },
      { key: 'curator.enabled', label: 'Tidy up skills', help: 'Now and then Hermes marks unused skills stale and archives them (you can bring them back).', kind: 'toggle' },
      { key: 'curator.stale_after_days', label: 'Stale after', help: 'Days a skill is unused before it is marked stale.', kind: 'number', min: 1, max: 3650, unit: 'days' },
      { key: 'curator.archive_after_days', label: 'Archive after', help: 'Days unused before a skill is archived.', kind: 'number', min: 1, max: 3650, unit: 'days' },
      { key: 'cron.catch_up_missed', label: 'Run missed jobs', help: 'A scheduled job missed while Hermes was off runs once it is back.', kind: 'toggle' },
      { key: 'cron.allow_agent_scheduling', label: 'Jobs may schedule jobs', help: 'A scheduled job may create new scheduled jobs itself.', kind: 'toggle' },
      { key: 'cron.output_retention', label: 'Results kept per job', help: 'Older results of a scheduled job are deleted.', kind: 'number', min: 0, max: 10000, zeroLabel: 'Keep all' },
      { key: 'logging.level', label: 'Log detail', help: 'How much Hermes writes to its log. Debug helps when reporting a problem.', kind: 'choice', options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'].map(v => ({ value: v, label: v[0] + v.slice(1).toLowerCase() })) }
    ]
  }
]

/** True when the dotted path exists in `obj` (a null value counts). */
export function hasPath(obj: unknown, path: string): boolean {
  let o = obj
  for (const k of path.split('.')) {
    if (!o || typeof o !== 'object' || !(k in (o as Record<string, unknown>))) return false
    o = (o as Record<string, unknown>)[k]
  }
  return true
}

export function readPath(obj: unknown, path: string): Json | undefined {
  let o = obj
  for (const k of path.split('.')) {
    if (!o || typeof o !== 'object') return undefined
    o = (o as Record<string, unknown>)[k]
  }
  return o as Json | undefined
}

/** `{ a: { b: value } }` for `a.b`: what PUT /api/config merges. */
export function nested(path: string, value: Json): Record<string, Json> {
  return path
    .split('.')
    .reverse()
    .reduce<Json>((acc, k) => ({ [k]: acc }), value) as Record<string, Json>
}

export const sameValue = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The value as the row shows it. */
export function shown(s: HSetting, v: Json | undefined): string {
  if (s.kind === 'toggle') return v ? 'On' : 'Off'
  if (s.kind === 'choice') return s.options.find(o => sameValue(o.value, v))?.label ?? (v == null || v === '' ? '—' : String(v))
  if (s.kind === 'list') {
    const n = Array.isArray(v) ? v.length : 0
    return n ? `${n} item${n === 1 ? '' : 's'}` : 'None'
  }
  if (s.kind === 'text') return v == null || v === '' ? 'Not set' : String(v)
  if (v == null) return s.nullLabel ?? '—'
  if (typeof v !== 'number') return String(v)
  if (v === 0 && s.zeroLabel) return s.zeroLabel
  if (s.percent) return `${Math.round(v * 100)} %`
  return `${v.toLocaleString('en-US')}${s.unit ? ` ${unitShort(s.unit)}` : ''}`
}

const unitShort = (u: string) => (u === 'seconds' ? 's' : u === 'minutes' ? 'min' : u === 'characters' ? 'chars' : u)

/** What the user typed → the value to save, or an error to show. `allowed` is the schema's list for `fromSchema`. */
export function parseInput(s: HSetting, text: string, allowed?: string[]): { value: Json } | { error: string } {
  const t = text.trim()
  if (s.kind === 'list') return { value: text.split('\n').map(x => x.trim()).filter(Boolean) }
  if (s.kind === 'text') {
    if (t && s.fromSchema && allowed?.length && !allowed.includes(t)) return { error: `Not one Hermes knows. For example: ${allowed.slice(0, 3).join(', ')}` }
    return { value: t }
  }
  if (s.kind !== 'number') return { error: 'Not a typed value' }
  if (!t) return { error: 'Enter a number' }
  // "15,000" as the rows show it: a comma before three digits groups thousands; any other comma is a decimal point.
  const n = Number(t.replace(/,(?=\d{3}(?!\d))/g, '').replace(',', '.').replace(/\s*%$/, ''))
  if (!Number.isFinite(n)) return { error: 'Enter a number' }
  const v = s.percent ? n / 100 : n
  if (s.int !== false && !Number.isInteger(v)) return { error: 'Enter a whole number' }
  const lo = s.percent ? `${s.min * 100} %` : String(s.min)
  const hi = s.percent ? `${s.max * 100} %` : String(s.max)
  if (v < s.min || v > s.max) return { error: `Between ${lo} and ${hi}` }
  return { value: s.percent ? Math.round(v * 1000) / 1000 : v }
}

/** The value as the input box starts. */
export function inputText(s: HSetting, v: Json | undefined): string {
  if (s.kind === 'list') return Array.isArray(v) ? v.map(String).join('\n') : ''
  if (v == null) return ''
  if (s.kind === 'number' && s.percent && typeof v === 'number') return String(Math.round(v * 1000) / 10)
  return String(v)
}
