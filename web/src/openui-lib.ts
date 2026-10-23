// The components Hermes may use in ```openui-lang blocks, and the reference text that teaches them.
// Imported ONLY by openui-entry.tsx (the lazy bundle) and openui-lib.test.ts. Importing it anywhere else would pull
// OpenUI's ~4 MB into the main bundle that runs at every start.
import { openuiChatLibrary, openuiChatPromptOptions } from '@openuidev/react-ui/genui-lib'

/** OpenUI's chat component library, unchanged (owner's pick, 2026-10-23). Root component: Card. */
export const library = openuiChatLibrary

export const PREAMBLE = [
  'You are answering in the Hermes Mobile phone app. Besides normal Markdown, your reply may contain interactive UI',
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
  'The examples show what goes INSIDE a ```openui-lang fence; in your reply always wrap the code in that fence.'
]

/** OpenUI's chat rules minus "generate realistic/plausible data", plus ours. */
export const RULES: string[] = [...(openuiChatPromptOptions.additionalRules ?? []).filter(r => !/plausible data/i.test(r)), ...OURS]

/** The two shortest of OpenUI's chat examples: enough to show the shape without ~20K chars of samples. */
export const EXAMPLES: string[] = [...(openuiChatPromptOptions.examples ?? [])].sort((a, b) => a.length - b.length).slice(0, 2)

/** What the plugin's openui_reference tool returns (hermes-plugin/hermes-mobile/openui_reference.txt). */
export function referenceText(): string {
  // bindings: $variables, @Set/@Reset and the built-in functions (@Count, @Filter, @Sort…) run in the app, no backend.
  return library.prompt({ preamble: PREAMBLE, additionalRules: RULES, examples: EXAMPLES, bindings: true })
}
