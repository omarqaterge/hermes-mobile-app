// The local authentication alert (localalert.ts): one of two fixed banners while the shell says one is on. Renders
// nothing otherwise, so the layout doesn't move when there is no alert.
import { wsUrl } from '../bridge'
import { reconnectNow } from '../gateway'
import { LOCAL_ALERT_TEXT, tryAgain, useLocalAlert, useLocalAlertTrying } from '../localalert'
import { getState, useStore } from '../store'

// The shell checks the dashboard again before it gives the page a token, and clears the alert when that verifies: so a
// try asks for one, through a reconnect, or while still connected through the reconnect's own token step alone (a
// reconnect would only reload the open chat).
const retry = () => tryAgain(() => (getState().conn === 'open' ? wsUrl() : reconnectNow(false)))

export function LocalAlertBanner() {
  const kind = useLocalAlert()
  const trying = useLocalAlertTrying()
  const conn = useStore(s => s.conn)
  if (!kind) return null
  const t = LOCAL_ALERT_TEXT[kind]
  return (
    <div className="local-alert" role="alert" data-kind={kind}>
      <div className="local-alert-text">
        <div className="local-alert-title">{t.title}</div>
        <div className="local-alert-body">{t.body}</div>
        {t.more && <div className="local-alert-more">{t.more}</div>}
      </div>
      {t.retry && (
        <button type="button" className="btn local-alert-retry" disabled={trying || conn === 'connecting'} onClick={() => void retry()}>
          Try again
        </button>
      )}
    </div>
  )
}
