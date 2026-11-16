// What must not move while the interface is redesigned, against numbers and lists recorded on the day it started
// (docs/status/ui-revamp.md). A later change may improve them, never make them worse:
//   - the chat screen at 360 x 740, keyboard closed and open (the app shell shrinks the page by the keyboard's height,
//     modelled here as 300 px): the header and the composer area may not grow, the messages' visible height may not shrink;
//   - the localStorage keys the app writes in a normal session: none may disappear or change its shape (new ones may
//     appear beside them; the released app must keep reading what a newer build left behind);
//   - the accessible names of the chat screen's controls (idle, with text typed, while a reply runs): none may go away.
// HM_E2E_RECORD=1 prints today's values in the shape of the RECORDED_* constants, to update them on purpose.
const { WEB, nativeShell, check } = require('../lib.cjs')

// Recorded on 2026-11-17 from the redesign branch as it started (the same app as main that day).
const RECORDED_HEIGHTS = { closed: { header: 57, composer: 102, messages: 581 }, open: { header: 57, composer: 102, messages: 281 } }
const RECORDED_STORAGE = {
  'hm.autoread': 'number',
  'hm.autoread.chats': 'map<boolean>',
  'hm.boot.v1': '{at:number,marks:array<array<…>>}',
  'hm.cmds.v1.default': 'array',
  'hm.connectedOnce': 'number',
  'hm.ctx.v1': 'map<{max:number,percent:number,used:number}>',
  'hm.drafts.v1': 'map<string>',
  'hm.lastSession': '{id:string,profile:string}',
  'hm.lineage.v1': 'array<{r:array<…>,s:array<…>}>',
  'hm.recent.v1.default': 'array<string>',
  'hm.seen.v1.default': 'map<{c:number,n:number,t:number}>',
  'hm.sessions.v1.default': 'array<{id:string,message_count:number,preview:string,source:string,started_at:number,title:string}>',
  'hm.setupFlowDone': 'number',
  'hm.textScale': 'number',
  'hm.theme': 'text',
  'hm.visit.v1': 'map<number>',
  'hm.welcomeDone': 'number'
}
const RECORDED_NAMES = [
  'button "<title> Backend status Hermux agent"',
  'button "<access mode>. Change how much Hermux may do without asking"',
  'button "Add"',
  'button "Branch"',
  'button "Canvas"',
  'button "Chat options"',
  'button "Commands"',
  'button "Context #% used. Show details"',
  'button "Copy"',
  'button "Dictate"',
  'button "Edit"',
  'button "Live conversation"',
  'button "Model: <model>. Change model"',
  'button "Queue"',
  'button "Read aloud"',
  'button "Retry"',
  'button "Send"',
  'button "Sessions"',
  'button "Steer"',
  'button "Stop"',
  'textbox "Message Hermux"',
  'textbox "Queue or steer a follow-up…"'
]

const record = process.env.HM_E2E_RECORD === '1'

// The shape of a stored value: its JSON types, two levels deep. Objects whose keys are ids (chat ids, "#since") are maps.
function shape(v, depth = 0) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.length ? `array<${depth < 2 ? shape(v[0], depth + 1) : '…'}>` : 'array'
  if (typeof v !== 'object') return typeof v
  const keys = Object.keys(v).sort()
  if (keys.some(k => !/^[a-zA-Z_]+$/.test(k))) return keys.length ? `map<${depth < 2 ? shape(v[keys[0]], depth + 1) : '…'}>` : 'map'
  return depth < 2 ? `{${keys.map(k => `${k}:${shape(v[k], depth + 1)}`).join(',')}}` : '{…}'
}
const parse = raw => {
  try {
    return shape(JSON.parse(raw))
  } catch {
    return 'text'
  }
}
// An empty array or map fits any recorded element shape of the same kind.
const fits = (now, was) => now === was || (now === 'array' && /^array</.test(was)) || (now === 'map' && /^map</.test(was))

// The chat screen's controls from the accessibility tree: role and name, the chat list (complementary) left out,
// the chat's title replaced by <title>, numbers by # and the values inside two names (the model chip's model and
// reasoning level, the Auto button's mode) by a placeholder.
async function controlNames(p, title) {
  const snap = await p.locator('body').ariaSnapshot()
  const out = new Set()
  let skip = -1
  for (const line of snap.split('\n')) {
    const indent = line.search(/\S/)
    if (skip >= 0 && indent > skip) continue
    skip = -1
    if (/^\s*- complementary\b/.test(line)) {
      skip = indent
      continue
    }
    const m = /^\s*- '?(button|textbox|searchbox|slider|switch|checkbox|combobox|link|tab|radio|menuitem|separator) "((?:[^"\\]|\\.)*)"/.exec(line)
    if (!m) continue
    const name = m[2].split(title).join('<title>').replace(/\d+/g, '#')
      .replace(/^Model: .*\. Change model$/, 'Model: <model>. Change model') // the model and its level are values
      .replace(/^.*(\. Change how much Hermux may do without asking)$/, '<access mode>$1')
    out.add(`${m[1]} "${name}"`)
  }
  return [...out]
}

