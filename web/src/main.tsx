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

bootMark('script')

applyTheme(savedTheme())

createRoot(document.getElementById('root')!).render(<App />)
