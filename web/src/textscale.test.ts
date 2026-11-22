// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { chooseTextScale, clampTextScale, initialTextScale, phoneTextScale, savedTextChoice, TEXT_SIZES } from './textscale'

const w = window as unknown as { HermesAndroid?: unknown }
const phone = (v: unknown) => (w.HermesAndroid = { phoneTextScale: () => v })

afterEach(() => {
  delete w.HermesAndroid
  localStorage.clear()
})

describe('clampTextScale', () => {
  it('keeps a font scale inside 90 to 135 %', () => {
    expect(clampTextScale(1)).toBe(1)
    expect(clampTextScale(1.15)).toBe(1.15)
    expect(clampTextScale(1.3)).toBe(1.3)
    expect(clampTextScale(0.85)).toBe(0.9)
    expect(clampTextScale(2)).toBe(1.35)
    expect(clampTextScale(1.149999)).toBe(1.15)
  })
  it('reads anything that is not a positive number as normal', () => {
    for (const v of [0, -1, NaN, Infinity, undefined, null, 'big', {}]) expect(clampTextScale(v)).toBe(1)
    expect(clampTextScale('1.3')).toBe(1.3)
  })
  it('offers the five sizes, smallest first, inside the range', () => {
    expect([...TEXT_SIZES]).toEqual([0.9, 1, 1.1, 1.2, 1.35])
    for (const s of TEXT_SIZES) expect(clampTextScale(s)).toBe(s)
  })
})

describe('the phone and the choice', () => {
  it('follows the phone while nothing is chosen, clamped', () => {
    phone(1.3)
    expect(savedTextChoice()).toBeNull()
    expect(initialTextScale()).toBe(1.3)
    phone(2)
    expect(initialTextScale()).toBe(1.35)
  })
  it('is normal without a shell, with an older shell, or when the bridge throws', () => {
    expect(phoneTextScale()).toBe(1)
    w.HermesAndroid = {}
    expect(phoneTextScale()).toBe(1)
    w.HermesAndroid = { phoneTextScale: () => { throw new Error('no') } }
    expect(phoneTextScale()).toBe(1)
    phone(0) // the shell's answer to a call without the key
    expect(phoneTextScale()).toBe(1)
  })
  it('a chosen size wins over the phone and is read as before (any positive number)', () => {
    phone(1.3)
    localStorage.setItem('hm.textScale', '1.2')
    expect(initialTextScale()).toBe(1.2)
    localStorage.setItem('hm.textScale', '1')
    expect(initialTextScale()).toBe(1)
    localStorage.setItem('hm.textScale', 'abc')
    expect(initialTextScale()).toBe(1.3)
    localStorage.setItem('hm.textScale', '')
    expect(savedTextChoice()).toBeNull()
  })
  it('picking a size stores it; Phone default removes it and gives the phone’s scale', () => {
    phone(1.15)
    expect(chooseTextScale(1.1)).toBe(1.1)
    expect(localStorage.getItem('hm.textScale')).toBe('1.1')
    expect(chooseTextScale(null)).toBe(1.15)
    expect(localStorage.getItem('hm.textScale')).toBeNull()
  })
})
