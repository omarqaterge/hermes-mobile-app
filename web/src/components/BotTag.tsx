// The bot a page applies to, in its top bar, shown only when there are several bots (with one there is nothing to tell
// apart). One line, cut with an ellipsis, inside the bar's existing height. `profile` is the bot's id; none = the
// current bot.
import { useStore } from '../store'
import { Icon } from './icons'

export function BotTag({ profile }: { profile?: string | null }) {
  const profiles = useStore(s => s.profiles)
  const current = useStore(s => s.profile)
  if (profiles.length < 2) return null
  const name = profile || current
  const p = profiles.find(x => x.name === name)
  const label = (p && (p.display_name || p.name)) || name
  return (
    <span className="topbar-bot" aria-label={`Bot: ${label}`} role="note">
      <Icon n="bot" size={15} />
      <span className="topbar-bot-name">{label}</span>
    </span>
  )
}
