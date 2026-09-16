import { beforeEach, describe, expect, it } from 'vitest'

import { LocalStorageStore, MemoryStore, getStore, setStore } from './storage'

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('starts empty', () => {
    expect(store.keys()).toEqual([])
    expect(store.size()).toBe(0)
  })

  it('round-trips set + get', () => {
    store.set('a', '1')
    store.set('b', '2')
    expect(store.get('a')).toBe('1')
    expect(store.get('b')).toBe('2')
  })

  it('returns null for missing keys', () => {
    expect(store.get('missing')).toBe(null)
  })

  it('removes a single key', () => {
    store.set('a', '1')
    store.remove('a')
    expect(store.get('a')).toBe(null)
  })

  it('clears everything', () => {
    store.set('a', '1')
    store.set('b', '2')
    store.clear()
    expect(store.keys()).toEqual([])
  })
})

describe('LocalStorageStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('prefixes keys so it doesnt collide with other apps', () => {
    const store = new LocalStorageStore('sagemark:')
    store.set('camp', 'one')
    expect(window.localStorage.getItem('sagemark:camp')).toBe('one')
    expect(window.localStorage.getItem('camp')).toBe(null)
  })

  it('only returns its own keys', () => {
    window.localStorage.setItem('other:key', 'x')
    const store = new LocalStorageStore('sagemark:')
    store.set('a', '1')
    store.set('b', '2')
    expect(store.keys().sort()).toEqual(['a', 'b'])
  })

  it('clears only its own keys', () => {
    window.localStorage.setItem('other:key', 'x')
    const store = new LocalStorageStore('sagemark:')
    store.set('a', '1')
    store.clear()
    expect(store.keys()).toEqual([])
    expect(window.localStorage.getItem('other:key')).toBe('x')
  })
})

describe('getStore / setStore', () => {
  it('returns a singleton across calls', () => {
    setStore(null)
    const a = getStore()
    const b = getStore()
    expect(a).toBe(b)
  })

  it('respects a manually injected store', () => {
    const fake = new MemoryStore()
    setStore(fake)
    expect(getStore()).toBe(fake)
    setStore(null)
  })
})
