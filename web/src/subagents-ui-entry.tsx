// The lazy bundle `hm-subagents` (vite.config.ts, loaded by components/SubAgentsCore.tsx): the sub-agent rows, the sheet and
// their styles. Everything else it uses comes from the running app.
import css from './subagents.css?inline'
import { NestedRows, SubAgentSheet, SubGroupRows } from './components/SubAgents'
import type { SubAgentUi } from './components/SubAgentsCore'

const ui: SubAgentUi = { SubGroupRows, NestedRows, SubAgentSheet, css }
;(window as unknown as { __hmSubAgents?: SubAgentUi }).__hmSubAgents = ui
export default ui
