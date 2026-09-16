import { describe, expect, it } from 'vitest'
import { compareClocks, tick } from './clock'
import { applyOp, localInsert, transform, type DocumentState } from './document'

describe('vector clocks and text transform', () => {
  it('classifies concurrent edits that do not happen-before each other', () => {
    const a = tick({}, 'ann')
    const b = tick({}, 'bea')
    expect(compareClocks(a, b)).toBe('concurrent')
    expect(compareClocks(a, tick(a, 'ann'))).toBe('before')
  })

  it('transforms two inserts at the same index using actor order', () => {
    const left = transform(
      { kind: 'insert', at: 1, text: 'X', actor: 'bea', clock: { bea: 1 } },
      { kind: 'insert', at: 1, text: 'A', actor: 'ann', clock: { ann: 1 } }
    )
    expect(left.at).toBe(2)
  })

  it('applies a transformed remote insert so both characters survive', () => {
    let state: DocumentState = { text: 'ab', clock: {} }
    const local = localInsert(state, 'ann', 1, 'A')
    state = local.state
    const remote = transform(
      { kind: 'insert', at: 1, text: 'B', actor: 'bea', clock: { bea: 1 } },
      local.op
    )
    state = applyOp(state, remote)
    expect(state.text).toBe('aABb')
  })
})
