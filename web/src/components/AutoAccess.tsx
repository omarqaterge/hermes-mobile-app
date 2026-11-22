import { useState } from 'react'
import { accessOf, defaultAccess, errText, newSession, setAccess, setDefaultAccess, type Access } from '../gateway'
import { getState, toast, useStore } from '../store'
import { viewSettled } from '../chatview'
import { confirmDialog } from '../dialog'
import { confirmFullAccess } from '../access-confirm'
import { PickerSheet, SelectRow, type Option } from './ui'
import { Icon } from './icons'

const OPTIONS: Option[] = [
  { value: 'off', label: 'Off', sub: 'Hermux asks before risky commands', icon: 'hand', tone: 'gray' },
  {
    value: 'auto',
    label: 'Auto access',
    sub: 'Runs everything without asking, except the commands on Hermux’s dangerous list (recursive deletes, overwriting system or config files, force-killing processes, piping downloads into a shell…): those are blocked',
    icon: 'shield',
    tone: 'teal'
  },
  { value: 'full', label: 'Full access', sub: 'Runs every command without asking. Only Hermux’s catastrophic list (wipe the disk, shut down…) stays blocked', icon: 'zap', tone: 'red' }
]

const DONE: Record<Access, string> = {
  off: 'Auto off: Hermux asks before risky commands again',
  auto: 'Auto access on for this chat: dangerous commands are blocked, everything else runs',
  full: 'Full access on for this chat: Hermux runs commands without asking'
}

/** The Auto button beside the composer's model chip: how much this chat may do without asking (off / Auto access / Full access).
 *  Full access spells itself out ("⚡ Full access"), so the chip doubles as the warning that commands run unchecked. */
export function AutoButton({ hideWhenOff = false, compact = false }: { hideWhenOff?: boolean; compact?: boolean }) {
  // On the empty screen no chat exists yet: it shows the mode the chat will start in (Settings → Auto for all chats).
  // While a chat opens, `active` is not the chat on screen (chatview.ts): show Off and take no change, or it would
  // land on the chat being left, or start a new chat on top of the one opening.
  const settled = useStore(viewSettled)
  const mode = useStore(s => (!viewSettled(s) ? 'off' : s.active ? accessOf(s.active) : defaultAccess()))
  const offline = useStore(s => s.conn !== 'open')
  const [open, setOpen] = useState(false)

  const pick = async (v: string) => {
    const want = v as Access
    if (want === mode) return
    if (want === 'full' && !(await confirmFullAccess())) return
    try {
      let a = getState().active
      if (!a) {
        await newSession() // the empty screen: the setting belongs to a chat, so start it
        a = getState().active
      }
      if (!a) throw new Error('No chat to change')
      toast(DONE[await setAccess(a, want)])
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  if (hideWhenOff && mode === 'off') return null // the Live bar shows it only as a reminder that approvals are off
  const label = mode === 'auto' ? 'Auto access is on' : mode === 'full' ? 'Full access is on' : 'Auto is off'
  return (
    <>
      <button key={mode} className={`auto-btn ${mode}`} aria-label={`${label}. Change how much Hermux may do without asking`} disabled={offline || !settled} onClick={() => setOpen(true)}>
        {compact ? <Icon n={mode === 'full' ? 'zap' : 'shield'} /> : mode === 'full' ? <><Icon n="zap" /> Full access</> : 'Auto'}
      </button>
      {open && <PickerSheet title="Auto: run without asking" options={OPTIONS} value={mode} onPick={v => void pick(v)} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Settings → "Auto for all chats": the mode every chat starts in (a chat you set yourself keeps its own). */
export function DefaultAccessRow() {
  const [mode, setMode] = useState<Access>(defaultAccess())
  const pick = async (v: string) => {
    const want = v as Access
    if (want === 'full') {
      const ok = await confirmDialog({
        title: 'Full access in every chat?',
        message: 'Hermux will run every command in every chat without asking you first: deleting or overwriting files, killing apps, installing software, sending data over the network. Nothing is checked before it runs. Only Hermux’s short catastrophic list (wiping the disk, shutting down the phone) stays blocked. You can still turn it off for a single chat from its Auto button.',
        confirmLabel: 'Allow in all chats',
        icon: 'warning',
        danger: true
      })
      if (!ok) return
    }
    setDefaultAccess(want)
    setMode(want)
  }
  return <SelectRow icon="zap" tone="teal" title="Auto for all chats" options={OPTIONS} value={mode} onChange={v => void pick(v)} />
}
