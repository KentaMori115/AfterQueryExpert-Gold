export type Developer = {
  id: string
  weeklyHours: number
}

export type PlannedTask = {
  id: string
  hours: number
  priority: number
  dueWeek: number
}

export type Assignment = {
  taskId: string
  developerId: string
  week: number
  hours: number
}

export type PlanResult = {
  assignments: Assignment[]
  unassigned: { taskId: string; remaining: number }[]
  utilization: Record<string, number>
}

export function planCapacity(
  developers: Developer[],
  tasks: PlannedTask[],
  weeks: number
): PlanResult {
  if (weeks <= 0) throw new Error('weeks must be positive')
  const remaining = new Map(developers.map((dev) => [dev.id, Array.from({ length: weeks }, () => dev.weeklyHours)]))
  const assignments: Assignment[] = []
  const unassigned: { taskId: string; remaining: number }[] = []

  const ordered = [...tasks].sort((a, b) => a.priority - b.priority || a.dueWeek - b.dueWeek)

  for (const task of ordered) {
    let left = task.hours
    const lastWeek = Math.min(weeks - 1, Math.max(0, task.dueWeek))
    for (let week = 0; week <= lastWeek && left > 0; week += 1) {
      const ranked = [...developers].sort((a, b) => {
        const aLeft = remaining.get(a.id)![week]
        const bLeft = remaining.get(b.id)![week]
        return bLeft - aLeft || a.id.localeCompare(b.id)
      })
      for (const dev of ranked) {
        const bucket = remaining.get(dev.id)!
        if (bucket[week] <= 0) continue
        const take = Math.min(bucket[week], left)
        bucket[week] -= take
        left -= take
        assignments.push({ taskId: task.id, developerId: dev.id, week, hours: take })
        if (left === 0) break
      }
    }
    if (left > 0) {
      unassigned.push({ taskId: task.id, remaining: left })
    }
  }

  const utilization: Record<string, number> = {}
  for (const dev of developers) {
    const used = remaining.get(dev.id)!.reduce((sum, hours) => sum + (dev.weeklyHours - hours), 0)
    utilization[dev.id] = used / (dev.weeklyHours * weeks)
  }

  return { assignments, unassigned, utilization }
}
