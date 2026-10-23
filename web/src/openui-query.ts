// The tool client behind a card's Query(): OpenUI's toolProvider calls callTool({ name, arguments }) like an MCP
// client and reads structuredContent (isError makes it fail). Battery and cost bound: the same call within 15 min gets
// the saved answer (also after reopening the chat), and one client makes at most 30 network calls, so a model-written
// refresh interval can't poll forever.

export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>
export type McpResult = { structuredContent?: unknown; isError?: boolean; content?: { type: 'text'; text: string }[] }
/** Where saved answers live (the card's saved UI state in the app); passed in so this module stays pure. */
export type ToolStore = { load(k: string): unknown; save(k: string, v: Record<string, unknown>, now: number): void }

export const QUERY_FRESH_MS = 15 * 60_000
export const QUERY_MAX_CALLS = 30
export const QUERY_TOO_OFTEN = 'This card asked for data too often. Ask Hermes to refresh it.'

const err = (text: string): McpResult => ({ isError: true, content: [{ type: 'text', text }] })

export function makeToolClient(call: ToolCall, cacheKey: string, store: ToolStore, now: () => number = Date.now) {
  let calls = 0
  return {
    async callTool({ name, arguments: args = {} }: { name: string; arguments?: Record<string, unknown> }): Promise<McpResult> {
      const key = `q:${cacheKey}|${name}|${JSON.stringify(args)}`
      const hit = store.load(key) as { at?: unknown; v?: unknown } | null | undefined
      if (hit && typeof hit === 'object' && typeof hit.at === 'number' && now() - hit.at < QUERY_FRESH_MS) return { structuredContent: hit.v }
      if (++calls > QUERY_MAX_CALLS) return err(QUERY_TOO_OFTEN)
      try {
        const v = await call(name, args)
        const t = now()
        store.save(key, { at: t, v }, t)
        return { structuredContent: v }
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e))
      }
    },
  }
}
