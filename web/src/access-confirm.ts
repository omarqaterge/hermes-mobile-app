// The confirmation in front of anything that lets Hermux run commands without asking: Full access from the Auto button,
// the slash commands that turn Hermes's approvals off or hand them to a model (`/approvals off`, `/approvals smart`),
// and changing `approvals.mode` to `off` or `smart` in Advanced settings.
import { confirmDialog } from './dialog'

export const FULL_ACCESS_TITLE = 'Give Hermux full access?'
export const FULL_ACCESS_CONFIRM = 'Allow full access'

const CHAT_MESSAGE =
  'Hermux will run every command in this chat without asking you first: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A wrong step can lose your data, and nothing is checked before it runs. Only Hermux’s short catastrophic list (wiping the disk, shutting down the phone) stays blocked. Use it only for a task you trust, and turn it off afterwards.'

// Each loosened mode gets its own title and button: `smart` is not full access, and Settings has no "this chat".
const APPROVALS_TITLE: Record<'off' | 'smart', string> = {
  off: 'Turn off approvals?',
  smart: 'Let a model approve commands?'
}
const APPROVALS_CONFIRM: Record<'off' | 'smart', string> = {
  off: 'Turn off approvals',
  smart: 'Use smart approvals'
}

const where = (allBots: boolean) =>
  allBots
    ? 'in every chat of every bot, until you set each bot back to manual'
    : 'in every chat of this bot, until you set it back to manual (/approvals manual, or approvals.mode in Advanced settings)'

const APPROVALS_MESSAGE: Record<'off' | 'smart', (allBots: boolean) => string> = {
  off: allBots =>
    `Hermux will run risky commands without asking you first, ${where(allBots)}: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A wrong step can lose your data. Use it only for a task you trust, and set it back afterwards.`,
  smart: allBots =>
    `A model will decide which risky commands run without asking you first, ${where(allBots)}: deleting or overwriting files, killing apps and processes, installing software, changing settings, sending data over the network. A model can be wrong, or be talked into it by text it reads. Use it only for a task you trust, and set it back afterwards.`
}

const ask = (message: string, title = FULL_ACCESS_TITLE, confirmLabel = FULL_ACCESS_CONFIRM) =>
  confirmDialog({ title, message, confirmLabel, icon: 'warning', danger: true })

/** Full access for this chat (the Auto button). */
export const confirmFullAccess = (): Promise<boolean> => ask(CHAT_MESSAGE)

/** `/approvals off` / `/approvals smart` and `approvals.mode` in Advanced settings: a warning titled for the mode, naming this bot or every bot. */
export const confirmLooseApprovals = (mode: 'off' | 'smart', allBots = false): Promise<boolean> => ask(APPROVALS_MESSAGE[mode](allBots), APPROVALS_TITLE[mode], APPROVALS_CONFIRM[mode])
