import { useEffect, useMemo, useState } from 'react'
import { accessOf, defaultAccess, errText, newSession, setAccess, setDefaultAccess, type Access } from '../gateway'
import { getState, toast, useStore } from '../store'
import { viewSettled } from '../chatview'
import { confirmDialog } from '../dialog'
import { confirmFullAccess } from '../access-confirm'
import { askUnlock, lockView } from '../lockview'
import { useLockView } from '../needsyou'
import {
  approvalsModeNote,
  autoButtonLabel,
  autoButtonText,
  currentApprovalsMode,
  defaultAccessSub,
  doneOffToast,
  isLooseApprovals,
  offOptionSub,
  recheckApprovalsMode,
  useApprovalsMode,
  type ApprovalsMode
} from '../approvals-mode'
import { openSettingsOn } from '../settings-open'
import { haptic } from '../bridge'
import { IconChip, PickerSheet, SelectRow, type Option } from './ui'
import { Icon } from './icons'

const autoOptions = (hermesMode: ApprovalsMode | null): Option[] => [
  { value: 'off', label: 'Off', sub: offOptionSub(hermesMode), icon: 'hand', tone: 'gray' },
  {
    value: 'auto',
    label: 'Auto access',
    sub: 'Runs everything without asking, except the commands on Hermux’s dangerous list (recursive deletes, overwriting system or config files, force-killing processes, piping downloads into a shell…): those are blocked',
    icon: 'shield',
    tone: 'teal'
  },
  { value: 'full', label: 'Full access', sub: 'Runs every command without asking. Only Hermux’s catastrophic list (wipe the disk, shut down…) stays blocked', icon: 'zap', tone: 'red' }
]

const DONE: Record<Exclude<Access, 'off'>, string> = {
  auto: 'Auto access on for this chat: dangerous commands are blocked, everything else runs',
  full: 'Full access on for this chat: Hermux runs commands without asking'
}

/** Calm note inside the Auto picker when Hermes's own `approvals.mode` is `smart` or `off`, with a direct link to the setting. */
function ApprovalsModePickerNote({ hermesMode, onOpen }: { hermesMode: ApprovalsMode | null; onOpen: () => void }) {
  if (!isLooseApprovals(hermesMode)) return null
  const note = approvalsModeNote(hermesMode)
  return (
    <div className="picker-card approvals-note">
      <button
        className="picker-opt"
        onClick={() => {
          haptic()
          onOpen()
        }}
      >
        <IconChip tone={hermesMode === 'off' ? 'red' : 'gold'}>sliders</IconChip>
        <span className="set-text">
          <span className="set-title">{note.title} · {note.value}</span>
          <span className="set-sub">{note.sub}</span>
        </span>
        <span className="set-chev" aria-hidden="true"><Icon n="right" /></span>
      </button>
    </div>
  )
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
  const locked = useLockView()
  const hermesMode = useApprovalsMode()
  const shownHermesMode = locked ? null : hermesMode
  const [open, setOpen] = useState(false)
  const options = useMemo(() => autoOptions(shownHermesMode), [shownHermesMode])

  useEffect(() => {
    if (locked && open) setOpen(false)
  }, [locked, open])

  const pick = async (v: string) => {
    const want = v as Access
    if (want === mode) return
    if (want === 'full' && !(await confirmFullAccess())) return
    if (want !== 'off' && lockView()) {
      askUnlock('Unlock the phone to change Auto')
      return
    }
    try {
      let a = getState().active
      if (!a) {
        await newSession() // the empty screen: the setting belongs to a chat, so start it
        a = getState().active
      }
      if (!a) throw new Error('No chat to change')
      const got = await setAccess(a, want)
      toast(got === 'off' ? doneOffToast(lockView() ? null : currentApprovalsMode(a.profile)) : DONE[got])
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  // The Live bar shows the button as a reminder whenever commands may run without asking (chat Auto/Full, or Hermes smart/off).
  if (hideWhenOff && mode === 'off' && !isLooseApprovals(shownHermesMode)) return null
  const label = autoButtonLabel(mode, shownHermesMode)
  const looseClass = mode === 'off' && isLooseApprovals(shownHermesMode) ? ` hermes-${shownHermesMode}` : ''
  const chipText = autoButtonText(mode, shownHermesMode)
  return (
    <>
      <button
        key={`${mode}:${mode === 'off' ? (shownHermesMode ?? '') : ''}`}
        className={`auto-btn ${mode}${looseClass}`}
        aria-label={`${label}. Change how much Hermux may do without asking`}
        disabled={offline || !settled}
        onClick={() => {
          if (lockView()) {
            askUnlock('Unlock the phone to change Auto')
            return
          }
          recheckApprovalsMode()
          setOpen(true)
        }}
      >
        {compact ? <Icon n={mode === 'full' || (mode === 'off' && shownHermesMode === 'off') ? 'zap' : 'shield'} /> : mode === 'full' ? <><Icon n="zap" /> {chipText}</> : chipText}
      </button>
      {open && !locked && (
        <PickerSheet
          title="Auto: run without asking"
          options={options}
          value={mode}
          onPick={v => void pick(v)}
          onClose={() => setOpen(false)}
          footer={
            <ApprovalsModePickerNote
              hermesMode={shownHermesMode}
              onOpen={() => {
                setOpen(false)
                openSettingsOn('config', 'close', 'approvals.mode')
              }}
            />
          }
        />
      )}
    </>
  )
}

/** Settings → "Auto for all chats": the mode every chat starts in (a chat you set yourself keeps its own). */
export function DefaultAccessRow({ hermesMode = null, openApprovalsMode }: { hermesMode?: ApprovalsMode | null; openApprovalsMode?: () => void } = {}) {
  const [mode, setMode] = useState<Access>(defaultAccess())
  const options = useMemo(() => autoOptions(hermesMode), [hermesMode])
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
  return (
    <SelectRow
      icon="zap"
      tone="teal"
      title="Auto for all chats"
      sub={defaultAccessSub(mode, hermesMode)}
      options={options}
      value={mode}
      onChange={v => void pick(v)}
      footer={
        openApprovalsMode
          ? close => (
              <ApprovalsModePickerNote
                hermesMode={hermesMode}
                onOpen={() => {
                  close()
                  openApprovalsMode()
                }}
              />
            )
          : undefined
      }
    />
  )
}
