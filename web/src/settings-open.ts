// Opening Settings on one of its pages from somewhere else (the chat's model sheet, the empty new-chat screen):
// `openSettingsOn('add')` opens the Add a provider page. With `back: 'close'` Back on that page closes Settings again,
// so it returns where it came from (the chat) instead of going up to Models. Read once by SettingsScreen when it opens.
import { askUnlock, lockView } from './lockview'
import { setState } from './store'
import type { SettingsPageId } from './settings-search'

export interface SettingsStart {
  page: SettingsPageId
  back: 'close' | 'up'
  /** Optional initial search query (used when opening Advanced settings directly on one config key). */
  query?: string
}

let start: SettingsStart | null = null

export function openSettingsOn(page: SettingsPageId, back: SettingsStart['back'] = 'close', query?: string): void {
  if (lockView()) {
    start = null
    askUnlock('Unlock the phone to open Settings')
    return
  }
  start = query ? { page, back, query } : { page, back }
  setState({ screen: 'settings', screenProfile: null, sheet: null, drawer: false })
}

/** The page Settings was asked to open on (once: the next open starts on the main page again). */
export function takeSettingsStart(): SettingsStart | null {
  const s = start
  start = null
  return s
}
