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
// Big optional bundles are built on their own (IIFE, with their own copies of what they import) and embedded as text
// the browser doesn't parse; the app runs them on first use (src/lazy.ts; import.meta.env.DEV uses import()).
// Mermaid is ~2.5 MB and only needed for diagrams; OpenUI is ~4 MB (renderer, its component library, React, CSS) and
// only needed for ```openui-lang cards.
function lazyBundle(id: string, entry: string): Plugin {
  return {
    name: `lazy-${id}`,
    apply: 'build',
    async transformIndexHtml(html) {
      const out = await build({
        configFile: false,
        logLevel: 'warn',
        plugins: [react()],
        // Library mode doesn't replace process.env.NODE_ENV; React reads it, and OpenUI also reads
        // process.env["NODE_ENV"] (no `process` in a WebView: it threw at load), hence the whole object too.
        define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
        build: {
          write: false,
          target: 'es2022',
          minify: true,
          lib: { entry: fileURLToPath(new URL(entry, import.meta.url)), formats: ['iife'], name: `HmLazy_${id.replace(/\W/g, '_')}` },
          rollupOptions: { output: { inlineDynamicImports: true } }
        }
      })
      const outputs = (Array.isArray(out) ? out : [out]) as { output: { type: string; fileName: string; code?: string }[] }[]
      const files = outputs.flatMap(o => o.output)
      const strayCss = files.filter(f => f.type === 'asset' && f.fileName.endsWith('.css'))
      if (strayCss.length) throw new Error(`${id}: the lazy bundle emitted CSS (${strayCss.map(f => f.fileName)}); import it with ?inline`)
      const code = files.filter(c => c.type === 'chunk').map(c => c.code).join('\n')
      const safe = code.replace(/<\/script/gi, '<\\/script')
      // The LAST </body>: an earlier lazy bundle's code (Mermaid's) contains the text "</body>" too.
      const at = html.lastIndexOf('</body>')
      if (at < 0) throw new Error(`${id}: index.html has no </body>`)
      return `${html.slice(0, at)}<script type="text/hm-lazy" id="${id}">${safe}</script>\n${html.slice(at)}`
    }
  }
}

// The Hermes build the vendored client (and so this app) was written against, e.g. 0.21.5+4582.gb8a8be1.
// Update it together with .hermes-commit; Settings warns when the phone's Hermes is a different build.
const hermesTested = readFileSync(fileURLToPath(new URL('./vendor/hermes-shared/.hermes-version', import.meta.url)), 'utf8').trim()

export default defineConfig({
  base: './',
  define: { __HERMES_TESTED__: JSON.stringify(hermesTested) },
  plugins: [katexWoff2Only, react(), viteSingleFile(), lazyBundle('hm-mermaid', './mermaid-entry.js'), lazyBundle('hm-openui', './src/openui-entry.tsx')],
  resolve: {
    alias: { '@hermes/shared': fileURLToPath(new URL('./vendor/hermes-shared', import.meta.url)) }
  },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 }
})
