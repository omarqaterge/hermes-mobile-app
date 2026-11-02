// Settings → Connectors: the services Hermes can reach, per bot. Everything goes through Hermes's own dashboard routes
// (connectors.ts says which): MCP servers (list, add by address or command, add from Hermes's catalog, on/off, test,
// OAuth sign-in in the phone's browser, remove), tools that need a key or an account (on/off, pick the service, paste
// its key, remove keys; a service whose setup is a terminal wizard copies the Termux command) and keys for skills.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, qs } from '../api'
import { copyText, haptic, openExternal } from '../bridge'
import {
  STATE_WORDS,
  TOOLSET_WORDS,
  cleanServerName,
  connectorToolsets,
  hermesCmd,
  isSkillKey,
  serverBody,
  serverState,
  serverWhere,
  toolsetState,
  type CatalogEntry,
  type ConnState,
  type McpServer,
  type OAuthFlow,
  type ToolProvider,
  type Toolset
} from '../connectors'
import { confirmDialog } from '../dialog'
import { errText } from '../gateway'
import { toast } from '../store'
import { Sheet, Status, useLoader } from './Screens'
import { ProfileChips } from './Settings'
import { Row, Section, Segmented, ToggleRow } from './ui'

interface EnvRow {
  is_set: boolean
  redacted_value?: string | null
  description?: string
  url?: string | null
  category?: string
  channel_managed?: boolean
}

const State = ({ s }: { s: ConnState }) => <span className={`conn-state conn-${s}`}>{STATE_WORDS[s]}</span>

/** Runs one write, toasts its result, and says whether it worked. */
async function act(p: Promise<unknown>, done: string): Promise<boolean> {
  try {
    await p
    if (done) toast(done)
    return true
  } catch (e) {
    toast(errText(e), 'error', 8000)
    return false
  }
}

