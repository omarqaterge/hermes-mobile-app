// Settings → Connectors: status words, the add-a-server form's request, and which toolsets and keys count as connectors.
import { expect, test } from 'vitest'
import { connectorToolsets, hermesCmd, isSkillKey, parseEnvLines, serverBody, serverWhere, splitCommand, toolsetState } from './connectors'

test('a toolset is off, needs setup, or connected', () => {
  expect(toolsetState({ enabled: false, configured: true })).toBe('off')
  expect(toolsetState({ enabled: true, configured: false })).toBe('setup')
  expect(toolsetState({ enabled: true, configured: true })).toBe('connected')
})

test('only the toolsets that reach a service, in the page order', () => {
  const t = (name: string) => ({ name, label: name, enabled: true, configured: true })
  expect(connectorToolsets([t('file'), t('tts'), t('web'), t('terminal')]).map(x => x.name)).toEqual(['web', 'tts'])
})

test('a command line keeps quoted parts together', () => {
  expect(splitCommand('npx -y @modelcontextprotocol/server-github')).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })
  expect(splitCommand('uvx my-server --dir "/sdcard/My Notes"')).toEqual({ command: 'uvx', args: ['my-server', '--dir', '/sdcard/My Notes'] })
  expect(splitCommand('   ')).toEqual({ command: '', args: [] })
})

test('environment lines', () => {
  expect(parseEnvLines('A=1\n\nnot a line\n B = two words \n1BAD=x\nC=x=y')).toEqual({ A: '1', B: 'two words', C: 'x=y' })
})

test('the add-a-server request', () => {
  const base = { name: 'my server!', kind: 'url' as const, url: 'https://mcp.example.com/mcp', command: '', env: '', auth: 'none' as const, token: '' }
  expect(serverBody(base)).toEqual({ ok: true, body: { name: 'myserver', url: 'https://mcp.example.com/mcp', auth: 'none' } })
  expect(serverBody({ ...base, name: '' })).toEqual({ ok: false, why: 'Give it a name' })
  expect(serverBody({ ...base, url: 'mcp.example.com' }).ok).toBe(false)
  expect(serverBody({ ...base, auth: 'header' }).ok).toBe(false)
  expect(serverBody({ ...base, auth: 'header', token: ' t0k ' })).toEqual({ ok: true, body: { name: 'myserver', url: 'https://mcp.example.com/mcp', auth: 'header', bearer_token: 't0k' } })
  expect(serverBody({ ...base, kind: 'command', command: 'npx -y srv', env: 'K=v' })).toEqual({ ok: true, body: { name: 'myserver', command: 'npx', args: ['-y', 'srv'], env: { K: 'v' } } })
  expect(serverBody({ ...base, kind: 'command' }).ok).toBe(false)
})

test('where a server lives', () => {
  expect(serverWhere({ name: 'a', transport: 'http', url: 'https://x', enabled: true })).toBe('https://x')
  expect(serverWhere({ name: 'a', transport: 'stdio', command: 'npx', args: ['-y', 's'], enabled: true })).toBe('npx -y s')
})

test('skill keys and the Termux command', () => {
  expect(isSkillKey('NOTION_API_KEY', { category: 'skill' })).toBe(true)
  expect(isSkillKey('GITHUB_TOKEN', { category: 'tool' })).toBe(true)
  expect(isSkillKey('OPENAI_API_KEY', { category: 'provider' })).toBe(false)
  expect(isSkillKey('X', { category: 'skill', channel_managed: true })).toBe(false)
  expect(hermesCmd('tools post-setup spotify', 'default')).toBe('hermes tools post-setup spotify')
  expect(hermesCmd('mcp login notion', 'work')).toBe('hermes -p work mcp login notion')
})
