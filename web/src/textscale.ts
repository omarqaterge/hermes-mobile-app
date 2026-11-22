// Appearance → Text size. Until the person picks a size in the app (`hm.textScale` unset), the app's text scale follows
// Android's font size (Settings → Display → Font size), read once when the page loads through the keyed bridge
// (`phoneTextScale`) and clamped to the sizes the app offers, 90 % to 135 %. A change of the phone's font size restarts
// the activity, so the page reads it again then; nothing polls. Picking one of the five sizes stores it and overrides the
// phone; "Phone default" removes `hm.textScale` again. A size stored by an earlier version is read as it always was.
// No import of the store here: store.ts reads initialTextScale while it loads.

/** The sizes Appearance offers, smallest first. */
export const TEXT_SIZES = [0.9, 1, 1.1, 1.2, 1.35] as const
export const MIN_TEXT_SCALE = TEXT_SIZES[0]
export const MAX_TEXT_SCALE = TEXT_SIZES[TEXT_SIZES.length - 1]
const KEY = 'hm.textScale'

/** A phone's font scale in the app's range; anything that is not a positive number is 1 (normal). */
export function clampTextScale(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, Math.round(n * 100) / 100))
}

/** The size the person chose in the app, or null while it follows the phone. Read as before: any positive number. */
export function savedTextChoice(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

type ScaleBridge = { phoneTextScale?: () => number }

/** Android's font size, clamped; 1 in a plain browser or an older shell. */
export function phoneTextScale(): number {
  try {
    const b = window.HermesAndroid as unknown as ScaleBridge | undefined
    return clampTextScale(typeof b?.phoneTextScale === 'function' ? b.phoneTextScale() : 1)
  } catch {
    return 1
  }
}

/** The scale the app starts with: the person's choice, else the phone's. */
export function initialTextScale(): number {
  return savedTextChoice() ?? phoneTextScale()
}

/** A size picked in Appearance (null: Phone default, which forgets the choice and follows the phone again). Returns the
 *  scale to show now (the caller puts it in the store). */
export function chooseTextScale(v: number | null): number {
  try {
    if (v == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(v))
  } catch {
    /* storage refused: the choice lasts until the app restarts */
  }
  return v ?? phoneTextScale()
}
