import { describe, expect, it } from 'vitest'
import { IllegalTransitionError } from './machine'
import { createTaskWorkflow } from './presets'

describe('createTaskWorkflow', () => {
  it('refuses to start a task that has no assignee', () => {
    const machine = createTaskWorkflow()
    expect(() => machine.send({ type: 'start', at: 1 })).toThrow(IllegalTransitionError)
    expect(machine.state).toBe('queued')
  })

  it('walks start -> submit -> approve and can compensate a submit', () => {
    const machine = createTaskWorkflow({ assigneeId: 'dev-1', hours: 2 })
    expect(machine.send({ type: 'start', at: 10 }).state).toBe('in_progress')
    expect(machine.send({ type: 'submit', at: 20 }).state).toBe('review')
    expect(machine.compensate(21).state).toBe('in_progress')
    expect(machine.send({ type: 'submit', at: 22 }).state).toBe('review')
    expect(machine.send({ type: 'approve', at: 30 }).state).toBe('done')
  })

  it('blocks from review and returns to queued on unblock', () => {
    const machine = createTaskWorkflow({ assigneeId: 'dev-1', hours: 1 })
    machine.send({ type: 'start', at: 1 })
    machine.send({ type: 'submit', at: 2 })
    expect(machine.send({ type: 'block', at: 3, context: { blocked: true } }).state).toBe('blocked')
    expect(machine.send({ type: 'unblock', at: 4, context: { blocked: false } }).state).toBe('queued')
  })

  it('rejects submit when no hours have been logged', () => {
    const machine = createTaskWorkflow({ assigneeId: 'dev-1', hours: 0 })
    machine.send({ type: 'start', at: 1 })
    expect(() => machine.send({ type: 'submit', at: 2 })).toThrow(IllegalTransitionError)
  })
})
