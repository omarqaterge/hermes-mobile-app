// Settings → About: the switch for the diagnostic log and its delete button. The log is on the phone only; it leaves only
// when the user includes it in a problem report (Report.tsx).
import { useState } from 'react'
import { confirmDialog } from '../dialog'
import { clearDiagnostics, diagnosticsEnabled, setDiagnosticsEnabled } from '../diagnostics'
import { toast } from '../store'
import { Row, ToggleRow } from './ui'

export function DiagRows() {
  const [on, setOn] = useState(diagnosticsEnabled)
  return (
    <>
      <ToggleRow
        title="Keep a diagnostic log"
        sub="On this phone only: errors, crashes and restarts from the last 7 days, never your chats. It's sent only if you include it in a report"
        on={on}
        onChange={v => {
          setOn(v)
          setDiagnosticsEnabled(v)
          if (!v) toast('Diagnostic log off and deleted')
        }}
      />
      {on && (
        <Row
          icon="🧹"
          tone="red"
          title="Delete the diagnostic log"
          sub="Also empties the agent's service logs on this phone"
          onClick={() => {
            void confirmDialog({ title: 'Delete the diagnostic log?', message: "It can't be brought back. New events are kept from now on.", confirmLabel: 'Delete', danger: true }).then(ok => {
              if (!ok) return
              clearDiagnostics()
              toast('Diagnostic log deleted')
            })
          }}
        />
      )}
    </>
  )
}
