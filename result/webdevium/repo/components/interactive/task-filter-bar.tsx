'use client'

import { useId, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  EMPTY_TASK_FILTERS,
  filterTasks,
  toggleFilterValue,
  type FilterableTask,
  type TaskFilters,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/task-filters'

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'queued', label: 'Queued' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

type TaskFilterBarProps = {
  tasks: FilterableTask[]
  filters: TaskFilters
  onChange: (filters: TaskFilters) => void
}

export function TaskFilterBar({ tasks, filters, onChange }: TaskFilterBarProps) {
  const searchId = useId()
  const statusLegendId = useId()
  const priorityLegendId = useId()
  const resultId = useId()

  const visible = useMemo(() => filterTasks(tasks, filters), [tasks, filters])
  const hasActiveFilters =
    filters.query.trim() !== '' ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">
          Search tasks
        </label>
        <Input
          id={searchId}
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Search by title"
        />
      </div>

      <fieldset className="space-y-2">
        <legend id={statusLegendId} className="text-sm font-medium">
          Status
        </legend>
        <div className="flex flex-wrap gap-3" role="group" aria-labelledby={statusLegendId}>
          {STATUS_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.statuses.includes(option.value)}
                onChange={() =>
                  onChange({
                    ...filters,
                    statuses: toggleFilterValue(filters.statuses, option.value),
                  })
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend id={priorityLegendId} className="text-sm font-medium">
          Priority
        </legend>
        <div className="flex flex-wrap gap-3" role="group" aria-labelledby={priorityLegendId}>
          {PRIORITY_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.priorities.includes(option.value)}
                onChange={() =>
                  onChange({
                    ...filters,
                    priorities: toggleFilterValue(filters.priorities, option.value),
                  })
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <p id={resultId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {visible.length} of {tasks.length} tasks shown
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_TASK_FILTERS)}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </Button>
      </div>

      <ul aria-label="Filtered tasks" aria-describedby={resultId} className="space-y-2">
        {visible.length === 0 ? (
          <li className="rounded-md border px-3 py-4 text-sm text-muted-foreground">
            No tasks match the current filters.
          </li>
        ) : (
          visible.map((task) => (
            <li key={task.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm font-medium">{task.title}</span>
              <span className="text-sm text-muted-foreground">
                {task.status.replace('_', ' ')} · {task.priority}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
