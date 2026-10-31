import { describe, expect, it } from 'vitest'
import { previewKind } from './filekind'

const doc = (type: string, lang?: string) => (lang ? { kind: 'doc', type, lang } : { kind: 'doc', type })

describe('previewKind', () => {
  it('tables, json, diagrams, pages, markdown, plain text', () => {
    expect(previewKind('a.csv')).toEqual(doc('csv'))
    expect(previewKind('a.tsv')).toEqual(doc('csv'))
    expect(previewKind('a.json')).toEqual(doc('json'))
    expect(previewKind('a.mmd')).toEqual(doc('mermaid'))
    expect(previewKind('a.mermaid')).toEqual(doc('mermaid'))
    expect(previewKind('a.html')).toEqual(doc('html'))
    expect(previewKind('a.htm')).toEqual(doc('html'))
    expect(previewKind('a.md')).toEqual(doc('markdown'))
    expect(previewKind('a.markdown')).toEqual(doc('markdown'))
    expect(previewKind('a.txt')).toEqual(doc('text'))
    expect(previewKind('a.log')).toEqual(doc('text'))
  })
  it('code with the highlight.js language', () => {
    const langs: Record<string, string> = {
      py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', sh: 'bash', java: 'java', kt: 'kotlin',
      c: 'c', h: 'c', cpp: 'cpp', rs: 'rust', go: 'go', rb: 'ruby', css: 'css', xml: 'xml', sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'toml'
    }
    for (const [ext, lang] of Object.entries(langs)) expect(previewKind(`f.${ext}`)).toEqual(doc('code', lang))
  })
  it('images and media', () => {
    for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']) expect(previewKind(`f.${e}`)).toEqual({ kind: 'image' })
    for (const e of ['mp3', 'm4a', 'ogg', 'wav', 'flac', 'mp4', 'webm', 'mov', 'mkv']) expect(previewKind(`f.${e}`)).toEqual({ kind: 'media' })
  })
  it('no preview for pdf, office and others', () => {
    for (const e of ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'apk']) expect(previewKind(`f.${e}`)).toEqual({ kind: 'none' })
    expect(previewKind('f.pdf', 'application/pdf')).toEqual({ kind: 'none' })
  })
  it('upper-case extensions, no extension, MIME fallback', () => {
    expect(previewKind('A.CSV')).toEqual(doc('csv'))
    expect(previewKind('SONG.MP3')).toEqual({ kind: 'media' })
    expect(previewKind('Makefile')).toEqual({ kind: 'none' })
    expect(previewKind('Makefile', 'text/plain')).toEqual(doc('text'))
    expect(previewKind('x.unknown', 'text/plain')).toEqual(doc('text'))
    expect(previewKind('x.unknown', 'image/png')).toEqual({ kind: 'image' })
    expect(previewKind('.gitignore')).toEqual(doc('text'))
  })
})
