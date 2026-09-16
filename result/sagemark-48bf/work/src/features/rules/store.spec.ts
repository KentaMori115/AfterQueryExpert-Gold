import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { RuleSnippetValidationError, useRuleSnippetStore } from './store'

describe('useRuleSnippetStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('creates a snippet and exposes it via all', () => {
    const store = useRuleSnippetStore()
    store.create({ title: 'Cover', scope: 'combat', body: 'half cover gives 2' })
    expect(store.all).toHaveLength(1)
  })

  it('rejects bad drafts with a typed error', () => {
    const store = useRuleSnippetStore()
    expect(() => store.create({ title: '', scope: 'combat', body: 'x' })).toThrow(
      RuleSnippetValidationError,
    )
  })

  it('togglePin moves the snippet to the top', () => {
    const store = useRuleSnippetStore()
    const a = store.create({ title: 'A', scope: 'combat', body: 'a' })
    const b = store.create({ title: 'B', scope: 'combat', body: 'b' })
    store.togglePin(b.id)
    expect(store.all.map((s) => s.id)).toEqual([b.id, a.id])
  })

  it('update changes the title and body', () => {
    const store = useRuleSnippetStore()
    const a = store.create({ title: 'A', scope: 'combat', body: 'a' })
    store.update(a.id, { title: 'A2', scope: 'magic', body: 'a2' })
    const refreshed = store.byId(a.id)!
    expect(refreshed.title).toBe('A2')
    expect(refreshed.scope).toBe('magic')
  })

  it('remove drops the snippet', () => {
    const store = useRuleSnippetStore()
    const a = store.create({ title: 'A', scope: 'combat', body: 'a' })
    store.remove(a.id)
    expect(store.byId(a.id)).toBeNull()
  })

  it('forScope filters down to one scope', () => {
    const store = useRuleSnippetStore()
    store.create({ title: 'A', scope: 'combat', body: 'a' })
    store.create({ title: 'B', scope: 'magic', body: 'b' })
    expect(store.forScope('combat')).toHaveLength(1)
    expect(store.forScope('magic')).toHaveLength(1)
  })

  it('persists across re-init', () => {
    const first = useRuleSnippetStore()
    first.create({ title: 'A', scope: 'combat', body: 'a' })
    setActivePinia(createPinia())
    const second = useRuleSnippetStore()
    expect(second.all).toHaveLength(1)
  })
})
