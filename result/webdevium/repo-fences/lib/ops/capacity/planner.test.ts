import { describe, expect, it } from 'vitest'
import { planCapacity } from './planner'

describe('planCapacity', () => {
  it('fills higher-priority work first and splits leftover hours across weeks', () => {
    const plan = planCapacity(
      [
        { id: 'ann', weeklyHours: 8 },
        { id: 'bea', weeklyHours: 8 },
      ],
      [
        { id: 'low', hours: 6, priority: 20, dueWeek: 1 },
        { id: 'high', hours: 12, priority: 1, dueWeek: 1 },
      ],
      2
    )

    const highHours = plan.assignments
      .filter((item) => item.taskId === 'high')
      .reduce((sum, item) => sum + item.hours, 0)
    expect(highHours).toBe(12)
    expect(plan.unassigned).toEqual([])
    expect(plan.assignments[0].taskId).toBe('high')
  })

  it('reports remaining hours when the team is over capacity', () => {
    const plan = planCapacity(
      [{ id: 'ann', weeklyHours: 4 }],
      [{ id: 'huge', hours: 20, priority: 1, dueWeek: 1 }],
      2
    )
    expect(plan.unassigned).toEqual([{ taskId: 'huge', remaining: 12 }])
    expect(plan.utilization.ann).toBe(1)
  })
})
