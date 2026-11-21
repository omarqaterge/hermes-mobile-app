// "About this": the longer explanation of a section, behind one row, so the section's footer stays one sentence. The row
// opens a sheet with the text; nothing in it is a setting.
import { useState, type ReactNode } from 'react'
import { Sheet } from './Screens'
import { Row } from './ui'

export function AboutThis({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Row icon="info" tone="gray" title="About this" chevron onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className="sheet-scroll about-this">{children}</div>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
