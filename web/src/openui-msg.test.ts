// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest'
import { actionMessage, dayText, formFields, loadUiState, rangeText, safeHttpUrl, saveUiState, textDay } from './openui-msg'

describe('formFields', () => {
  test('form values, empty ones and $variables dropped', () => {
    expect(formFields({ contact: { name: { value: 'Sam', componentType: 'Input' }, email: { value: '' } }, $tab: 'a' })).toEqual([['name', 'Sam']])
  })
  test('lists, booleans and top-level fields', () => {
    expect(formFields({ size: { value: ['S', 'M'] }, agree: { value: true }, n: { value: 3 } })).toEqual([['size', 'S, M'], ['agree', 'yes'], ['n', '3']])
  })
  test('nothing usable', () => {
    expect(formFields(undefined)).toEqual([])
    expect(formFields({})).toEqual([])
  })
})

describe('dates in a card', () => {
  test('a day is kept as local text and read back', () => {
    const d = new Date(2026, 9, 5) // 5 Oct 2026, local midnight
    expect(dayText(d)).toBe('2026-10-05')
    expect(textDay('2026-10-05')?.getTime()).toBe(d.getTime())
    expect(textDay(d)).toBe(d)
  })
  test('an older save with a timestamp, and rubbish', () => {
    const d = new Date(2026, 9, 5)
    expect(textDay(d.toISOString())?.getTime()).toBe(d.getTime()) // the ISO text of a Date saved before the fix
    expect(textDay('soon')).toBeUndefined()
    expect(textDay(undefined)).toBeUndefined()
    expect(textDay(new Date('x'))).toBeUndefined()
  })
  test('a range, and how a day or a range reads in the message', () => {
    expect(rangeText({ from: new Date(2026, 9, 5) })).toEqual({ from: '2026-10-05' })
    expect(rangeText({ from: new Date(2026, 9, 5), to: new Date(2026, 9, 9) })).toEqual({ from: '2026-10-05', to: '2026-10-09' })
    expect(formFields({ day: { value: '2026-10-05' }, stay: { value: { from: '2026-10-05', to: '2026-10-09' } } })).toEqual([['day', '2026-10-05'], ['stay', '2026-10-05 to 2026-10-09']])
    expect(formFields({ day: { value: new Date(2026, 9, 5) } })).toEqual([['day', '2026-10-05']])
  })
})

describe('actionMessage', () => {
  test('a plain button sends its words', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Pick A', formState: {} })).toBe('Pick A')
  })
  test('form values follow as a list', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Here are my details', formName: 'contact', formState: { contact: { name: { value: 'Sam' } } } }))
      .toBe('Here are my details\n\n- name: Sam')
  })
  test('a button outside the form sends only its words (OpenUI passes every form\'s values to every button)', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Pick A', formState: { contact: { name: { value: 'Sam' } } } })).toBe('Pick A')
  })
  test('only the pressed form\'s values', () => {
    expect(actionMessage({ type: 'continue_conversation', humanFriendlyMessage: 'Go', formName: 'b', formState: { a: { x: { value: '1' } }, b: { y: { value: '2' } } } })).toBe('Go\n\n- y: 2')
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
