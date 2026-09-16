export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'queued' | 'in_progress' | 'done'

export type FilterableTask = {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
}

export type TaskFilters = {
  query: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  query: '',
  statuses: [],
  priorities: [],
}

export function filterTasks(tasks: FilterableTask[], filters: TaskFilters) {
  const query = filters.query.trim().toLowerCase()

  return tasks.filter((task) => {
    const matchesQuery = !query || task.title.toLowerCase().includes(query)
    const matchesStatus =
      filters.statuses.length === 0 || filters.statuses.includes(task.status)
    const matchesPriority =
      filters.priorities.length === 0 || filters.priorities.includes(task.priority)
    return matchesQuery && matchesStatus && matchesPriority
  })
}

export function toggleFilterValue<T extends string>(current: T[], value: T) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
}
