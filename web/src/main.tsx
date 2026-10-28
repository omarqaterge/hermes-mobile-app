import './secure-bridge' // first: takes the native bridge key before anything else can use the bridge
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './share'
import './notif-answer'
import './styles.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import { applyTheme, savedTheme } from './theme'
import { bootMark } from './boot'
import { openFirstRun } from './components/Setup'

bootMark('script')

applyTheme(savedTheme())
openFirstRun() // a fresh install starts in the setup flow, not in a chat waiting for a Hermes that isn't installed

createRoot(document.getElementById('root')!).render(<App />)
