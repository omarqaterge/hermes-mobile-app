// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest'
import { actionMessage, formFields, loadUiState, safeHttpUrl, saveUiState } from './openui-msg'

describe('formFields', () => {
  test('form values, empty ones and $variables dropped', () => {
    expect(formFields({ contact: { name: { value: 'Omar', componentType: 'Input' }, email: { value: '' } }, $tab: 'a' })).toEqual([['name', 'Omar']])
  })
  test('lists, booleans and top-level fields', () => {
    expect(formFields({ size: { value: ['S', 'M'] }, agree: { value: true }, n: { value: 3 } })).toEqual([['size', 'S, M'], ['agree', 'yes'], ['n', '3']])
  })
  test('nothing usable', () => {
    expect(formFields(undefined)).toEqual([])
    expect(formFields({})).toEqual([])
  })
})

describe('actionMessage', () => {
  test('a plain button sends its words', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Pick A', formState: {} })).toBe('Pick A')
  })
  test('form values follow as a list', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Here are my details', formName: 'contact', formState: { contact: { name: { value: 'Omar' } } } }))
      .toBe('Here are my details\n\n- name: Omar')
  })
  test('action context is kept, in brackets', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'More', params: { context: { id: 7 } } })).toBe('More\n\n({"id":7})')
  })
})

describe('safeHttpUrl', () => {
  test('http(s) only', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('file:///sdcard/x')).toBeNull()
    expect(safeHttpUrl(42)).toBeNull()
  })
})

describe('saved card state', () => {
  beforeEach(() => localStorage.clear())
  test('round trip, and an empty state forgets the entry', () => {
    saveUiState('c1:h1', { contact: { name: { value: 'O' } } })
    expect(loadUiState('c1:h1')).toEqual({ contact: { name: { value: 'O' } } })
    saveUiState('c1:h1', {})
    expect(loadUiState('c1:h1')).toBeUndefined()
  })
  test('keeps the newest 150', () => {
    for (let i = 0; i < 160; i++) saveUiState(`k${i}`, { x: i }, 1000 + i)
    expect(loadUiState('k0')).toBeUndefined()
    expect(loadUiState('k159')).toEqual({ x: 159 })
    expect(Object.keys(JSON.parse(localStorage.getItem('hm.openui.v1') || '{}')).length).toBe(150)
  })
  test('a broken store reads as empty', () => {
    localStorage.setItem('hm.openui.v1', '{oops')
    expect(loadUiState('x')).toBeUndefined()
  })
})
