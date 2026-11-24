// The confirmation in front of anything that lets Hermux run commands without asking: Full access from the Auto button,
// the slash commands that turn Hermes's approvals off or hand them to a model (`/approvals off`, `/approvals smart`),
// and changing `approvals.mode` to `off` or `smart` in Advanced settings.
import { confirmDialog } from './dialog'

export const FULL_ACCESS_TITLE = 'Give Hermux full access?'
export const FULL_ACCESS_CONFIRM = 'Allow full access'

const CHAT_MESSAGE =
  'Hermux will run every command in this chat without asking you first: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A wrong step can lose your data, and nothing is checked before it runs. Only Hermux’s short catastrophic list (wiping the disk, shutting down the phone) stays blocked. Use it only for a task you trust, and turn it off afterwards.'

const APPROVALS_MESSAGE: Record<'off' | 'smart', (allBots: boolean) => string> = {
  off: allBots =>
    `Hermes will run risky commands without asking you first, in every chat of ${allBots ? 'every bot' : 'this bot'} and not only this one, until you set /approvals manual: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A wrong step can lose your data. Use it only for a task you trust, and set it back afterwards.`,
  smart: allBots =>
    `A model will decide which risky commands run without asking you first, in every chat of ${allBots ? 'every bot' : 'this bot'} and not only this one, until you set /approvals manual: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A model can be wrong, or be talked into it by text it reads. Use it only for a task you trust, and set it back afterwards.`
}

const ask = (message: string) => confirmDialog({ title: FULL_ACCESS_TITLE, message, confirmLabel: FULL_ACCESS_CONFIRM, icon: 'warning', danger: true })

/** Full access for this chat (the Auto button). */
export const confirmFullAccess = (): Promise<boolean> => ask(CHAT_MESSAGE)

/** `/approvals off` / `/approvals smart` and `approvals.mode` in Advanced settings: the same warning, naming this bot or every bot. */
export const confirmLooseApprovals = (mode: 'off' | 'smart', allBots = false): Promise<boolean> => ask(APPROVALS_MESSAGE[mode](allBots))
