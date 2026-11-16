// What a held OpenUI card leaves out: every web address in a component's props, after the card's expressions ran (so an
// address built by joining strings, a Query answer or a $variable is caught too). Pure and dependency-free: the lazy
// OpenUI bundle (openui-entry.tsx) imports it, and it must not pull the app's store into that bundle.

/** An address as a browser reads it: whitespace and control characters are dropped (`ht\ttps:evil` is `https:evil`). */
// eslint-disable-next-line no-control-regex
const plain = (s: string): string => s.replace(/[\s\u0000-\u001f\u007f]/g, '')

/** Would an `<img src>` (or a favicon built from it) with this text reach the network? Local, data: and blob: never do. */
export const isWebAddress = (s: string): boolean => /^(?:(?:https?|ftp):|[\\/]{2})/i.test(plain(s))

/** The site of an address, for the "held back" line; '' when it has none. */
export function siteOf(s: string): string {
  const t = plain(s)
  try {
    return new URL(t.startsWith('//') || t.startsWith('\\\\') ? `https:${t.replace(/\\/g, '/')}` : t).host
  } catch {
    return ''
  }
}

const MD_ADDRESS = /(?:(?:https?|ftp):)?[\\/]{2}([^\s/\\?#)\]"'<>]+)/gi

/** One string prop: an address on its own is emptied; Markdown text that names an address keeps its words, but its `![`
 *  becomes `\![`, so an image (inline or by reference) shows as a link instead of being fetched. */
function holdString(s: string, sites: Set<string>): string {
  if (isWebAddress(s)) {
    sites.add(siteOf(s) || 'a web address')
    return ''
  }
  if (!s.includes('![') || !/[\\/]{2}/.test(s)) return s
  for (const m of s.matchAll(MD_ADDRESS)) sites.add(m[1])
  return s.replace(/!\[/g, '\\![')
}

const MAX_DEPTH = 12

/** A component's evaluated props with every web address held back; the sites held are added to `sites`. Child elements
 *  are left alone (each is drawn by its own wrapped component, which holds its own props), and so is a button's action:
 *  `@OpenUrl` opens only through the page's checks (OpenUIBlock `onAction`). Returns the same object when nothing changed,
 *  so React can skip work. */
export function holdProps<T>(value: T, sites: Set<string>, depth = 0): T {
  if (typeof value === 'string') return holdString(value, sites) as T
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map(v => {
      const h = holdProps(v, sites, depth + 1)
      if (h !== v) changed = true
      return h
    })
    return (changed ? out : value) as T
  }
  const o = value as Record<string, unknown>
  if (o.type === 'element') return value // a child component: held by its own wrapper
  let out: Record<string, unknown> | null = null
  for (const [k, v] of Object.entries(o)) {
    if (k === 'action') continue // @OpenUrl / @ToAssistant: never fetched, opened only through the page's checks
    const h = holdProps(v, sites, depth + 1)
    if (h !== v) (out ??= { ...o })[k] = h
  }
  return (out ?? value) as T
}
