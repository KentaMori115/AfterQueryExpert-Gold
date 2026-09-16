import { describe, expect, it } from 'vitest'
import { createDependencyGraph, GraphCycleError } from './dag'

describe('createDependencyGraph', () => {
  it('invalidates a key and every descendant', () => {
    const graph = createDependencyGraph()
    graph.depend('client-usage', 'usage-events')
    graph.depend('invoice', 'client-usage')
    graph.depend('dashboard', 'invoice')
    graph.depend('dashboard', 'client-usage')

    expect(graph.invalidate('usage-events').sort()).toEqual(
      ['client-usage', 'dashboard', 'invoice', 'usage-events'].sort()
    )
  })

  it('rebuilds dirty nodes parents-first in a stable order', () => {
    const graph = createDependencyGraph()
    graph.depend('b', 'a')
    graph.depend('c', 'a')
    graph.depend('d', 'b')
    graph.depend('d', 'c')

    expect(graph.rebuildOrder(['a'])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects a dependency that would introduce a cycle', () => {
    const graph = createDependencyGraph()
    graph.depend('b', 'a')
    expect(() => graph.depend('a', 'b')).toThrow(GraphCycleError)
    expect(graph.invalidate('a')).toEqual(['a', 'b'])
  })
})
