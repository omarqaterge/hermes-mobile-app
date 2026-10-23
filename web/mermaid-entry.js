// Built separately (vite.config.ts → lazyBundle) into an inert <script type="text/hm-lazy"> block of index.html;
// Markdown.tsx evaluates it on the first diagram, so the phone doesn't parse ~2.5 MB of Mermaid on every start.
import mermaid from 'mermaid'
window.__hmMermaid = mermaid
