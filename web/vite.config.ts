import { build, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

// KaTeX's CSS lists every font as woff2, woff and ttf; everything gets inlined, so the two fallbacks were
// 1.1 MB of base64 the WebView (Chromium, woff2) never uses.
const katexWoff2Only: Plugin = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/katex(\.min)?\.css$/.test(id)) return null
    return code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '')
  }
}

// One self-contained index.html: the Android shell loads it from app assets
// (file://), where separate ES-module chunks would be blocked by CORS.
// Mermaid is ~half the app's JavaScript but only needed for diagrams. It is built on its own (IIFE) and embedded
// as text that the browser doesn't parse; Markdown.tsx runs it on first use (import.meta.env.DEV uses import()).
const lazyMermaid: Plugin = {
  name: 'lazy-mermaid',
  apply: 'build',
  async transformIndexHtml(html) {
    const out = await build({
      configFile: false,
      logLevel: 'warn',
      build: {
        write: false,
        target: 'es2022',
        minify: true,
        lib: { entry: fileURLToPath(new URL('./mermaid-entry.js', import.meta.url)), formats: ['iife'], name: 'HmMermaidBundle' },
        rollupOptions: { output: { inlineDynamicImports: true } }
      }
    })
    const outputs = (Array.isArray(out) ? out : [out]) as { output: { type: string; code?: string }[] }[]
    const code = outputs.flatMap(o => o.output).filter(c => c.type === 'chunk').map(c => c.code).join('\n')
    const safe = code.replace(/<\/script/gi, '<\\/script')
    return html.replace('</body>', () => `<script type="text/hm-lazy" id="hm-mermaid">${safe}</script>\n</body>`)
  }
}

// The Hermes build the vendored client (and so this app) was written against, e.g. 0.21.5+4582.gb8a8be1.
// Update it together with .hermes-commit; Settings warns when the phone's Hermes is a different build.
const hermesTested = readFileSync(fileURLToPath(new URL('./vendor/hermes-shared/.hermes-version', import.meta.url)), 'utf8').trim()

export default defineConfig({
  base: './',
  define: { __HERMES_TESTED__: JSON.stringify(hermesTested) },
  plugins: [katexWoff2Only, react(), viteSingleFile(), lazyMermaid],
  resolve: {
    alias: { '@hermes/shared': fileURLToPath(new URL('./vendor/hermes-shared', import.meta.url)) }
  },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 }
})
