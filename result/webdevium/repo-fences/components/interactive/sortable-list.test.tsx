import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SortableList, type SortableItem } from './sortable-list'

const items: SortableItem[] = [
  { id: 'one', label: 'Kickoff' },
  { id: 'two', label: 'Design' },
  { id: 'three', label: 'Launch' },
]

describe('SortableList', () => {
  it('moves an item down and announces the new position', async () => {
    const onReorder = vi.fn()
    const user = userEvent.setup()
    render(<SortableList items={items} onReorder={onReorder} />)

    await user.click(screen.getByRole('button', { name: 'Move Kickoff down' }))

    expect(onReorder).toHaveBeenCalledWith([
      { id: 'two', label: 'Design' },
      { id: 'one', label: 'Kickoff' },
      { id: 'three', label: 'Launch' },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Kickoff moved to position 2 of 3'
    )
  })

  it('reorders with Alt+Arrow keys from the focused item', async () => {
    const onReorder = vi.fn()
    const user = userEvent.setup()
    render(<SortableList items={items} onReorder={onReorder} />)

    screen.getByRole('listitem', { name: /Launch/ }).focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')

    expect(onReorder).toHaveBeenCalledWith([
      { id: 'one', label: 'Kickoff' },
      { id: 'three', label: 'Launch' },
      { id: 'two', label: 'Design' },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Launch moved to position 2 of 3'
    )
  })
})
