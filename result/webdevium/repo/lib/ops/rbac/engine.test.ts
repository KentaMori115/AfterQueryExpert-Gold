import { describe, expect, it } from 'vitest'
import { createAccessEngine } from './engine'
import { RoleCycleError } from './graph'

const roles = [
  {
    name: 'viewer',
    parents: [],
    grants: ['read:tasks:*'],
    denies: [],
  },
  {
    name: 'member',
    parents: ['viewer'],
    grants: ['write:tasks:own', 'read:invoices:own'],
    denies: [],
  },
  {
    name: 'pm',
    parents: ['member'],
    grants: ['write:tasks:*', 'assign:tasks:*'],
    denies: ['delete:clients:*'],
  },
  {
    name: 'admin',
    parents: ['pm'],
    grants: ['*: *:*'.replace(' ', '')],
    denies: [],
  },
]

describe('createAccessEngine', () => {
  const engine = createAccessEngine(roles)

  it('inherits read access from parent roles', () => {
    const decision = engine.decide(
      { id: 'u1', roles: ['member'] },
      'read',
      { type: 'tasks', id: 't1' }
    )
    expect(decision.allowed).toBe(true)
    expect(decision.matched).toBe('read:tasks:*')
  })

  it('only allows own-resource writes when the actor owns the record', () => {
    const own = engine.decide(
      { id: 'u1', roles: ['member'] },
      'write',
      { type: 'tasks', id: 't1', ownerId: 'u1' }
    )
    const other = engine.decide(
      { id: 'u1', roles: ['member'] },
      'write',
      { type: 'tasks', id: 't2', ownerId: 'u2' }
    )
    expect(own.allowed).toBe(true)
    expect(other.allowed).toBe(false)
  })

  it('lets an explicit deny beat a broader inherited grant', () => {
    const decision = engine.decide(
      { id: 'pm1', roles: ['pm'] },
      'delete',
      { type: 'clients', id: 'c1' }
    )
    expect(decision.allowed).toBe(false)
    expect(decision.via).toBe('deny')
  })

  it('rejects cyclic role graphs before making a decision', () => {
    const cyclic = createAccessEngine([
      { name: 'a', parents: ['b'], grants: [], denies: [] },
      { name: 'b', parents: ['a'], grants: [], denies: [] },
    ])
    expect(() => cyclic.decide({ id: 'x', roles: ['a'] }, 'read', { type: 'tasks' })).toThrow(
      RoleCycleError
    )
  })
})
