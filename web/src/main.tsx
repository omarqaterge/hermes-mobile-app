import './secure-bridge' // first: takes the native bridge key before anything else can use the bridge
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './share'
import './notif-answer'
import './styles.css'
import './glass.css' // the glass material, after the base styles it covers
import './motion.css' // the motion system's springs and timings
import './panel.css' // the side panel: a glass sheet over the chat, or the docked column
import './menu.css' // the menus' shared look (ui.tsx Menu*), and the picker rows
import './subagents-core.css' // sub-agents: what shows before their lazy bundle has run
import './settings.css' // the Settings main page: one-line rows and the attention cards
import './pages.css' // the inner pages: centred widths, 44 px targets, empty states, the bot tag, Light contrast
import { applyLook } from './motion'
import { applyTheme, savedTheme } from './theme'
import { bootMark } from './boot'
import { openFirstRun } from './components/Setup'
import { startStats } from './stats'
import { startAppLog } from './applog'
import { startRemoteBlock } from './phone-data-taint'

bootMark('script')
startAppLog()
startRemoteBlock() // tell the shell whether the chat on screen has read phone data (it starts every page load blocked)

applyTheme(savedTheme())
applyLook() // glass and motion level: the person's choice, else what the phone can carry (decided once, here)
openFirstRun() // a fresh install starts in the setup flow, not in a chat waiting for a Hermes that isn't installed

createRoot(document.getElementById('root')!).render(<App />)
startStats()
;(window as unknown as { __hmRan?: boolean }).__hmRan = true // index.html shows an "update WebView" note without it
