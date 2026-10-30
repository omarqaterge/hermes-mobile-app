import { useState } from 'react'
import { haptic } from '../bridge'
import { setState } from '../store'
import { shortPath, type FileChange, type TurnChanges } from '../changes'
import { DiffView } from './Diff'
import { Sheet } from './Screens'
import { Chevron, Collapse } from './ui'

function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="diffstat">
      <span className="diffstat-add">+{added}</span> <span className="diffstat-del">−{removed}</span>
    </span>
  )
}

/** "✎ 3 files changed +42 −7" at the end of a turn that wrote files; tap for the files and their diffs. */
export function TurnChangesCard({ changes }: { changes: TurnChanges }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<FileChange | null>(null)
  const n = changes.files.length
  return (
    <div className="turn-changes">
      <button className="turn-changes-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>✎</span>
        <span className="turn-changes-title">
          {n} file{n === 1 ? '' : 's'} changed
        </span>
        <Stat added={changes.added} removed={changes.removed} />
        <span className="chev"><Chevron open={open} /></span>
      </button>
      <Collapse open={open}>
        <div className="turn-changes-list">
          {changes.files.map(f => (
            <button
              key={f.path}
              className="turn-changes-row"
              onClick={() => {
                haptic()
                setFile(f)
              }}
            >
              <span className="turn-changes-path">{shortPath(f.path)}</span>
              {f.rewritten && f.diffs.length === 0 && <span className="dim small">new or rewritten</span>}
              <Stat added={f.added} removed={f.removed} />
            </button>
          ))}
          <button className="btn block" onClick={() => setState({ sheet: 'rollback' })}>
            Checkpoints
          </button>
        </div>
      </Collapse>
      {file && (
        <Sheet title={file.path} onClose={() => setFile(null)}>
          <div className="pad">{file.diffs.length ? <DiffView text={file.diffs.join('\n')} max={200000} /> : <div className="dim">No diff recorded for this edit</div>}</div>
        </Sheet>
      )}
    </div>
  )
}
