import { useState } from 'react'
import { accessOf, errText, newSession, setAccess, type Access } from '../gateway'
import { getState, toast, useStore } from '../store'
import { confirmDialog } from '../dialog'
import { PickerSheet, type Option } from './ui'

const OPTIONS: Option[] = [
  { value: 'off', label: 'Off', sub: 'Hermes asks before risky commands', icon: '✋', tone: 'gray' },
  {
    value: 'auto',
    label: 'Auto access',
    sub: 'Runs everything without asking, except the commands on Hermes’s dangerous list (recursive deletes, overwriting system or config files, force-killing processes, piping downloads into a shell…): those are blocked',
    icon: '🛡',
    tone: 'teal'
  },
  { value: 'full', label: 'Full access', sub: 'Runs every command without asking. Only Hermes’s catastrophic list (wipe the disk, shut down…) stays blocked', icon: '⚡', tone: 'red' }
]

const DONE: Record<Access, string> = {
  off: 'Auto off: Hermes asks before risky commands again',
  auto: 'Auto access on for this chat: dangerous commands are blocked, everything else runs',
  full: 'Full access on for this chat: Hermes runs commands without asking'
}

/** The header's Auto button: how much this chat may do without asking (off / Auto access / Full access). */
export function AutoButton() {
  const mode = useStore(s => accessOf(s.active))
  const offline = useStore(s => s.conn !== 'open')
  const [open, setOpen] = useState(false)

  const pick = async (v: string) => {
    const want = v as Access
    if (want === mode) return
    if (want === 'full') {
      const ok = await confirmDialog({
        title: 'Give Hermes full access?',
        message:
          'Hermes will run every command in this chat without asking you first: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A wrong step can lose your data, and nothing is checked before it runs. Only Hermes’s short catastrophic list (wiping the disk, shutting down the phone) stays blocked. Use it only for a task you trust, and turn it off afterwards.',
        confirmLabel: 'Allow full access',
        icon: '⚠️',
        danger: true
      })
      if (!ok) return
    }
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

  const label = mode === 'auto' ? 'Auto access is on' : mode === 'full' ? 'Full access is on' : 'Auto is off'
  return (
    <>
      <button className={`auto-btn ${mode}`} aria-label={`${label}. Change how much Hermes may do without asking`} disabled={offline} onClick={() => setOpen(true)}>
        {mode === 'full' ? '⚡ ' : ''}Auto
      </button>
      {open && <PickerSheet title="Auto: run without asking" options={OPTIONS} value={mode} onPick={v => void pick(v)} onClose={() => setOpen(false)} />}
    </>
  )
}
