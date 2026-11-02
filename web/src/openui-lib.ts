// The components Hermes may use in ```openui-lang blocks, and the reference text that teaches them.
// Imported ONLY by openui-entry.tsx (the lazy bundle) and openui-lib.test.ts. Importing it anywhere else would pull
// OpenUI's ~4 MB into the main bundle that runs at every start.
import { openuiChatLibrary, openuiChatPromptOptions } from '@openuidev/react-ui/genui-lib'
import type { ToolSpec } from '@openuidev/react-lang'
// The read-only tools a card's Query() may call; the plugin enforces the same list (openui_query.py).
import TOOLS from '../../hermes-plugin/hermes-mobile/openui_tools.json'

/** OpenUI's chat component library, unchanged (owner's pick, 2026-10-23). Root component: Card. */
export const library = openuiChatLibrary

export const PREAMBLE = [
  'You are answering in the Hermux phone app. Besides normal Markdown, your reply may contain interactive UI',
  'written in openui-lang, a compact UI language the app draws with real components (cards, tables, charts, forms,',
  'buttons). Put each UI in its own fenced block: a line with ```openui-lang, the openui-lang statements, then a line',
  'with ```. Text outside the fences shows as normal chat. Use UI when it helps more than prose: comparisons, numbers',
  'and trends, choices to tap, steps, and forms that collect several answers at once. Keep short answers and',
  'explanations as plain Markdown. Documents, reports, code files and things the user asks you to build go on the',
  'canvas, not in openui-lang.'
].join(' ')

const OURS = [
  'Use only data you really have: from this chat, from your tools, or facts you know (say when a number is an estimate). Never invent numbers, names, prices, quotes or results to fill a component.',
  'Every ```openui-lang block is a complete program that starts with root = Card(...). A later block never edits an earlier one: to change a card, write the whole new block.',
  'Buttons, list items and follow-ups use @ToAssistant("...") with the exact words the user would send. The app sends that text as the user\'s next message, with any form values listed under it as "- name: value" lines.',
  '@OpenUrl only takes full https:// links.',
  'The screen is a phone, about 380 px wide: at most 4 table columns, short labels, and Tabs, Carousel or SectionBlock instead of very long cards.',
  'The examples show what goes INSIDE a ```openui-lang fence; in your reply always wrap the code in that fence.',
  'Never give Query a refresh interval (its 4th argument). Add a Refresh button with @Run(query) instead.',
  'Cards can only read. For any change, use a Button with @ToAssistant("...") so you do it in the chat with the user\'s approval. Never use Mutation.'
]

/** OpenUI's chat rules minus "generate realistic/plausible data", plus ours. */
export const RULES: string[] = [...(openuiChatPromptOptions.additionalRules ?? []).filter(r => !/plausible data/i.test(r)), ...OURS]

/** The two shortest of OpenUI's chat examples: enough to show the shape without ~20K chars of samples. */
export const EXAMPLES: string[] = [...(openuiChatPromptOptions.examples ?? [])].sort((a, b) => a.length - b.length).slice(0, 2)

/** The language and component reference: the body of the plugin's Hermes skill (skills/openui/SKILL.md). */
export function referenceText(): string {
  // tools: Query() live data through the plugin (read-only). bindings: $variables, @Set/@Reset and the built-in
  // functions (@Count, @Filter, @Sort…) run in the app.
  return library.prompt({ preamble: PREAMBLE, additionalRules: RULES, examples: EXAMPLES, tools: TOOLS as ToolSpec[], bindings: true })
}

/** Frontmatter of hermes-plugin/hermes-mobile/skills/openui/SKILL.md. The plugin registers the skill with Hermes
 *  (`ctx.register_skill`), so Hermes serves it as `skill_view("hermes-mobile:openui")`. */
export const SKILL_FRONTMATTER = [
  '---',
  'name: openui',
  'description: Draw interactive cards, tables, charts, tappable choices, steps and forms in a Hermux app reply with fenced openui-lang blocks. Load it before your first openui-lang block in a chat. Only the phone app draws these blocks.',
  'version: 1.0.0',
  'metadata:',
  '  hermes:',
  '    tags: [hermes-mobile, openui, ui, cards]',
  '---'
].join('\n')

/** The whole SKILL.md (`npm run gen:openui` writes it). */
export function skillText(): string {
  return SKILL_FRONTMATTER + '\n\n' + referenceText() + '\n'
}
