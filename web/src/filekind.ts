import type { DocType } from './canvas'

/** How the Files screen shows a file: as a canvas-style document, an image, a media player, or not at all. */
export type PreviewKind = { kind: 'doc'; type: DocType; lang?: string } | { kind: 'image' } | { kind: 'media' } | { kind: 'none' }

// Code extensions and the highlight.js language each one uses.
const CODE: Record<string, string> = {
  py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', sh: 'bash', zsh: 'bash', bash: 'bash',
  java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', rs: 'rust', go: 'go', rb: 'ruby', css: 'css', xml: 'xml', sql: 'sql',
  yaml: 'yaml', yml: 'yaml', toml: 'toml'
}
const PLAIN = new Set(['txt', 'ini', 'cfg', 'conf', 'log', 'env', 'gitignore'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const MEDIA = new Set(['mp3', 'm4a', 'ogg', 'wav', 'flac', 'mp4', 'webm', 'mov', 'mkv'])

/** What to show for a file, from its name (first) and its MIME type (when the extension says nothing). */
export function previewKind(name: string, mime?: string | null): PreviewKind {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (IMAGE.has(ext)) return { kind: 'image' }
  if (MEDIA.has(ext)) return { kind: 'media' }
  if (ext === 'md' || ext === 'markdown') return { kind: 'doc', type: 'markdown' }
  if (ext === 'csv' || ext === 'tsv') return { kind: 'doc', type: 'csv' }
  if (ext === 'json') return { kind: 'doc', type: 'json' }
  if (ext === 'mmd' || ext === 'mermaid') return { kind: 'doc', type: 'mermaid' }
  if (ext === 'html' || ext === 'htm') return { kind: 'doc', type: 'html' }
  if (CODE[ext]) return { kind: 'doc', type: 'code', lang: CODE[ext] }
  if (PLAIN.has(ext)) return { kind: 'doc', type: 'text' }
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return { kind: 'image' }
  if (m.startsWith('text/')) return { kind: 'doc', type: 'text' }
  return { kind: 'none' }
}
