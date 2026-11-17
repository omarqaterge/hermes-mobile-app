// Which part of the Library page is showing (Canvases, Files, Projects), remembered in localStorage `hm.libraryPart`,
// and the way to open the page on a part. No components here, so any screen can open the Library without a cycle.
import { setState } from './store'

export type LibraryPart = 'canvases' | 'files' | 'projects'

const KEY = 'hm.libraryPart'
const PARTS: LibraryPart[] = ['canvases', 'files', 'projects']

export function savedPart(): LibraryPart {
  try {
    const v = localStorage.getItem(KEY)
    return PARTS.includes(v as LibraryPart) ? (v as LibraryPart) : 'canvases'
  } catch {
    return 'canvases'
  }
}

export function savePart(p: LibraryPart): void {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
}

/** Opens the Library, on `part` when given (the canvas panel's "Open a file from the phone" opens Files), else where the person left it. */
export function openLibrary(part?: LibraryPart): void {
  if (part) savePart(part)
  setState({ screen: 'library', screenProfile: null })
}
