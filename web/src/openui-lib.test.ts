process.env.OPENUI_TELEMETRY_DISABLED = '1' // lang-core's prompt telemetry runs in node; the app (a browser) sends none
process.env.DO_NOT_TRACK = '1'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { library, referenceText, RULES, skillText } from './openui-lib'

// The plugin's Hermes skill (skill_view("hermes-mobile:openui")). It is generated from the library the app draws, so
// the model is never taught a component the app can't render. Refresh it with `npm run gen:openui`.
const FILE = new URL('../../hermes-plugin/hermes-mobile/skills/openui/SKILL.md', import.meta.url)

describe('openui reference', () => {
  test('the plugin ships the reference for the library the app draws, as a Hermes skill', () => {
    const text = skillText()
    if (process.env.UPDATE_OPENUI) writeFileSync(FILE, text)
    expect(readFileSync(FILE, 'utf8'), 'stale: run `npm run gen:openui` in web/').toBe(text)
  })
  test('the skill has the frontmatter Hermes reads', () => {
    const fm = skillText().split('\n---\n')[0]
    expect(fm.startsWith('---\nname: openui\n')).toBe(true)
    const desc = /\ndescription: (.*)\n/.exec(fm)?.[1] ?? ''
    expect(desc.length).toBeGreaterThan(40)
    expect(desc.length).toBeLessThanOrEqual(1024) // Hermes cuts longer descriptions
    expect(desc).not.toMatch(/: /) // a second ": " would break the YAML scalar
  })
  test('never tells the model to make data up', () => {
    expect(RULES.some(r => /plausible data/i.test(r))).toBe(false)
    expect(referenceText()).not.toMatch(/plausible data/i)
  })
  test('teaches the fence, mixed Markdown, and fits the budget', () => {
    const t = referenceText()
    expect(t).toContain('```openui-lang')
    expect(t).not.toContain('Your ENTIRE response must be valid openui-lang')
    expect(t.length).toBeLessThan(52_000)
  })
  test('root is Card (the chat library)', () => {
    expect(library.root).toBe('Card')
  })
  test('teaches live data from the read-only tools, and no writes', () => {
    const t = referenceText()
    expect(t).toContain('Query(')
    for (const name of ['web_search', 'find_chats', 'read_file', 'search_files']) expect(t).toContain(name)
    expect(RULES.some(r => /Never use Mutation/.test(r))).toBe(true)
    expect(RULES.some(r => /refresh interval/.test(r))).toBe(true)
  })
})
