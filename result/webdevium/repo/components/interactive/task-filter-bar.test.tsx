import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TaskFilterBar } from './task-filter-bar'
import { EMPTY_TASK_FILTERS, type FilterableTask, type TaskFilters } from '@/lib/task-filters'

const tasks: FilterableTask[] = [
  { id: '1', title: 'Homepage refresh', status: 'queued', priority: 'high' },
  { id: '2', title: 'Checkout bug', status: 'in_progress', priority: 'high' },
  { id: '3', title: 'Docs pass', status: 'done', priority: 'low' },
  { id: '4', title: 'Billing copy', status: 'queued', priority: 'medium' },
]

function Harness({ initial = EMPTY_TASK_FILTERS }: { initial?: TaskFilters }) {
  const [filters, setFilters] = useState(initial)
  return <TaskFilterBar tasks={tasks} filters={filters} onChange={setFilters} />
}

describe('TaskFilterBar', () => {
  it('filters by search and status together', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Search tasks'), 'home')
    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 tasks shown')
    expect(screen.getByText('Homepage refresh')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Done'))
    expect(screen.getByText('No tasks match the current filters.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 of 4 tasks shown')
  })

  it('clears every active filter and restores the full list', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        initial={{ query: 'billing', statuses: ['queued'], priorities: ['medium'] }}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 tasks shown')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByLabelText('Search tasks')).toHaveValue('')
    expect(screen.getByLabelText('Queued')).not.toBeChecked()
    expect(screen.getByLabelText('Medium')).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('4 of 4 tasks shown')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
  })
})
