import { describe, expect, test } from 'vitest'
import { commandText, compactCount, programName, runSummary, thoughtLine, todoSteps, toolTitle } from './toolsay'

describe('tool calls in plain words', () => {
  test('commands lose their shell wrapper', () => {
    expect(commandText("bash -lc 'git status --short'")).toBe('git status --short')
    expect(commandText('sudo -E FOO=1 npm test')).toBe('npm test')
    expect(programName('sudo -u root systemctl restart x')).toBe('systemctl')
    expect(runSummary([{ name: 'constructor' }])).toBe('used 1 tool')
    expect(programName('cd ~/site && npm run build')).toBe('npm')
    expect(programName('/usr/bin/git log')).toBe('git')
  })

  test('titles follow the state', () => {
    expect(toolTitle({ name: 'terminal', status: 'running', args: { command: 'git pull' } })).toBe('Running git')
    expect(toolTitle({ name: 'terminal', status: 'done', args: { command: 'git pull' } })).toBe('Ran git')
    expect(toolTitle({ name: 'terminal', status: 'error', args: {} })).toBe('Failed a command')
    expect(toolTitle({ name: 'patch', status: 'done' })).toBe('Edited')
    expect(toolTitle({ name: 'skill_view', status: 'done' })).toBe('skill_view')
  })

  test('runs are summed up by kind, edits by file', () => {
    const t = (name: string, path?: string) => ({ name, args: path ? { path } : {} })
    expect(runSummary([t('terminal'), t('read_file'), t('terminal')])).toBe('ran 2 commands and read 1 file')
    expect(runSummary([t('patch', 'a'), t('patch', 'a'), t('write_file', 'b')])).toBe('changed 2 files')
    expect(runSummary([t('terminal'), t('patch', 'a'), t('read_file'), t('search_files'), t('memory')])).toBe('ran 1 command, changed 1 file and used 3 other tools')
    expect(runSummary([t('search_files'), t('search_files'), t('memory')])).toBe('searched 2 times and used 1 tool')
  })

  test('a thought in one line', () => {
    expect(thoughtLine('**Checking the file**\nLet me look. **Writing it**')).toBe('Checking the file')
    expect(thoughtLine('**Checking the file**\nLet me look. **Writing it**', true)).toBe('Writing it')
    expect(thoughtLine('First I read it. Then I write.')).toBe('First I read it.')
    expect(thoughtLine('First I read it. Then I wr', true)).toBe('Then I wr')
  })

  test('task lists from the result, else the arguments', () => {
    const todos = [{ content: 'Read', status: 'completed' }, { content: 'Write', status: 'in_progress' }]
    expect(todoSteps({ name: 'todo_list', resultText: JSON.stringify({ todos }) })).toEqual(todos)
    expect(todoSteps({ name: 'todo', args: { todos }, resultText: 'oops' })).toEqual(todos)
    expect(todoSteps({ name: 'terminal', args: { todos } })).toBeNull()
  })

  test('short counts', () => {
    expect(compactCount(950)).toBe('950')
    expect(compactCount(1234)).toBe('1.2k')
    expect(compactCount(25400)).toBe('25k')
  })
})
