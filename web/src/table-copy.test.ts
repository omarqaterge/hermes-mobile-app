import { describe, expect, test } from 'vitest'
import { tableMarkdown } from './text'

describe('tableMarkdown (Copy table)', () => {
  test('header, separator and rows', () => {
    expect(tableMarkdown([['a', 'b'], ['1', '2']])).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })
  test('a bar in a cell is escaped', () => {
    expect(tableMarkdown([['x'], ['a|b']])).toBe('| x |\n| --- |\n| a\\|b |')
  })
  test('a backslash before a bar stays text, not an escape that eats the bar', () => {
    expect(tableMarkdown([['x', 'y'], ['C:\\', 'z']])).toBe('| x | y |\n| --- | --- |\n| C:\\\\ | z |')
    expect(tableMarkdown([['x'], ['a\\|b']])).toBe('| x |\n| --- |\n| a\\\\\\|b |')
  })
  test('line breaks become spaces', () => {
    expect(tableMarkdown([['x'], ['one\n  two']])).toBe('| x |\n| --- |\n| one two |')
  })
})
