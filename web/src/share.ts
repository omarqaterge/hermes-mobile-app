// "Share to Hermes" from other apps (and launcher shortcuts, at the end) (Android share sheet). The shell calls window.hermesShared(count, text):
// a new chat opens with the text in the composer and the shared files attached, ready to send (never sent
// by itself). Files are pulled one at a time over the bridge (sharedItem), so a big PDF doesn't block the rest.
import { attachFile, composerPrefill, errText, startDraft } from './gateway'
import { sharedItem } from './bridge'
import { liveAvailable, startLive } from './live'
import { getState, setState, toast } from './store'

declare global {
  interface Window {
    hermesShared?: (count: number, text: string) => void
  }
}

function toFile(b64: string, name: string, mime: string): File {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

async function whenOnline(ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (getState().conn !== 'open') {
    if (Date.now() > end) return false
    await new Promise(r => setTimeout(r, 250))
  }
  return true
}

export async function receiveShare(count: number, text: string): Promise<void> {
  setState({ screen: null, sheet: null })
  startDraft()
  // The composer of the new chat mounts on the next render.
  await new Promise(r => setTimeout(r, 50))
  if (text.trim()) composerPrefill.set(text.trim())
  if (count <= 0) return
  if (!(await whenOnline(60_000))) {
    toast('Hermux is offline: share the files again once it runs', 'error')
    return
  }
  for (let i = 0; i < count; i++) {
    const it = sharedItem(i)
    if (!it.b64) {
      toast(`${it.name || 'Shared file'}: ${it.error || 'unreadable'}`, 'error')
      continue
    }
    try {
      await attachFile(toFile(it.b64, it.name || `shared-${i + 1}`, it.mime || 'application/octet-stream'))
    } catch (err) {
      toast(errText(err), 'error')
    }
  }
}

window.hermesShared = (count: number, text: string) => void receiveShare(Number(count) || 0, String(text || ''))

// Launcher shortcuts (long-press the app icon): New chat, Live mode. "Last chat" opens through hermesOpenSession.
declare global {
  interface Window {
    hermesShortcut?: (kind: string) => void
  }
}
window.hermesShortcut = (kind: string) => {
  setState({ screen: null, sheet: null, drawer: false })
  startDraft()
  if (kind !== 'live') return
  if (!liveAvailable()) return toast('Live mode needs the phone app’s voice features', 'warn')
  void whenOnline(30_000).then(ok => (ok ? startLive() : toast('Hermux is offline', 'error')))
}
