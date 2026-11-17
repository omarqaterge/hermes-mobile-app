// Pin, archive and delete a chat: one copy of each, used by the chat's menu from the header (Sheets.tsx
// `ChatMenuSheet`) and by a row's menu and swipes in the chat list (SessionList.tsx), so both do exactly the same
// thing: the same calls, the same toasts and confirmation, and the same word to the chat list's snapshot
// (chatsnapshot.ts `chatListChanged`) so its order stays correct. Spec 3.5, 3.13.
import { deleteSession, errText, setArchived } from './gateway'
import { updateOrder } from './order'
import { toast } from './store'
import { confirmDialog } from './dialog'
import { chatListChanged } from './chatsnapshot'

/** Pins the chat first in Pinned, or unpins it. */
export function pinChat(profile: string, id: string, on: boolean): void {
  updateOrder(profile, o => ({ ...o, pinned: on ? [id, ...o.pinned.filter(x => x !== id)] : o.pinned.filter(x => x !== id) }))
  toast(on ? 'Pinned' : 'Unpinned')
}

/** Archives the chat (it leaves Pinned; the open chat gives way to a new draft, gateway `setArchived`) or restores it.
 *  Resolves true when it worked; a failure is toasted. */
export function archiveChat(profile: string, id: string, on: boolean): Promise<boolean> {
  return setArchived(id, on)
    .then(() => {
      if (on) updateOrder(profile, o => ({ ...o, pinned: o.pinned.filter(x => x !== id) }))
      chatListChanged(!on) // the order is read again; a restored chat with the list that brings it back
      toast(on ? 'Archived' : 'Restored')
      return true
    })
    .catch(e => {
      toast(errText(e), 'error')
      return false
    })
}

/** Asks first, then deletes the chat (its live sessions are closed first, gateway `deleteSession`) and takes it out of
 *  the pins and the custom order. `label` names it in the question. Resolves true when it was deleted. */
export async function deleteChat(profile: string, id: string, label: string): Promise<boolean> {
  const ok = await confirmDialog({
    title: `Delete “${label || 'this chat'}”?`,
    message: 'The whole conversation is removed. This cannot be undone.',
    danger: true
  })
  if (!ok) return false
  return deleteSession(id)
    .then(() => {
      updateOrder(profile, o => ({ ...o, pinned: o.pinned.filter(x => x !== id), manual: o.manual && o.manual.filter(x => x !== id) }))
      chatListChanged()
      toast('Deleted')
      return true
    })
    .catch(e => {
      toast(errText(e), 'error')
      return false
    })
}