export function ConnectorsPage({ scope, setScope }: { scope: string; setScope: (s: string) => void }) {
  const p = qs({ profile: scope })
  const servers = useLoader(() => api<{ servers: McpServer[] }>('GET', `/api/mcp/servers?${p}`, undefined, { profile: false }).then(r => r.servers || []), [scope])
  const tools = useLoader(() => api<Toolset[]>('GET', `/api/tools/toolsets?${p}`, undefined, { profile: false }).then(connectorToolsets), [scope])
  const keys = useLoader(
    () => api<Record<string, EnvRow>>('GET', `/api/env?${p}`, undefined, { profile: false }).then(r => Object.entries(r || {}).filter(([k, v]) => isSkillKey(k, v))),
    [scope]
  )
  const [server, setServer] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [catalog, setCatalog] = useState(false)
  const [toolset, setToolset] = useState<Toolset | null>(null)
  const open = servers.data?.find(s => s.name === server)

  const [key, setKey] = useState<[string, EnvRow] | null>(null)

  return (
    <>
      <ProfileChips value={scope} onChange={setScope} label="Connectors for" />
      <Section title="Apps and services (MCP)" footer="MCP servers give Hermes tools from other services: Notion, Linear, GitHub, your own server… A change applies to new chats.">
        {(servers.data || []).map(s => (
          <Row
            key={s.name}
            icon="🔌"
            tone={s.enabled ? 'green' : 'gray'}
            title={s.name}
            sub={<span className="mono small">{serverWhere(s)}</span>}
            value={<State s={serverState(s)} />}
            chevron
            onClick={() => setServer(s.name)}
          />
        ))}
        <Row icon="＋" tone="gold" title="Add from the catalog" sub="Services Hermes knows how to connect" chevron onClick={() => setCatalog(true)} />
        <Row icon="＋" tone="blue" title="Add a server" sub="By its address, or a command that starts it" chevron onClick={() => setAdding(true)} />
      </Section>
      <Status loading={servers.loading} error={servers.error} empty={false} emptyText="" />
      <Section title="Tools with a key or an account" footer="Tap one to turn it on, pick the service it uses and paste its key.">
        {(tools.data || []).map(t => {
          const w = TOOLSET_WORDS[t.name] || { title: t.label, icon: '🧰', sub: t.description || '' }
          return <Row key={t.name} icon={w.icon} tone="teal" title={w.title} sub={w.sub} value={<State s={toolsetState(t)} />} chevron onClick={() => setToolset(t)} />
        })}
      </Section>
      <Status loading={tools.loading} error={tools.error} empty={false} emptyText="" />
      {(keys.data?.length || 0) > 0 && (
        <Section title="Keys for skills" footer="Hermes’s skills for these services read the key from the bot’s .env.">
          {keys.data!.map(([k, r]) => (
            <Row
              key={k}
              title={
                <span className="key-line">
                  <span className={r.is_set ? 'dot-set' : 'dot-unset'} />
                  <span className="key-name">{k}</span>
                </span>
              }
              sub={r.is_set ? (r.redacted_value || 'set').replace(/^«redacted:(.*)»$/, '$1') : r.description || 'not set'}
              value={r.is_set ? 'Saved' : undefined}
              chevron
              onClick={() => setKey([k, r])}
            />
          ))}
        </Section>
      )}
      <div className="dim small pad">Model sign-ins and keys are under Settings → Model providers; every other key is under Settings → API keys.</div>
      {open && <ServerSheet server={open} profile={scope} onClose={() => setServer(null)} onChanged={servers.reload} />}
      {adding && (
        <AddServerSheet
          profile={scope}
          onClose={() => setAdding(false)}
          onAdded={name => { setAdding(false); servers.reload(); setServer(name) }}
        />
      )}
      {catalog && (
        <CatalogSheet
          profile={scope}
          onClose={() => setCatalog(false)}
          onAdded={name => { setCatalog(false); servers.reload(); setServer(name) }}
        />
      )}
      {key && <SkillKeySheet name={key[0]} row={key[1]} profile={scope} onClose={() => setKey(null)} onChanged={keys.reload} />}
      {toolset && <ToolsetSheet toolset={toolset} profile={scope} onClose={() => setToolset(null)} onChanged={tools.reload} />}
    </>
  )
}

// ── one MCP server ───────────────────────────────────────────

/** How long the page keeps asking whether a browser sign-in finished (Hermes forgets a flow after 15 minutes). */
const OAUTH_POLL_MS = 2000
const OAUTH_GIVE_UP_MS = 15 * 60 * 1000

