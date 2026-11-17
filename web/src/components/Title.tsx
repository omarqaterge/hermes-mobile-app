// Chat titles. A branched chat is stored as "⎇ <original title>" (Hermes only keeps plain text), and is
// drawn with a proper branch icon here, so it never depends on a font having the ⎇ glyph.
import { Icon } from './icons'

export const BRANCH_MARK = '\u2387'
export const isBranch = (t?: string | null): boolean => Boolean(t) && (t as string).startsWith(BRANCH_MARK)
/** The title without the branch marker (for inputs, dialogs, toasts). */
export const plainTitle = (t?: string | null): string => (t || '').replace(/^\u2387\s*/, '')
/** A rename keeps the branch marker: someone editing a branch's name doesn't see or lose it. */
export const keepBranch = (original: string | undefined | null, next: string): string => (isBranch(original) && !isBranch(next) && next ? `${BRANCH_MARK} ${next}` : next)

export function BranchIcon({ size = 14 }: { size?: number }) {
  return <Icon n="branch" size={size} label="Branch" className="branch-icon" strokeWidth={2.2} />
}

export function Title({ text, fallback = '' }: { text?: string | null; fallback?: string }) {
  if (!text) return <>{fallback}</>
  return isBranch(text) ? (
    <>
      <BranchIcon />
      {plainTitle(text)}
    </>
  ) : (
    <>{text}</>
  )
}
