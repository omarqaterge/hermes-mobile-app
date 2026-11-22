// Settings → Notifications: the two kinds of notification the person can turn off inside the app, the way to Android's
// own settings for the app's notifications, and a notice while Android shows none of them. The shell keeps the choices
// and does the posting (notifychoice.ts, NotifyChoice.java); this page never changes Android's channels.
import { useEffect, useState } from 'react'
import { confirmDialog } from '../dialog'
import { NOTIFY_CHANGED, notifyChoicesAvailable, openNotificationSettings, readNotifyState, setNotifyChoice, turnOnNotifications, type NotifyKind, type NotifyState } from '../notifychoice'
import { haptic } from '../bridge'
import { toast } from '../store'
import { IconChip, Row, Section, ToggleRow } from './ui'

/** The choices and Android's state, read when the page opens, when the app comes back on screen and when Android answered
 *  the permission dialog. No timer. */
export function useNotifyState(): NotifyState {
  const [s, setS] = useState(readNotifyState)
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') setS(readNotifyState())
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener(NOTIFY_CHANGED, again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener(NOTIFY_CHANGED, again)
    }
  }, [])
  return s
}

export const NEEDS_ME_OFF = 'Hermux will wait silently until you open the app.'
const FOOTER = 'The working notification that keeps Hermux running always shows, and Android’s own settings still apply.'

export function NotificationsPage() {
  const read = useNotifyState()
  const [s, setS] = useState(read)
  useEffect(() => setS(read), [read])
  if (!notifyChoicesAvailable()) {
    return (
      <Section footer="Notifications are set in the Android app.">
        <Row title="Notifications" value="Not available here" />
      </Section>
    )
  }
  const set = (which: NotifyKind, on: boolean) => {
    if (!setNotifyChoice(which, on)) {
      toast('Couldn’t change it')
      return
    }
    setS(readNotifyState())
  }
  const needsMe = async (on: boolean) => {
    if (!on && !(await confirmDialog({ title: 'Turn off “When Hermux needs me”?', message: NEEDS_ME_OFF, icon: 'bell', confirmLabel: 'Turn off' }))) return
    set('needsMe', on)
  }
  return (
    <>
      {!s.allowed && (
        <div className="attn-list">
          <div className="attn-card attn-gold" role="group" aria-label="Notifications are off">
            <IconChip tone="gold">bell</IconChip>
            <div className="attn-text">
              <div className="attn-title">Notifications are off</div>
              <div className="attn-line">Android isn’t showing Hermux’s notifications, so neither choice below reaches you.</div>
              <button className="btn attn-btn primary" onClick={() => { haptic(); turnOnNotifications() }}>
                {s.canAsk ? 'Turn on notifications' : 'Open Android settings'}
              </button>
            </div>
          </div>
        </div>
      )}
      <Section title="Tell me" footer={FOOTER}>
        <ToggleRow icon="done" tone="green" title="When a task finishes" sub="A reply, a scheduled job or a background task is done." on={s.finishes} onChange={on => set('finishes', on)} />
        <ToggleRow icon="hand" tone="purple" title="When Hermux needs me" sub="An approval or a question is waiting." on={s.needsMe} onChange={on => void needsMe(on)} />
      </Section>
      <Section>
        <Row icon="phone" tone="gray" title="Sound, vibration and the lock screen" sub="Android’s settings for Hermux’s notifications" chevron onClick={() => openNotificationSettings()} />
      </Section>
    </>
  )
}
