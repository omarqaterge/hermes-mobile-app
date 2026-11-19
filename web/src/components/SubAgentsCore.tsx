// What every start needs of the sub-agent interface: the group's one line, the chevron on a chat's row, and the loader of the
// rest. The rows and the sheet (SubAgents.tsx, subagents.css) are a lazy bundle (`hm-subagents`, vite.config.ts, run through
// lazy.ts), run the first time a group is on screen, or the chat list is showing or about to show a chat's sub-agents. It
// shares this page's React and stores: what it imports is handed to it here (`subAgentHost`), so nothing exists twice.
import { Component, memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { api } from '../api'
import { haptic } from '../bridge'
import { useBackHandler } from '../backstack'
import { confirmDialog } from '../dialog'
import { continueSubAgent, errText, resumeSession, steerSubAgent, stopSubAgent, subAgentTail } from '../gateway'
import { runLazy } from '../lazy'
import { askUnlock, lockView } from '../lockview'
import { useLockView } from '../needsyou'
import { GuardCtx, chatTainted, idsReadState, isTaintedNow } from '../phone-data-taint'
import { openSettingsOn } from '../settings-open'
import { useSidePanel } from '../sidepanel'
import { getState, setState, toast, useStore } from '../store'
import {
  EFFORT_WORD,
  STATE_WORD,
  cleanStored,
  getSubAgent,
  groupWords,
  isLive,
  listHeld,
  listState,
  loadStored,
  nestedIsOpen,
  noteItems,
  noteStored,
  openSubSheet,
  plainLine,
  setNestedOpen,
  shortTime,
  subAgentsOf,
  useListFree,
  useNested,
  useNestedChoice,
  useSubAgent,
  useSubAgentRow,
  useSubTarget,
  wentWrong,
  type SubGroup,
  type SubItem
} from '../subagents'
import { Icon } from './icons'
import { Linked } from './Linked'
import { plainTitle } from './Title'
import { Chevron } from './ui'

export interface SubAgentUi {
  SubGroupRows: ComponentType<{ chat: string; keys: string[]; items: SubItem[] }>
  NestedRows: ComponentType<{ chat: string; snapAt: number; only?: ReadonlySet<string>; turning: boolean }>
  SubAgentSheet: ComponentType
  css: string
}

/** The chat list is on screen: open on a phone, or docked. A closed panel draws no nested rows and reads nothing for them. */
export function useListShown(): boolean {
  const open = useStore(s => s.drawer)
  const [wide, hidden] = useSidePanel()
  return (wide && !hidden) || open
}

/** What the lazy bundle imports from the app, by the module it names (vite.config.ts `hostedByApp`). */
export function subAgentHost(): Record<string, Record<string, unknown>> {
  return {
    react: { Component, memo, useEffect, useLayoutEffect, useRef, useState },
    'react/jsx-runtime': { Fragment, jsx, jsxs },
    api: { api },
    bridge: { haptic },
    backstack: { useBackHandler },
    dialog: { confirmDialog },
    gateway: { continueSubAgent, errText, resumeSession, steerSubAgent, stopSubAgent, subAgentTail },
    lockview: { askUnlock, lockView },
    needsyou: { useLockView },
    'phone-data-taint': { GuardCtx, chatTainted, idsReadState, isTaintedNow },
    'settings-open': { openSettingsOn },
    store: { getState, setState, toast, useStore },
    subagents: {
      EFFORT_WORD, STATE_WORD, cleanStored, getSubAgent, isLive, listHeld, listState, loadStored, nestedIsOpen, noteItems, noteStored,
      openSubSheet, plainLine, shortTime, subAgentsOf, useListFree, useNested, useNestedChoice, useSubAgent, useSubAgentRow,
      useSubTarget, wentWrong
    },
    'components/icons': { Icon },
    'components/Linked': { Linked },
    'components/Title': { plainTitle },
    'components/SubAgentsCore': { useListShown }
  }
}

let ui: SubAgentUi | null = null
let loading: Promise<void> | null = null
const uiSubs = new Set<() => void>()

export function loadSubAgentUi(): Promise<void> {
  if (!loading) {
    const page = window as unknown as { __hmSubAgentHost?: unknown }
    if (!import.meta.env.DEV) page.__hmSubAgentHost = subAgentHost()
    const load = import.meta.env.DEV ? import('../subagents-ui-entry').then(m => m.default) : runLazy<SubAgentUi>('hm-subagents', '__hmSubAgents')
    const done = () => delete page.__hmSubAgentHost // the bundle took what it needs when it ran
    loading = load.then(a => {
      done()
      const style = document.createElement('style') // after the page's own CSS
      style.id = 'hm-subagents-css'
      style.textContent = a.css
      document.head.appendChild(style)
      ui = a
      uiSubs.forEach(f => f())
    })
    loading.catch(() => {
      done()
      loading = null // a failed load can be tried again
    })
  }
  return loading
}

function useSubAgentUi(wanted = true): SubAgentUi | null {
  const loaded = useSyncExternalStore(
    f => {
      uiSubs.add(f)
      return () => uiSubs.delete(f)
    },
    () => ui
  )
  useEffect(() => {
    if (wanted && !loaded) void loadSubAgentUi().catch(() => {})
  }, [wanted, loaded])
  return loaded
}

// These stand where the real ones go and draw nothing until the bundle has run. The bundle is asked for before they are needed
// (the group's line, the list showing, rows about to open), and what is on screen by then is final, so nothing moves.
export function SubGroupRows(p: { chat: string; keys: string[]; items: SubItem[] }) {
  const u = useSubAgentUi()
  return u ? <u.SubGroupRows {...p} /> : null
}
export function NestedRows(p: { chat: string; snapAt: number; only?: ReadonlySet<string>; turning: boolean }) {
  const s = useNested(p.chat)
  useNestedChoice()
  // A chat that merely has stored sub-agents costs nothing while the list is closed.
  const u = useSubAgentUi(useListShown() || nestedIsOpen(p.chat, s))
  return u ? <u.NestedRows {...p} /> : null
}
export function SubAgentSheet() {
  const u = useSubAgentUi()
  useEffect(() => {
    if (!u) loadSubAgentUi().catch(() => setState({ sheet: null })) // nothing would ever show: don't hold the sheet's place
  }, [u])
  return u ? <u.SubAgentSheet /> : null
}

export const SubGroupHead = memo(function SubGroupHead({
  id,
  words,
  failed,
  running,
  shimmer,
  open,
  onToggle
}: {
  id: string
  words: string
  failed: number
  running: boolean
  shimmer: boolean
  open: boolean
  onToggle: (id: string) => void
}) {
  useEffect(() => void loadSubAgentUi().catch(() => {}), []) // ready before the line can be tapped
  return (
    <button className={`tool-run sub-group${running ? ' sub-group-live' : ''}`} aria-expanded={open} onClick={() => { haptic(); onToggle(id) }}>
      <Icon n="subagent" />
      <span className={`tool-run-label sub-group-words${shimmer ? ' sub-shimmer' : ''}`}>{words}</span>
      {failed > 0 && <span className="sub-group-failed">· {failed} failed</span>}
      <span className="chev"><Chevron open={open} /></span>
    </button>
  )
})

export const groupProps = (g: SubGroup) => ({ words: groupWords(g), failed: g.failed, running: g.running > 0 })

/** The chevron on a chat's row, when the chat has sub-agents. */
export function NestedToggle({ chat }: { chat: string }) {
  const s = useNested(chat)
  useNestedChoice()
  const locked = useLockView()
  const listShown = useListShown()
  if (!s.total || locked || !listShown) return null
  const open = nestedIsOpen(chat, s)
  return (
    <button
      className="nested-toggle"
      aria-label={open ? 'Hide sub-agents' : 'Show sub-agents'}
      aria-expanded={open}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation()
        haptic()
        setNestedOpen(chat, !open)
      }}
    >
      <Chevron open={open} />
    </button>
  )
}
