// A chat as Markdown, for the share sheet (chat menu → Share chat).
import type { ActiveSession, ChatItem } from './store'

const quote = (t: string) =>
  t
    .split('\n')
    .map(l => `> ${l}`)
    .join('\n')

function itemMd(it: ChatItem): string {
  switch (it.kind) {
    case 'user': {
      const att = [...(it.images ?? []), ...(it.files ?? [])]
      return `**You:**\n\n${it.text}${att.length ? `\n\n_Attached: ${att.join(', ')}_` : ''}`
    }
    case 'assistant':
      return it.text.trim() ? `**Hermes:**\n\n${it.text.trim()}` : ''
    case 'tool':
      return `_🔧 ${it.name}${it.context ? `: ${it.context}` : ''}${it.status === 'error' ? ' (failed)' : ''}_`
    case 'subagent':
      return `_🤖 Sub-agent: ${it.goal}_`
    case 'notice':
      return it.level === 'error' ? quote(`⚠ ${it.text}`) : ''
  }
}

export function chatMarkdown(a: Pick<ActiveSession, 'title' | 'items'>, when = new Date()): string {
  const title = (a.title || 'Chat with Hermes').replace(/^⎇\s*/, '')
  const parts = [`# ${title}`, `_Exported from Hermux on ${when.toLocaleString()}_`]
  for (const it of a.items) {
    const md = itemMd(it)
    if (md) parts.push(md)
  }
  return parts.join('\n\n') + '\n'
}
