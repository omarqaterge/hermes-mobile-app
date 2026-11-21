// Behaviour → Replies → "Dynamic UI": Hermes answering with OpenUI cards, tables, charts and forms in the chat (plugin
// /openui). New chats only: Hermes freezes its system prompt per chat. Cards already in chats keep showing either way.
// Moved as it was from the Settings main page (Settings.tsx OpenUISection); the request and the switch are unchanged.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { errText } from '../gateway'
import { toast } from '../store'
import { ToggleRow } from './ui'
import { toastNewChats } from '../newchats'

const OPENUI = '/api/plugins/hermes-mobile/openui'

/** The plugin's Dynamic UI switch: null until `GET /openui` answers (an older plugin has no such route: no row). */
export function useDynamicUI(): { on: boolean; set: (v: boolean) => void } | null {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api<{ enabled?: boolean }>('GET', OPENUI, undefined, { profile: false })
      .then(r => live && setOn(r.enabled !== false))
      .catch(() => {}) // an older plugin: no row
    return () => {
      live = false
    }
  }, [])
  if (on === null) return null
  const set = (v: boolean) => {
    setOn(v)
    api('PUT', OPENUI, { enabled: v }, { profile: false }).then(() => toastNewChats(`Dynamic UI ${v ? 'on' : 'off'}`), e => {
      setOn(!v)
      toast(`Couldn’t save: ${errText(e)}`, 'error')
    })
  }
  return { on, set }
}

export function DynamicUIRow({ state }: { state: { on: boolean; set: (v: boolean) => void } }) {
  return <ToggleRow icon="puzzle" tone="green" title="Dynamic UI" sub="Tables, charts and forms you can tap. Applies to new chats" on={state.on} onChange={state.set} />
}
