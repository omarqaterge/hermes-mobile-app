// Big optional bundles (Mermaid, OpenUI) ship inside index.html as inert <script type="text/hm-lazy" id=…> text
// (vite.config.ts lazyBundle), so the phone doesn't parse them at every start. The first user runs one, once.
const ready = new Map<string, Promise<unknown>>()

export function runLazy<T>(id: string, global: string): Promise<T> {
  let p = ready.get(id) as Promise<T> | undefined
  if (!p) {
    p = new Promise<T>((resolve, reject) => {
      const src = document.getElementById(id)?.textContent
      if (!src) return reject(new Error(`${id} is not bundled`))
      setTimeout(() => {
        try {
          new Function(src)()
          const v = (window as unknown as Record<string, unknown>)[global] as T | undefined
          if (v) resolve(v)
          else reject(new Error(`${id} did not load`))
        } catch (e) {
          reject(e)
        }
      })
    })
    ready.set(id, p)
    p.catch(() => ready.delete(id)) // a failed load can be retried
  }
  return p
}
