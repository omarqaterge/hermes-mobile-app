import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import table from '../vendor/hermes-commands.json'
import { hermesCommand, hermesShlex, hermesWords, kanbanReadOnly, lockSafeCommand, loosensApprovals } from './slashwords'

const ch = (...codes: number[]) => String.fromCharCode(...codes)

describe('reading a command as Hermes does', () => {
  it('splits on every separator of Python', () => {
    for (const c of [9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]) {
      expect(hermesWords(`/bg${ch(c)}do it`)).toEqual({ name: 'bg', arg: 'do it' })
      expect(hermesWords(`/${ch(c)}bg do it`).name).toBe('bg')
      expect(hermesWords(`${ch(c)}/bg${ch(c)}`).name).toBe('bg')
    }
  })
  it('does not split on what Python keeps in a word', () => {
    expect(hermesWords(`/bg${ch(0xfeff)}x y`).name).toBe(`bg${ch(0xfeff)}x`)
    expect(hermesWords(`/bg${ch(0x200b)}x`).name).toBe(`bg${ch(0x200b)}x`)
  })
  it('takes any number of leading slashes, and copes with nothing', () => {
    expect(hermesWords('///BG  a  b ')).toEqual({ name: 'BG', arg: 'a  b' })
    expect(hermesWords('/')).toEqual({ name: '', arg: '' })
  })
})

describe("Hermes's command table", () => {
  it('is the one of the pinned build (tools/hermes-commands.py writes it from that build)', () => {
    expect(table.commit).toBe(readFileSync(new URL('../vendor/hermes-shared/.hermes-commit', import.meta.url), 'utf8').trim())
    expect(table.names).toContain('blueprint')
    expect(table.aliases.bp).toBe('blueprint')
  })
  it('turns every alias into its command, in any case', () => {
    for (const [alias, cmd] of Object.entries(table.aliases)) {
      expect(hermesCommand(alias), alias).toBe(cmd)
      expect(hermesCommand(alias.toUpperCase()), alias).toBe(cmd)
    }
  })
  it('expands a beginning as the slash worker does: the only match, or the only shortest one', () => {
    for (const [typed, cmd] of [['cr', 'cron'], ['k', 'kanban'], ['kanb', 'kanban'], ['bl', 'blueprint'], ['blue', 'blueprint'], ['ap', 'approvals'],
      ['sug', 'suggestions'], ['ba', 'battery'], ['upgrad', 'subscription'], ['stat', 'status'],
      ['c', 'context'], ['a', 'agents']] as const) // `/c` is the only shortest beginning of the alias /ctx; `/a` of /agents
      expect(hermesCommand(typed), typed).toBe(cmd)
    for (const typed of ['', 'b', 'bac', 'background', 'approve', 'approvalsx', 'zz']) expect(hermesCommand(typed), typed).toBe('')
  })
})

// The answers of the pinned Hermes: Python's shlex.split and its kanban parser, run on the same text.
describe('/kanban arguments as Hermes reads them', () => {
  it('splits like shlex.split, then drops a wrapping pair of quotes', () => {
    const cases: Array<[string, string[] | null]> = [
      ['', []], ['ls --mine', ['ls', '--mine']], ['create "do it"', ['create', 'do it']], ["'list'", ['list']], ['"list" x', ['list', 'x']],
      ['li"st"', ['list']], ["list 'unterminated", null], ['list \\', null], ['a\\ b', ['a b']], ['"a\\"b"', ['a"b']], ["'a\\b'", ['a\\b']],
      ['x\u3000y', ['x\u3000y']], [`"'list'"`, ['list']]
    ]
    for (const [text, want] of cases) expect(hermesShlex(text), text).toEqual(want)
  })
  it('only reads for its help and the subcommands that show something', () => {
    const read = ['', 'help', '?', '-h', '--he', 'list', 'ls --mine', 'show t1 --json', '--board b list', '--board=b ls', '--boa b ls', '--b b show x',
      '-- list', '--board b -- show t1', `"'list'"`, 'stats', 'log t1', 'runs t1', 'context t1', 'assignees', 'notify-list', 'diag', 'boards', 'boards list', 'boards current', "'list'", 'li"st"']
    for (const a of read) expect(kanbanReadOnly(a), a).toBe(true)
    const change = ['-- create x', '--board b -- dispatch', 'swarm x', 'specify x', 'decompose --all', 'comment t1 hi', 'create "do it"',
      'boards create x', 'create -h', 'watch', 'tail t1', 'dispatch --dry-run', '--board', '--board -x list', '--other list', 'LIST',
      "list 'unterminated", 'list \\', 'archive t1', 'gc', 'repair']
    for (const a of change) expect(kanbanReadOnly(a), a).toBe(false)
  })
})

describe('over the lock screen', () => {
  it('runs only commands that show something, by their exact names', () => {
    for (const [n, a] of [['help', ''], ['help', 'kanban'], ['status', ''], ['STATUS', ''], ['version', ''], ['whoami', ''], ['agents', ''],
      ['usage', ''], ['context', ''], ['context', 'all'], ['kanban', 'list'], ['kanban', '']] as const)
      expect(lockSafeCommand(n, a), `${n} ${a}`).toBe(true)
    for (const [n, a] of [['approvals', 'off'], ['approvals', ''], ['cron', 'run x'], ['cron', 'remove x'], ['cron', 'list'], ['rollback', '1'],
      ['usage', 'reset'], ['status', 'x'], ['stat', ''], ['he', ''], ['k', 'list'], ['kanban', 'create x'], ['kanban', '-- create x'],
      ['yolo', ''], ['btw', 'hi'], ['bg', 'x'], ['myquick', ''], ['model', ''], ['new', ''], ['context', 'x'], ['kanban', 'swarm x'],
      ['v', ''], ['tasks', ''], ['ctx', 'all']] as const) // an alias waits too
      expect(lockSafeCommand(n, a), `${n} ${a}`).toBe(false)
  })
})

describe('/approvals that let commands run without asking', () => {
  it('finds off and smart, by every beginning Hermes expands to /approvals', () => {
    for (const n of ['approvals', 'APPROVALS', 'ap', 'app', 'appr', 'approv', 'approva', 'approval'])
      for (const a of ['off', 'OFF', 'smart', 'Smart']) expect(loosensApprovals(n, a), `${n} ${a}`).toBe(a.toLowerCase())
    for (const [n, a] of [['approvals', 'manual'], ['approvals', ''], ['approvals', 'off now'], ['a', 'off'], ['approve', 'off'], ['approvalsx', 'off'], ['yolo', 'off']] as const)
      expect(loosensApprovals(n, a), `${n} ${a}`).toBeNull()
  })
})
