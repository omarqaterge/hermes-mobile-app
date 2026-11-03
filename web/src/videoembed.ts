// Which addresses play inside the chat, and the player address for each.
import { linkParts, mediaKind } from './text'

export type VideoEmbed = {
  /** The address as written: "Open" hands this one to the phone. */
  url: string
  /** What the card calls the source: the site's name, or the host for any other page. */
  label: string
  /** The player's address: the frame's page, or the video file itself when `file` is set. */
  src: string
  /** Preview picture, for the sites that have one at a known address. */
  thumb?: string
  /** A video file drawn with the app's own video element instead of a frame. */
  file?: boolean
}

/** A reply draws at most this many players (a list of twenty links stays a list); the other links stay plain links. */
export const MAX_VIDEOS = 3

/** The Android shell answers this host itself (`MainActivity.embedPage`): a small page around the player, so players get
 *  an https page to name as their embedder. The app's own page is a file: and sends none, which YouTube refuses. */
export const EMBED_HOST = 'com.omarqaterge.hermesmobile'

const YT_ID = /^[\w-]{6,20}$/

/** A YouTube start time as seconds: `90`, `90s` or `1h2m3s`. */
function seconds(t: string | null): number {
  const m = t ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t) : null
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0
}

function youtube(u: URL, host: string): VideoEmbed | null {
  const parts = u.pathname.split('/').filter(Boolean)
  const list = u.searchParams.get('list')
  const safeList = list && /^[\w-]{2,64}$/.test(list) ? list : ''
  let id = ''
  if (host === 'youtu.be') id = parts[0] || ''
  else if (parts[0] === 'watch') id = u.searchParams.get('v') || ''
  else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1] || ''
  else if (!(parts[0] === 'playlist' && safeList)) return null
  if (id && !YT_ID.test(id)) return null
  const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0' })
  const start = seconds(u.searchParams.get('t') || u.searchParams.get('start'))
  if (start) q.set('start', String(start))
  if (safeList) q.set('list', safeList)
  if (!id && !safeList) return null
  if (!id) q.set('listType', 'playlist')
  return {
    url: u.href,
    label: 'YouTube',
    src: `https://www.youtube-nocookie.com/embed/${id}?${q}`,
    thumb: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined
  }
}

function site(u: URL, host: string): VideoEmbed | null {
  const parts = u.pathname.split('/').filter(Boolean)
  const make = (label: string, src: string): VideoEmbed => ({ url: u.href, label, src })
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const [id, hash] = parts[0] === 'video' ? parts.slice(1) : parts
    if (!/^\d{5,12}$/.test(id || '')) return null
    const h = /^[\da-f]{6,32}$/.test(hash || '') ? hash : u.searchParams.get('h')
    return make('Vimeo', `https://player.vimeo.com/video/${id}?autoplay=1${h && /^[\da-f]{6,32}$/.test(h) ? `&h=${h}` : ''}`)
  }
  if (host === 'dai.ly' || host === 'dailymotion.com') {
    const id = host === 'dai.ly' ? parts[0] : parts[0] === 'video' || parts[0] === 'embed' ? parts[parts.length - 1] : ''
    return /^[a-zA-Z0-9]{5,12}$/.test(id || '') ? make('Dailymotion', `https://www.dailymotion.com/embed/video/${id}?autoplay=1`) : null
  }
  if (host === 'streamable.com') {
    const id = parts[0] === 'e' ? parts[1] : parts[0]
    return /^[a-z0-9]{4,12}$/i.test(id || '') ? make('Streamable', `https://streamable.com/e/${id}?autoplay=1`) : null
  }
  if (host === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : ''
    return /^[\da-f]{16,40}$/.test(id || '') ? make('Loom', `https://www.loom.com/embed/${id}?autoplay=1`) : null
  }
  return null
}

/** The player for a link, or null when it is an ordinary link. Sites have their own player pages; a link to a video file
 *  plays with the app's video element. Any other page plays only when the reply asks for a frame (`frameEmbed`). */
export function embedOf(raw: string): VideoEmbed | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^(?:www|m|music)\./, '')
  if (['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return youtube(u, host)
  const known = site(u, host)
  if (known) return known
  return mediaKind(u.pathname) === 'video' ? { url: u.href, label: host, src: u.href, file: true } : null
}

/** A frame the reply asked for by name (`<iframe src="https://…">`): any https page, labelled by its host. */
export function frameEmbed(raw: string): VideoEmbed | null {
  const known = embedOf(raw)
  if (known) return known
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.protocol === 'https:' && raw.length <= 2000 ? { url: u.href, label: u.hostname.toLowerCase(), src: u.href } : null
}

/** The address the frame loads: in the phone app, through the shell's page (`EMBED_HOST`). */
export function frameSrc(src: string, inApp: boolean): string {
  return inApp ? `https://${EMBED_HOST}/embed?u=${encodeURIComponent(src)}` : src
}

/** The players a plain-text message asks for: its video links, without repeats, up to `MAX_VIDEOS`. */
export function embedsInText(text: string): VideoEmbed[] {
  const out: VideoEmbed[] = []
  for (const p of linkParts(text)) {
    const e = p.href ? embedOf(p.href) : null
    if (e && out.length < MAX_VIDEOS && !out.some(o => o.src === e.src)) out.push(e)
  }
  return out
}
