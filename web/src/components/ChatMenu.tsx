// The menu for a chat (spec 3.5): from the header's Chat options on an open chat (`ChatMenuSheet`), on the empty
// new-chat screen (`DraftMenuSheet`), and the header both share with a row's menu in the chat list
// (`ChatMenuHeader`, SessionList.tsx). Built from the menu parts in ui.tsx (MenuSheet, MenuHeader, MenuActions,
// MenuGroup, MenuRow). Pin, Archive and Delete go through chatactions.ts, as the chat list's do.
import { useState } from 'react'
import { errText, renameStored, undoLast } from '../gateway'
import { openCanvas, useCanvas } from '../canvas'
import { Title, keepBranch, plainTitle } from './Title'
import { hasChatOverride, setAutoReadFor, setDraftRead, useAutoRead, useDraftAutoRead } from '../voice'
import { setState, toast, useStore } from '../store'
import { haptic, shareText } from '../bridge'
import { chatMarkdown } from '../export'
import { useOrder } from '../order'
import { archiveChat, deleteChat, pinChat } from '../chatactions'
import { Icon } from './icons'
import { MenuAction, MenuActions, MenuGroup, MenuHeader, MenuNote, MenuRow, MenuSheet } from './ui'

/** The chat's title (the branch icon for a branch), the dim line under it, and the Rename button (a pencil), which swaps
 *  the header for the field "Chat title" and Save. Save closes the menu (`onDone`) and renames through the dashboard,
 *  keeping a branch's mark; toast "Renamed". */
export function ChatMenuHeader({ id, title, fallback, sub, onDone }: { id: string; title?: string | null; fallback: string; sub?: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plainTitle(title))
  if (editing)
    return (
      <form
        className="menu-rename"
        onSubmit={e => {
          e.preventDefault()
          onDone()
          renameStored(id, keepBranch(title, draft.trim()))
            .then(() => toast('Renamed'))
            .catch(err => toast(errText(err), 'error'))
        }}
      >
        <input className="sheet-input" autoFocus aria-label="Chat title" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Chat title" />
        <button className="btn" type="submit">
          Save
        </button>
      </form>
    )
  return (
    <MenuHeader
      title={<Title text={title} fallback={fallback} />}
      sub={sub}
      action={
        <button
          className="icon-btn menu-head-btn"
          aria-label="Rename"
          onClick={() => {
            haptic()
            setEditing(true)
          }}
        >
          <Icon n="pencil" />
        </button>
      }
    />
  )
}

const botName = (p?: { display_name?: string | null; name?: string }, fallback = '') => p?.display_name || p?.name || fallback

/** The header's Chat options on an open chat. */
export function ChatMenuSheet() {
  const active = useStore(s => s.active)
  const running = useStore(s => s.active?.running ?? false)
  const profiles = useStore(s => s.profiles)
  const reading = useAutoRead(active?.storedId)
  const canvasCount = useCanvas(c => c.docs.length)
  const [order] = useOrder(active?.profile ?? '')
  if (!active) return null
  const id = active.storedId
  const profile = active.profile
  const pinned = order.pinned.includes(id)
  const close = () => setState({ sheet: null })
  const act = (fn: () => void) => () => {
    close()
    fn()
  }
  // The model, and the bot when there are several.
  const bot = profiles.length > 1 ? botName(profiles.find(p => p.name === profile), profile) : ''
  const sub = [active.info.model, bot].filter(Boolean).join(' · ')
  const label = plainTitle(active.title)
  return (
    <MenuSheet label="Chat options" onClose={close}>
      <ChatMenuHeader id={id} title={active.title} fallback="New chat" sub={sub} onDone={close} />
      <MenuActions>
        <MenuAction icon="search" label="Search" name="Search in chat" onClick={act(() => setState({ find: { q: '', i: 0 } }))} />
        <MenuAction
          icon="note"
          label="Canvas"
          name={canvasCount ? `Canvas (${canvasCount} document${canvasCount === 1 ? '' : 's'})` : 'Canvas'}
          count={canvasCount}
          onClick={act(() => openCanvas())}
        />
        <MenuAction
          icon="share"
          label="Share"
          name="Share chat"
          onClick={act(() => {
            if (!shareText(label || 'Chat', chatMarkdown(active))) toast('Copied as Markdown (sharing works in the phone app)')
          })}
        />
        <MenuAction icon="pin" label={pinned ? 'Unpin' : 'Pin'} name={pinned ? 'Unpin' : 'Pin to top'} onClick={act(() => pinChat(profile, id, !pinned))} />
      </MenuActions>
      <MenuGroup>
        <MenuRow
          icon="speaker"
          title="Read replies aloud"
          sub={hasChatOverride(id) ? 'Only this chat' : 'Follows the setting for all chats'}
          on={reading}
          onSwitch={on => {
            setAutoReadFor(id, on)
            toast(on ? 'Reading every reply aloud in this chat' : 'Read-aloud off for this chat')
          }}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon="undo" title="Undo last turn" disabled={running} sub={running ? 'Wait for the reply to finish' : undefined} onClick={act(() => void undoLast())} />
        <MenuRow icon="rewind" title="File checkpoints" chevron onClick={() => setState({ sheet: 'rollback' })} />
        <MenuRow icon="info" title="Chat details" chevron onClick={() => setState({ sheet: 'session-actions' })} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon="archive" title="Archive" onClick={act(() => void archiveChat(profile, id, true))} />
        <MenuRow icon="trash" title="Delete" danger onClick={act(() => void deleteChat(profile, id, label))} />
      </MenuGroup>
    </MenuSheet>
  )
}

/** The header's Chat options on the empty new-chat screen: only what makes sense before the first message. */
export function DraftMenuSheet() {
  const reading = useDraftAutoRead()
  const close = () => setState({ sheet: null })
  return (
    <MenuSheet label="Chat options" onClose={close}>
      <MenuHeader title="New chat" />
      <MenuGroup>
        <MenuRow
          icon="speaker"
          title="Read replies aloud"
          sub="Applies once the chat starts"
          on={reading}
          onSwitch={on => {
            setDraftRead(on)
            toast(on ? 'This chat will read every reply aloud' : 'Read-aloud off for this chat')
          }}
        />
      </MenuGroup>
      <MenuNote>Rename, pin, archive and delete are available once you have sent a message.</MenuNote>
    </MenuSheet>
  )
}
