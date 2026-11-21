// "Applies to new chats": Hermux fixes a chat's tools, connectors, model and reply options when the chat starts, so a
// change to them reaches only chats started after it. The confirmation says so and offers "New chat", which closes the
// page or sheet and starts one, exactly as the side panel's New chat does (gateway.ts startDraft). Nothing else changes.
import { startDraft } from './gateway'
import { setState, toast } from './store'

export const NEW_CHATS_NOTE = 'Applies to new chats'

/** The toast after a change that only new chats see: `text`, then "Applies to new chats", and a "New chat" button. */
export function toastNewChats(text: string): void {
  const said = /new chats/i.test(text) ? text : `${text.replace(/[.\s]+$/, '')}. ${NEW_CHATS_NOTE}.`
  toast(said, 'info', 6000, {
    label: 'New chat',
    run: () => {
      setState({ screen: null, screenProfile: null, sheet: null })
      startDraft()
    }
  })
}
