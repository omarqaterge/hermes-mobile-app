import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import table from '../vendor/hermes-commands.json'
import { detachedRefusal, detachedWork, hermesBody, hermesCommand, hermesShlex, hermesWords, kanbanReadOnly, lockSafeCommand, loosensApprovals } from './slashwords'

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

describe('commands that start work apart from the chat', () => {
  it('finds a background task, however it is spelled', () => {
    for (const n of ['bg', 'BG', 'background']) expect(detachedWork(n, 'x')).toBe('a background task')
    for (const n of ['b', 'ba', 'bac', 'backg', 'bgx', 'box', 'btw', 'help']) expect(detachedWork(n, 'x')).toBeNull() // none of these starts one
  })
  it('finds what schedules a prompt, and leaves the rest of /cron alone', () => {
    for (const a of ['add "every 1h" hi', 'ADD x', '"add" x', 'cre"ate" x', 'edit id --prompt y']) expect(detachedWork('cron', a)).toBe('a scheduled job')
    expect(detachedWork('cr', 'add x')).toBe('a scheduled job')
    for (const a of ['', 'list', 'run id', 'pause id', 'remove id', 'resume id']) expect(detachedWork('cron', a)).toBeNull()
    expect(detachedWork('c', 'add x')).toBeNull()
  })
  it('finds every /kanban command that changes a board or starts work, and automations with values', () => {
    for (const a of ['create "do it"', '--board main dispatch', 'swarm x', '-- create x', '--board b -- dispatch', 'specify t1', 'decompose --all', 'comment t1 hi', 'boards create x', 'archive t1'])
      expect(detachedWork('kanban', a)).toBe('a board command')
    expect(detachedWork('k', 'daemon')).toBe('a board command')
    for (const n of ['kanban', 'KANBAN', 'k', 'kan', 'kanba']) expect(detachedWork(n, 'swarm --worker a "goal"'), n).toBe('a board command')
    for (const a of ['', 'list', 'show t1', '--board b list']) expect(detachedWork('kanban', a)).toBeNull()
    expect(detachedWork('blueprint', 'daily topic=x')).toBe('an automation')
    expect(detachedWork('bp', 'daily topic=x')).toBe('an automation')
    expect(detachedWork('BP', 'daily topic=x')).toBe('an automation')
    expect(detachedWork('bl', 'daily topic=x')).toBe('an automation')
    for (const a of ['', 'daily']) for (const n of ['blueprint', 'bp']) expect(detachedWork(n, a)).toBeNull()
  })
  it('finds an accepted suggestion, which schedules a job, by the alias too', () => {
    for (const n of ['suggestions', 'suggest', 'SUGGEST', 'sug'])
      for (const a of ['accept 1', 'ADD 2', 'schedule abc']) expect(detachedWork(n, a), `${n} ${a}`).toBe('a scheduled job')
    for (const a of ['', 'dismiss 1', 'catalog', 'clear']) expect(detachedWork('suggest', a), a).toBeNull()
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

describe('the refusal', () => {
  it('says the chat has read only when that is known', () => {
    expect(detachedRefusal('a background task', 'read')).toContain('has read data from your phone, so')
    const unsure = detachedRefusal('a background task', 'unknown')
    expect(unsure).toContain('couldn’t check whether')
    expect(unsure).not.toContain('This chat has read')
  })
})

// Where JavaScript's trim and Python's strip disagree: U+FEFF is a space to JavaScript only; U+001C to U+001F and U+0085 to
// Python only. The page sends hermesBody, so what Hermes reads from it must be what hermesWords judged.
describe('the text sent is the text judged', () => {
  const differ = [0xfeff, 0x1c, 0x1d, 0x1e, 0x1f, 0x85]
  it('Hermes reads from the sent body the same name and arguments the page judged', () => {
    for (const c of differ) {
      const x = ch(c)
      for (const t of [`/${x}approvals off`, `${x}/approvals off`, `/approvals${x}off`, `/approvals off${x}`, `/${x}ap smart`, `//${x}${x}approvals  off ${x}`]) {
        expect(hermesWords(hermesBody(t)), JSON.stringify(t)).toEqual(hermesWords(t))
        expect(hermesBody(t).startsWith('/'), JSON.stringify(t)).toBe(false)
      }
    }
  })
  it('keeps U+FEFF, as Python does, instead of dropping it as trim does', () => {
    expect(hermesBody(`/${ch(0xfeff)}approvals off`)).toBe(`${ch(0xfeff)}approvals off`)
    expect(hermesBody(`/approvals off${ch(0x85)}`)).toBe('approvals off')
  })
  it('/approvals off and smart with an invisible character in them still ask', () => {
    for (const x of [ch(0xfeff), ch(0x200b), ch(0x2060)]) {
      expect(loosensApprovals(hermesWords(`/${x}approvals off`).name, 'off')).toBe('off')
      expect(loosensApprovals(hermesWords(`/${x}ap smart`).name, 'smart')).toBe('smart')
      expect(loosensApprovals('approvals', `${x}off`)).toBe('off')
      expect(loosensApprovals(`appr${x}ovals`, `of${x}f`)).toBe('off')
    }
    for (const c of differ.filter(c => c !== 0xfeff)) {
      const { name, arg } = hermesWords(`/approvals${ch(c)}off`)
      expect(loosensApprovals(name, arg)).toBe('off')
    }
  })
})
