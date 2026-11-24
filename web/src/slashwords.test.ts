import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import table from '../vendor/hermes-commands.json'
import { hermesCommand, hermesShlex, hermesSlash, kanbanReadOnly, lockSafeCommand, loosensApprovals } from './slashwords'

const ch = (...codes: number[]) => String.fromCharCode(...codes)
const hermesWords = (t: string) => {
  const { name, arg } = hermesSlash(t)
  return { name, arg }
}

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

// Where JavaScript's trim and Python's strip disagree: U+FEFF is a space to JavaScript only; U+001C to U+001F and U+0085 to
// Python only. The page sends hermesSlash's body, so what Hermes reads from it must be what the page judged.
describe('the text sent is the text judged', () => {
  const differ = [0xfeff, 0x1c, 0x1d, 0x1e, 0x1f, 0x85]
  it('reads the same name and arguments from the sent body as from the text', () => {
    for (const c of differ) {
      const x = ch(c)
      for (const t of [`/${x}approvals off`, `${x}/approvals off`, `/approvals${x}off`, `/approvals off${x}`, `/${x}ap smart`, `//${x}${x}approvals  off ${x}`]) {
        const p = hermesSlash(t)
        expect(hermesSlash(p.body), JSON.stringify(t)).toEqual(p)
        expect(p.body.startsWith('/'), JSON.stringify(t)).toBe(false)
      }
    }
  })
  it('keeps U+FEFF, as Python does, instead of dropping it as trim does', () => {
    expect(hermesSlash(`/${ch(0xfeff)}approvals off`).body).toBe(`${ch(0xfeff)}approvals off`)
    expect(hermesSlash(`/approvals off${ch(0x85)}`).body).toBe('approvals off')
    expect(hermesSlash(`/approvals${ch(0x85)}off`).body).toBe('approvals off')
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

// A port of the pinned Hermes's own steps, kept apart from slashwords.ts on purpose: Python's whitespace (every character
// whose str.isspace() is true, listed from Python itself), the gateway's slash.exec (tui_gateway/methods_tools.py:
// `cmd.strip()`, `cmd.lstrip("/").split(maxsplit=1)`, `parts[0].lower()`) and the slash worker's process_command (cli.py:
// `command.lower().strip().split()[0].lstrip("/")`).
const PY_SPACE = new Set([0x9, 0xa, 0xb, 0xc, 0xd, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000])
const pyIsSpace = (c: string) => PY_SPACE.has(c.charCodeAt(0))
const pyStrip = (s: string) => {
  let a = 0
  let b = s.length
  while (a < b && pyIsSpace(s[a])) a++
  while (b > a && pyIsSpace(s[b - 1])) b--
  return s.slice(a, b)
}
const pyLstrip = (s: string, chars: string) => {
  let a = 0
  while (a < s.length && chars.includes(s[a])) a++
  return s.slice(a)
}
/** str.split(maxsplit=n) with no separator: runs of whitespace split, none at the ends; the last part keeps its inside. */
const pySplit = (s: string, maxsplit = -1): string[] => {
  const out: string[] = []
  let i = 0
  for (;;) {
    while (i < s.length && pyIsSpace(s[i])) i++
    if (i >= s.length) return out
    if (maxsplit >= 0 && out.length === maxsplit) {
      let j = s.length
      while (j > i && pyIsSpace(s[j - 1])) j--
      out.push(s.slice(i, j))
      return out
    }
    let j = i
    while (j < s.length && !pyIsSpace(s[j])) j++
    out.push(s.slice(i, j))
    i = j
  }
}
/** slash.exec: the base it routes on and the arg it passes (to command.dispatch, a plugin, a skill). */
const gatewayReads = (command: string) => {
  const cmd = pyStrip(command)
  const parts = pySplit(pyLstrip(cmd, '/'), 1)
  return { base: (parts[0] ?? '').toLowerCase(), arg: parts[1] ?? '' }
}
/** The slash worker (`worker.run(cmd)`): the word it resolves. */
const workerReads = (command: string) => {
  const words = pySplit(pyStrip(command.toLowerCase()))
  return words.length ? pyLstrip(words[0], '/') : null
}

describe('what the page judges is what Hermes reads (generated text)', () => {
  const pieces = ['/', '//', ...[...PY_SPACE].map(c => ch(c)), ch(0xfeff), ch(0x200b), 'a', 'p', 'x', 'approvals', 'off', 'smart', 'ap', 'approvals off', 'ap smart', 'APPR off', 'help']
  // A small fixed generator (the same strings on every run), so a failure can be repeated.
  let seed = 20261121
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const texts: string[] = []
  for (let i = 0; i < 30000; i++) {
    let t = ''
    for (let k = rand(9); k >= 0; k--) t += pieces[rand(pieces.length)]
    texts.push(t)
  }
  texts.push('/ /approvals off', '// /ap smart', '/\t/approvals off', `/${ch(0x85)}/approvals off`, '  //  /approvals off', '/', '', ' / ')

  it('both of Hermes\'s readings of the sent body give back exactly the judged name and arguments', () => {
    for (const t of texts) {
      const p = hermesSlash(t)
      const at = JSON.stringify(t)
      expect(gatewayReads(p.body), at).toEqual({ base: p.name.toLowerCase(), arg: p.arg })
      if (p.name) expect(workerReads(p.body), at).toBe(p.name.toLowerCase())
      expect(hermesSlash(p.body), at).toEqual(p) // an alias step reads it again the same way
    }
  })
  it('agrees with slash.exec on the typed text whenever Hermes names a command there', () => {
    for (const t of texts) {
      const g = gatewayReads(t)
      if (!g.base || g.base.startsWith('/')) continue // Hermes's two readings disagree here; the page sends its own
      const p = hermesSlash(t)
      expect({ base: p.name.toLowerCase(), arg: p.arg }, JSON.stringify(t)).toEqual(g)
    }
  })
  it('asks for /approvals off or smart whenever either reading of the typed text would loosen approvals', () => {
    let seen = 0
    for (const t of texts) {
      const g = gatewayReads(t)
      const w = workerReads(t)
      const wArg = pySplit(pyStrip(t), 1)[1] ?? ''
      if (!loosensApprovals(g.base, g.arg) && !(w && loosensApprovals(w, wArg))) continue
      seen++
      const p = hermesSlash(t)
      expect(loosensApprovals(p.name, p.arg), JSON.stringify(t)).not.toBeNull()
    }
    expect(seen).toBeGreaterThan(100)
  })
  it('alias targets of every shape are read like typed text', () => {
    for (const target of ['  //  /approvals off', '/ /ap smart', `${ch(9)}/approvals${ch(0x85)}off`, '//approvals off', 'approvals off', `/${ch(0x1c)}/APPROVALS SMART`]) {
      const p = hermesSlash(target)
      expect(loosensApprovals(p.name, p.arg), JSON.stringify(target)).not.toBeNull()
      expect(gatewayReads(p.body), JSON.stringify(target)).toEqual({ base: p.name.toLowerCase(), arg: p.arg })
    }
  })
})
