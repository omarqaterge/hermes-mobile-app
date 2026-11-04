import { Fragment } from 'react'
import { haptic } from '../bridge'
import { openChecked, useGuard } from '../phone-data-taint'
import { linkParts } from '../text'

/** Plain text whose web addresses open with the phone's default handler (browser, or the app that owns the link). */
export function Linked({ text }: { text: string }) {
  const guarded = useGuard() // a chat that has read phone data: the address is shown in full before it opens
  return (
    <>
      {linkParts(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            className="auto-link"
            onClick={e => {
              // The message bubble's own tap shows the time; a link tap must only open the link.
              e.preventDefault()
              e.stopPropagation()
              haptic()
              void openChecked(p.href!, guarded)
            }}
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  )
}