function ServerSheet({ server: s, profile, onClose, onChanged }: { server: McpServer; profile: string; onClose: () => void; onChanged: () => void }) {
  const p = qs({ profile })
  const base = `/api/mcp/servers/${encodeURIComponent(s.name)}`
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; error?: string; tools: Array<{ name: string; description?: string }> } | null>(null)
  const [flow, setFlow] = useState<OAuthFlow | null>(null)
  const pending = useRef<string | null>(null) // the flow Hermes still runs for us, cancelled when we give up or close
  const fromPlugin = s.source === 'plugin'

  const cancelFlow = () => {
    const id = pending.current
    pending.current = null
    if (id) void api('DELETE', `/api/mcp/oauth/flows/${encodeURIComponent(id)}`, undefined, { profile: false }).catch(() => null)
  }
  // While a sign-in waits in the browser: ask Hermes 2 s after each answer, for 15 minutes at most, until it is approved
  // or fails. A failed ask (Hermes busy, the app in the background) is retried; only Hermes forgetting the flow (404) or
  // ten failures in a row end it here, and then the flow is cancelled so a retry isn't refused as "already in progress".
  const flowId = flow?.flow_id
  useEffect(() => {
    if (!flowId || pending.current !== flowId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    const started = Date.now()
    const fail = (error: string, cancel: boolean) => {
      if (cancel) cancelFlow()
      else pending.current = null
      setFlow(f => f && { ...f, status: 'error', error })
    }
    const poll = () => {
      if (Date.now() - started > OAUTH_GIVE_UP_MS) return fail('The sign-in took too long. Try again.', true)
      api<OAuthFlow>('GET', `/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`, undefined, { profile: false })
        .then(f => {
          if (cancelled) return
          failures = 0
          setFlow(f)
          if (f.status === 'approved' || f.status === 'error') {
            pending.current = null
            if (f.status === 'approved') {
              toast(`${s.name} signed in`)
              onChanged()
            }
          } else timer = setTimeout(poll, OAUTH_POLL_MS)
        })
        .catch(e => {
          if (cancelled) return
          if (e instanceof ApiError && e.status === 404) return fail('The sign-in expired. Try again.', false)
          if (++failures >= 10) return fail(errText(e), true)
          timer = setTimeout(poll, OAUTH_POLL_MS)
        })
    }
    timer = setTimeout(poll, OAUTH_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId])
  // Closing the sheet mid-sign-in cancels it, so Hermes frees the slot for a retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => cancelFlow, [])

  const toggle = (on: boolean) => {
    setBusy(true)
    void act(api('PUT', `${base}/enabled?${p}`, { enabled: on }, { profile: false }), on ? `${s.name} on for new chats` : `${s.name} off`).then(() => {
      setBusy(false)
      onChanged()
    })
  }
  const runTest = () => {
    setBusy(true)
    setTest(null)
    api<{ ok: boolean; error?: string; tools?: Array<{ name: string; description?: string }> }>('POST', `${base}/test?${p}`, {}, { profile: false })
      .then(r => setTest({ ok: r.ok, error: r.error, tools: r.tools || [] }))
      .catch(e => setTest({ ok: false, error: errText(e), tools: [] }))
      .finally(() => setBusy(false))
  }
  const signIn = () => {
    setBusy(true)
    api<OAuthFlow>('POST', `${base}/auth?${p}`, {}, { profile: false })
      .then(f => {
        if (f.status !== 'approved' && f.status !== 'error') pending.current = f.flow_id
        setFlow(f)
        if (f.authorization_url) openExternal(f.authorization_url)
        else if (f.status === 'error') toast(f.error || 'Sign-in failed', 'error', 8000)
      })
      .catch(e => toast(errText(e), 'error', 8000))
      .finally(() => setBusy(false))
  }
  const remove = () =>
    void confirmDialog({ title: `Remove ${s.name}?`, message: 'Hermes forgets this server. Its saved token stays in the bot’s .env.', confirmLabel: 'Remove', danger: true }).then(
      ok => ok && act(api('DELETE', `${base}?${p}`, undefined, { profile: false }), `${s.name} removed`).then(done => done && (onChanged(), onClose()))
    )

  const waiting = flow && flow.status !== 'approved' && flow.status !== 'error'
  return (
    <Sheet title={s.name} onClose={onClose}>
      <div className="sheet-scroll">
        <Section>
          <Row title={s.transport === 'stdio' ? 'Command' : 'Address'} sub={<span className="mono small">{serverWhere(s)}</span>} />
          <Row title="Sign-in" sub={s.auth === 'oauth' ? 'Account sign-in (OAuth) in the browser' : s.auth === 'header' ? 'A token, saved in the bot’s .env' : 'None'} />
          {fromPlugin && <Row title="Comes from a plugin" sub={`${s.plugin}: change it there`} />}
        </Section>
        {!fromPlugin && (
          <Section footer="A change applies to new chats.">
            <ToggleRow title="On" sub="Hermes can use this server’s tools" on={s.enabled} onChange={v => !busy && toggle(v)} />
          </Section>
        )}
        {s.auth === 'oauth' && !fromPlugin && (
          <Section footer="Opens the service’s sign-in page in the browser. When it says you can close the tab, come back here.">
            <Row icon="🔑" tone="gold" title={waiting ? 'Waiting for the sign-in…' : 'Sign in'} onClick={waiting || busy ? undefined : signIn} />
            {waiting && flow?.authorization_url && <Row title="Open the sign-in page again" onClick={() => openExternal(flow.authorization_url!)} />}
            {flow?.status === 'approved' && <div className="notice">Signed in.</div>}
            {flow?.status === 'error' && <div className="notice notice-error">{flow.error || 'Sign-in failed'}</div>}
          </Section>
        )}
        <Section>
          <Row icon="⚡" tone="blue" title="Test" sub="Connect and list its tools" onClick={busy ? undefined : runTest} />
          {test && !test.ok && <div className="notice notice-error">{test.error || 'It didn’t answer'}</div>}
          {test?.ok && <div className="notice">{`Works: ${test.tools.length} tool${test.tools.length === 1 ? '' : 's'}`}</div>}
          {test?.ok && test.tools.slice(0, 40).map(t => <Row key={t.name} title={<span className="mono small">{t.name}</span>} sub={t.description} />)}
        </Section>
      </div>
      {!fromPlugin && (
        <div className="sheet-actions">
          <button className="btn danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        </div>
      )}
    </Sheet>
  )
}

// ── add a server ─────────────────────────────────────────────

function AddServerSheet({ profile, onClose, onAdded }: { profile: string; onClose: () => void; onAdded: (name: string) => void }) {
  const [f, setF] = useState({ name: '', kind: 'url' as 'url' | 'command', url: '', command: '', env: '', auth: 'none' as 'none' | 'oauth' | 'header', token: '' })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }))
  const built = serverBody(f)
  const add = () => {
    if (!built.ok) return
    setBusy(true)
    haptic()
    void act(api('POST', `/api/mcp/servers?${qs({ profile })}`, built.body, { profile: false }), `${built.body.name} added`).then(ok => {
      setBusy(false)
      if (ok) onAdded(String(built.body.name))
    })
  }
  return (
    <Sheet title="Add a server" onClose={onClose}>
      <div className="sheet-scroll">
        <label className="field">
          <span>Name</span>
          <input value={f.name} onChange={e => set({ name: cleanServerName(e.target.value) })} placeholder="notion" autoCapitalize="none" />
        </label>
        <Segmented options={[{ value: 'url', label: 'Address' }, { value: 'command', label: 'Command' }]} value={f.kind} onChange={kind => set({ kind })} />
        {f.kind === 'url' ? (
          <>
            <label className="field">
              <span>Address</span>
              <input className="mono" inputMode="url" value={f.url} onChange={e => set({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" autoCapitalize="none" />
            </label>
            <div className="dim small">Sign-in</div>
            <Segmented options={[{ value: 'none', label: 'None' }, { value: 'oauth', label: 'Account' }, { value: 'header', label: 'Token' }]} value={f.auth} onChange={auth => set({ auth })} />
            {f.auth === 'header' && (
              <label className="field">
                <span>Token</span>
                <input className="mono" type="password" autoComplete="off" value={f.token} onChange={e => set({ token: e.target.value })} placeholder="Paste here" />
              </label>
            )}
            {f.auth === 'oauth' && <div className="dim small">After adding it, tap Sign in: the service’s page opens in the browser.</div>}
          </>
        ) : (
          <>
            <label className="field">
              <span>Command</span>
              <input className="mono" value={f.command} onChange={e => set({ command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-github" autoCapitalize="none" />
            </label>
            <label className="field">
              <span>Environment (one KEY=value per line)</span>
              <textarea className="mono" rows={3} value={f.env} onChange={e => set({ env: e.target.value })} placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=…" autoCapitalize="none" />
            </label>
            <div className="dim small">The command runs inside Hermes’s Debian on the phone, so the program (npx, uvx…) must be installed there.</div>
          </>
        )}
      </div>
      <div className="sheet-actions">
        {!built.ok && <span className="dim small">{built.why}</span>}
        <button className="btn primary" disabled={busy || !built.ok} onClick={add}>
          Add
        </button>
      </div>
    </Sheet>
  )
}

// ── Hermes's MCP catalog ─────────────────────────────────────

function CatalogSheet({ profile, onClose, onAdded }: { profile: string; onClose: () => void; onAdded: (name: string) => void }) {
  const { data, error, loading } = useLoader(
    () => api<{ entries: CatalogEntry[] }>('GET', `/api/mcp/catalog?${qs({ profile })}`, undefined, { profile: false }).then(r => r.entries || []),
    [profile]
  )
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<CatalogEntry | null>(null)
  const [env, setEnv] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (data || []).filter(e => !n || e.name.toLowerCase().includes(n) || (e.description || '').toLowerCase().includes(n))
  }, [data, q])
  const missing = (pick?.required_env || []).some(v => v.required !== false && !env[v.name]?.trim())
  const install = () => {
    if (!pick) return
    setBusy(true)
    haptic()
    const vals = Object.fromEntries(Object.entries(env).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
    api<{ ok: boolean; background?: boolean }>('POST', `/api/mcp/catalog/install?${qs({ profile })}`, { name: pick.name, env: vals, enable: true }, { profile: false })
      .then(r => {
        if (r.background) {
          toast(`${pick.name} is installing in the background. It shows up here when it’s ready.`, 'info', 8000)
          onClose()
        } else {
          toast(`${pick.name} added`)
          onAdded(pick.name)
        }
      })
      .catch(e => toast(errText(e), 'error', 8000))
      .finally(() => setBusy(false))
  }
  if (pick)
    return (
      <Sheet title={pick.name} onClose={() => setPick(null)}>
        <div className="sheet-scroll">
          {pick.description && <div className="dim small pad">{pick.description}</div>}
          {pick.auth_type === 'oauth' && <div className="notice">This one signs in with your account: after adding it, tap Sign in.</div>}
          {(pick.required_env || []).map(v => (
            <label key={v.name} className="field">
              <span>{v.prompt || v.name}</span>
              <input className="mono" type="password" autoComplete="off" value={env[v.name] || ''} onChange={e => setEnv(x => ({ ...x, [v.name]: e.target.value }))} placeholder={v.name} />
            </label>
          ))}
          {pick.needs_install && <div className="dim small">Hermes downloads and builds it first; that can take a few minutes.</div>}
        </div>
        <div className="sheet-actions">
          <button className="btn primary" disabled={busy || missing || pick.installed} onClick={install}>
            {pick.installed ? 'Already added' : 'Add'}
          </button>
        </div>
      </Sheet>
    )
  return (
    <Sheet title="Add from the catalog" onClose={onClose}>
      <label className="set-search">
        <span aria-hidden="true">🔍</span>
        <input placeholder="Search (e.g. notion, linear)" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="sheet-scroll">
        <Status loading={loading} error={error} empty={!shown.length} emptyText="Nothing matches" />
        <Section>
          {shown.map(e => (
            <Row
              key={e.name}
              title={e.name}
              sub={e.description}
              value={e.installed ? 'Added' : e.auth_type === 'oauth' ? 'Account' : e.auth_type === 'api_key' ? 'Key' : undefined}
              chevron
              onClick={() => { setEnv({}); setPick(e) }}
            />
          ))}
        </Section>
      </div>
    </Sheet>
  )
}

// ── a tool that needs a key or an account ────────────────────

function ToolsetSheet({ toolset: t, profile, onClose, onChanged }: { toolset: Toolset; profile: string; onClose: () => void; onChanged: () => void }) {
  const p = qs({ profile })
  const base = `/api/tools/toolsets/${encodeURIComponent(t.name)}`
  const cfg = useLoader(() => api<{ providers: ToolProvider[]; active_provider?: string | null }>('GET', `${base}/config?${p}`, undefined, { profile: false }), [t.name, profile])
  const [enabled, setEnabled] = useState(t.enabled)
  const [open, setOpen] = useState<string | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const w = TOOLSET_WORDS[t.name] || { title: t.label, icon: '🧰', sub: t.description || '' }
  const changed = () => {
    cfg.reload()
    onChanged()
  }

  const toggle = (on: boolean) => {
    setBusy(true)
    setEnabled(on)
    void act(api('PUT', `${base}?${p}`, { enabled: on }, { profile: false }), on ? `${w.title} on for new chats` : `${w.title} off`).then(ok => {
      setBusy(false)
      if (!ok) setEnabled(!on)
      onChanged()
    })
  }
  /** Makes a service the one in use. Hermes saves the choice even when a Nous-managed service isn't in the account's
   *  subscription (`needs_nous_auth`): then it would not work, so the page says so instead of reporting success. */
  const pick = async (prov: ToolProvider, say: boolean): Promise<boolean> => {
    try {
      const r = await api<{ needs_nous_auth?: boolean }>('PUT', `${base}/provider?${p}`, { provider: prov.name }, { profile: false })
      if (r?.needs_nous_auth) {
        toast(`${prov.name} needs a Nous Portal sign-in with a subscription that includes it (Settings → Model providers → Nous).`, 'error', 8000)
        return false
      }
      if (say) toast(`${w.title}: ${prov.name}`)
      return true
    } catch (e) {
      toast(errText(e), 'error', 8000)
      return false
    }
  }
  const use = (prov: ToolProvider) => {
    setBusy(true)
    void pick(prov, true).then(() => {
      setBusy(false)
      changed()
    })
  }
  const save = (prov: ToolProvider) => {
    const env = Object.fromEntries(prov.env_vars.map(v => [v.key, (vals[v.key] || '').trim()]).filter(([, v]) => v))
    if (!Object.keys(env).length) return
    setBusy(true)
    haptic()
    void (async () => {
      const ok = await act(api('PUT', `${base}/env?${p}`, { env }, { profile: false }), '')
      // A key alone doesn't switch services: make the one just set up the one in use.
      const switched = ok && (prov.is_active || (await pick(prov, false)))
      if (switched) toast(`${prov.name} connected`)
      setVals({})
      setBusy(false)
      changed()
    })()
  }
  const disconnect = (prov: ToolProvider) =>
    void confirmDialog({ title: `Disconnect ${prov.name}?`, message: 'Its keys are deleted from this bot’s .env.', confirmLabel: 'Disconnect', danger: true }).then(async ok => {
      if (!ok) return
      setBusy(true)
      let all = true
      for (const v of prov.env_vars.filter(v => v.is_set)) {
        all = (await act(
          api('DELETE', `/api/env?${p}`, { key: v.key }, { profile: false }).catch(e => {
            if (!/not found/i.test(errText(e))) throw e // set somewhere Hermes reads but not in this .env
          }),
          ''
        )) && all
      }
      if (all) toast(`${prov.name} disconnected`)
      setBusy(false)
      changed()
    })
  const terminal = (key: string) => {
    void copyText(hermesCmd(`tools post-setup ${key}`, profile))
    toast('Command copied: run it in Termux inside Debian (~/bin/hermes-debian opens it), then come back here.', 'info', 8000)
  }

  return (
    <Sheet title={w.title} onClose={onClose}>
      <div className="sheet-scroll">
        <div className="dim small pad">{w.sub}</div>
        <Section footer="A change applies to new chats.">
          <ToggleRow title="On" sub="Hermes can use these tools" on={enabled} onChange={v => !busy && toggle(v)} />
        </Section>
        <Status loading={cfg.loading} error={cfg.error} empty={!cfg.loading && !cfg.error && !cfg.data?.providers.length} emptyText="Nothing to set up: it works as it is." />
        {(cfg.data?.providers.length || 0) > 0 && (
          <Section title="Service">
            {cfg.data!.providers.map(prov => {
              const keyed = prov.env_vars.length > 0
              const set = keyed && prov.env_vars.every(v => v.is_set || v.default != null)
              const expanded = open === prov.name
              return (
                <div key={prov.name}>
                  <Row
                    title={
                      <span className="key-line">
                        <span className={prov.is_active ? 'dot-set' : 'dot-unset'} />
                        <span>{prov.name}</span>
                      </span>
                    }
                    sub={[prov.is_active ? 'In use' : '', prov.tag || prov.badge || '', keyed ? (set ? 'Key saved' : 'Needs a key') : prov.post_setup ? 'Set up in Termux' : prov.requires_nous_auth ? 'Nous subscription' : 'No key needed']
                      .filter(Boolean)
                      .join(' · ')}
                    chevron
                    onClick={() => { setVals({}); setOpen(expanded ? null : prov.name) }}
                  />
                  {expanded && (
                    <div className="conn-provider">
                      {prov.env_vars.map(v => (
                        <label key={v.key} className="field">
                          <span>
                            {v.prompt || v.key}
                            {v.is_set ? ' (saved)' : ''}
                          </span>
                          <input
                            className="mono"
                            type={/url|host|id$/i.test(v.key) ? 'text' : 'password'}
                            autoComplete="off"
                            value={vals[v.key] || ''}
                            onChange={e => setVals(x => ({ ...x, [v.key]: e.target.value }))}
                            placeholder={v.is_set ? 'Paste to replace' : v.default || v.key}
                          />
                          {v.url && (
                            <a className="small" href={v.url} onClick={e => { e.preventDefault(); haptic(); openExternal(v.url!) }}>
                              Get a key ↗
                            </a>
                          )}
                        </label>
                      ))}
                      <div className="sheet-actions">
                        {prov.env_vars.some(v => v.is_set) && (
                          <button className="btn danger" disabled={busy} onClick={() => disconnect(prov)}>
                            Disconnect
                          </button>
                        )}
                        {prov.post_setup && (
                          <button className="btn" disabled={busy} onClick={() => terminal(prov.post_setup!)}>
                            Copy the Termux command
                          </button>
                        )}
                        {!prov.is_active && (!keyed || set) && (
                          <button className="btn" disabled={busy} onClick={() => use(prov)}>
                            Use this one
                          </button>
                        )}
                        {keyed && (
                          <button className="btn primary" disabled={busy || !prov.env_vars.some(v => vals[v.key]?.trim())} onClick={() => save(prov)}>
                            Save
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </Section>
        )}
      </div>
    </Sheet>
  )
}

// ── a key a skill reads ──────────────────────────────────────

function SkillKeySheet({ name, row, profile, onClose, onChanged }: { name: string; row: EnvRow; profile: string; onClose: () => void; onChanged: () => void }) {
  const p = qs({ profile })
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const run = (req: Promise<unknown>, done: string) => {
    setBusy(true)
    haptic()
    void act(req, done).then(ok => {
      setBusy(false)
      if (ok) {
        onChanged()
        onClose()
      }
    })
  }
  const remove = () =>
    void confirmDialog({ title: `Remove ${name}?`, message: 'The saved value is deleted from this bot’s .env.', confirmLabel: 'Remove', danger: true }).then(
      ok => ok && run(api('DELETE', `/api/env?${p}`, { key: name }, { profile: false }), `${name} removed`)
    )
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="sheet-scroll">
        {row.description && <div className="dim small">{row.description}</div>}
        {row.url && (
          <a className="small" href={row.url} onClick={e => { e.preventDefault(); haptic(); openExternal(row.url!) }}>
            Get a key ↗
          </a>
        )}
        <label className="field">
          <span>{row.is_set ? 'Replace with' : 'Key'}</span>
          <input className="mono" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste here" />
        </label>
      </div>
      <div className="sheet-actions">
        {row.is_set && (
          <button className="btn danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
        <button className="btn primary" disabled={busy || !value.trim()} onClick={() => run(api('PUT', `/api/env?${p}`, { key: name, value: value.trim() }, { profile: false }), `${name} saved`)}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
