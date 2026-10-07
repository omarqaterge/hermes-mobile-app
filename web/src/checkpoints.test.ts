// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { canRestoreFile, folderLabel, hunksOnly, restoreLines, restoreSummary, type DiffFile } from './checkpoints'

const f = (file: string, status: DiffFile['status']): DiffFile => ({ file, status, added: 1, removed: 1, diff: '' })

describe('folderLabel', () => {
  test('home becomes ~', () => {
    expect(folderLabel('/root/hm-cp-e2e')).toBe('~/hm-cp-e2e')
    expect(folderLabel('/root/.hermes/scripts')).toBe('~/.hermes/scripts')
  })
  test('long paths keep the last two folders', () => {
    expect(folderLabel('/root/.hermes/cache/scratch')).toBe('~/…/cache/scratch')
    expect(folderLabel('/sdcard/Download/a/b')).toBe('/…/a/b')
  })
  test('short paths outside home stay', () => {
    expect(folderLabel('/sdcard/Download')).toBe('/sdcard/Download')
    expect(folderLabel('/rootx/a')).toBe('/rootx/a')
  })
})

describe('restoreLines', () => {
  const files = [f('a.py', 'modified'), f('new.txt', 'added'), f('gone.md', 'deleted')]
  test('says what happens to each file', () => {
    expect(restoreLines(files)).toEqual(['a.py: back to how it was', 'new.txt: deleted (made after this snapshot)', 'gone.md: brought back'])
  })
  test('one file only', () => {
    expect(restoreLines(files, 'a.py')).toEqual(['a.py: back to how it was'])
  })
})

describe('restoreSummary', () => {
  test('one file', () => {
    expect(restoreSummary({ ok: true, restored_files: ['notes.txt'] })).toEqual({ text: 'Restored notes.txt', warn: false })
  })
  test('several, some kept', () => {
    const r = restoreSummary({ ok: true, restored_files: ['a', 'b'], skipped_user_edits: ['c'] })
    expect(r.text).toBe('Restored 2 files · kept c (changed by you or too big)')
    expect(r.warn).toBe(true)
  })
  test('single-file restore without a list', () => {
    expect(restoreSummary({ ok: true }, 'x.py').text).toBe('Restored x.py')
  })
  test('nothing restored', () => {
    expect(restoreSummary({ ok: true, restored_files: [], skipped_user_edits: ['a', 'b'] }).text).toBe(
      'Nothing to restore · kept 2 files (changed by you or too big)'
    )
  })
})

describe('canRestoreFile', () => {
  const files = [f('a.py', 'modified'), f('new.txt', 'added'), f('gone.md', 'deleted')]
  test('changed or deleted files can go back on their own, new ones cannot', () => {
    expect(canRestoreFile(files, 'a.py')).toBe(true)
    expect(canRestoreFile(files, 'gone.md')).toBe(true)
    expect(canRestoreFile(files, 'new.txt')).toBe(false)
    expect(canRestoreFile(files, 'unchanged.py')).toBe(false)
  })
})

describe('hunksOnly', () => {
  test('drops the git header lines', () => {
    expect(hunksOnly('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe('@@ -1 +1 @@\n-a\n+b')
  })
  test('a diff without hunks (binary) stays', () => {
    expect(hunksOnly('diff --git a/x b/x\nBinary files differ')).toBe('diff --git a/x b/x\nBinary files differ')
  })
})