module.exports = async t => {
  const { browser } = t
  const shell = async (size, chat) => {
    const p = await browser.newPage({ viewport: size })
    await p.addInitScript(nativeShell)
    if (chat) await p.addInitScript(id => { if (!sessionStorage.getItem('opened')) { sessionStorage.setItem('opened', '1'); localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: 'default' })) } }, chat)
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    return p
  }

  // ── heights of the chat screen at 360 x 740, keyboard closed and open ──
  {
    const p = await shell({ width: 360, height: 740 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await p.waitForTimeout(600)
    // Found without class names: the header is the banner; the messages are the scrolling box holding a reply; the
    // composer area is the largest box around the text box that does not hold the messages.
    const measure = () => p.evaluate(() => {
      const reply = [...document.querySelectorAll('p')].find(e => e.textContent === 'answer s-48')
      let sc = reply
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const box = document.querySelector('textarea[placeholder="Message Hermux"]')
      let comp = box
      while (comp.parentElement && !comp.parentElement.contains(sc) && comp.parentElement !== document.body) comp = comp.parentElement
      const head = document.querySelector('header, [role="banner"]').getBoundingClientRect()
      const s = sc ? sc.getBoundingClientRect() : { top: 0, bottom: 0 }
      const c = comp.getBoundingClientRect()
      const top = Math.max(head.bottom, s.top)
      const bottom = Math.min(c.top, s.bottom)
      return { header: Math.round(head.bottom), composer: Math.round(innerHeight - c.top), messages: Math.round(bottom - top), found: !!sc }
    })
    const closed = await measure()
    await p.getByPlaceholder('Message Hermux').focus()
    await p.setViewportSize({ width: 360, height: 440 })
    await p.waitForTimeout(400)
    const open = await measure()
    if (record) console.log('RECORDED_HEIGHTS', JSON.stringify({ closed, open }))
    for (const [k, now, was] of [['closed', closed, RECORDED_HEIGHTS.closed], ['open', open, RECORDED_HEIGHTS.open]]) {
      check(now.found && now.header <= was.header + 1 && now.composer <= was.composer + 1 && now.messages >= was.messages - 1,
        `fixed: keyboard ${k}, the header (${now.header} px, recorded ${was.header}) and the composer area (${now.composer}, recorded ${was.composer}) did not grow and the messages' visible height (${now.messages}, recorded ${was.messages}) did not shrink`)
    }
    await p.close()
  }

  // ── the localStorage keys of a normal session keep their names and shapes ──
  {
    const p = await shell({ width: 375, height: 812 })
    const box = p.getByPlaceholder('Message Hermux')
    await box.fill('hello there')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    await p.getByText('OK', { exact: true }).waitFor({ timeout: 8000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByText('Chat 46', { exact: true }).click()
    await p.getByText('answer s-46', { exact: true }).waitFor({ timeout: 8000 })
    await box.fill('a draft')
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog').getByRole('button', { name: /Read every reply aloud/ }).click()
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings' }).click()
    await p.getByRole('button', { name: /^Appearance/ }).click()
    await p.getByRole('button', { name: /^Light/ }).click()
    await p.getByRole('button', { name: '110%', exact: true }).click()
    await p.waitForTimeout(1500)
    const now = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))
    const shapes = Object.fromEntries(Object.keys(now).sort().map(k => [k, parse(now[k])]))
    if (record) console.log('RECORDED_STORAGE', JSON.stringify(shapes, null, 2))
    const gone = Object.keys(RECORDED_STORAGE).filter(k => !(k in shapes))
    const changed = Object.keys(RECORDED_STORAGE).filter(k => k in shapes && !fits(shapes[k], RECORDED_STORAGE[k])).map(k => `${k}: ${RECORDED_STORAGE[k]} → ${shapes[k]}`)
    const added = Object.keys(shapes).filter(k => !(k in RECORDED_STORAGE))
    check(Object.keys(RECORDED_STORAGE).length > 0 && gone.length === 0, `fixed: every recorded localStorage key is still written (gone: ${JSON.stringify(gone)}; new: ${JSON.stringify(added)})`)
    check(changed.length === 0, `fixed: no recorded localStorage key changed its shape (${JSON.stringify(changed)})`)
    await p.close()
  }

  // ── the accessible names of the chat screen's controls ──
  {
    const p = await shell({ width: 375, height: 812 }, 's-49')
    await p.getByText('answer s-49', { exact: true }).waitFor({ timeout: 8000 })
    await p.waitForTimeout(600)
    const names = new Set(await controlNames(p, 'Chat 49'))
    const box = p.getByRole('textbox', { name: /^(Message Hermux|Queue or steer a follow-up…)$/ }) // its name while a reply runs
    await box.fill('typed')
    for (const n of await controlNames(p, 'Chat 49')) names.add(n)
    await box.fill('slow reply')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 }).catch(() => {})
    for (const n of await controlNames(p, 'Chat 49')) names.add(n)
    await box.fill('more')
    for (const n of await controlNames(p, 'Chat 49')) names.add(n)
    await box.fill('')
    await p.getByText('Slow done.').waitFor({ timeout: 5000 }).catch(() => {})
    const list = [...names].sort()
    if (record) console.log('RECORDED_NAMES', JSON.stringify(list, null, 2))
    const missing = RECORDED_NAMES.filter(n => !names.has(n))
    check(RECORDED_NAMES.length > 0 && missing.length === 0, `fixed: every recorded control of the chat screen still has its accessible name (missing: ${JSON.stringify(missing)}; new: ${JSON.stringify(list.filter(n => !RECORDED_NAMES.includes(n)))})`)
    await p.close()
  }
}
