import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NotificationCenter, type AppNotification } from './notification-center'

const notifications: AppNotification[] = [
  { id: '1', title: 'Task assigned', body: 'Checkout bug was assigned to you.', read: false },
  { id: '2', title: 'Invoice paid', body: 'April invoice is paid.', read: true },
  { id: '3', title: 'Comment', body: 'A client left a comment.', read: false },
]

describe('NotificationCenter', () => {
  it('marks a single notification as read and updates the unread count', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NotificationCenter notifications={notifications} onChange={onChange} />)

    expect(screen.getByText('2 unread')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 unread notifications.')

    await user.click(screen.getByRole('button', { name: 'Mark Task assigned as read' }))

    expect(onChange).toHaveBeenCalledWith([
      { ...notifications[0], read: true },
      notifications[1],
      notifications[2],
    ])
  })

  it('filters to unread items and can mark all as read', async () => {
    const user = userEvent.setup()
    render(<NotificationCenter notifications={notifications} />)

    await user.click(screen.getByRole('button', { name: 'Show unread only' }))
    expect(screen.queryByText('Invoice paid')).not.toBeInTheDocument()
    expect(screen.getByText('Task assigned')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(screen.getByRole('status')).toHaveTextContent('You are caught up.')
    expect(screen.getByText('No unread notifications.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })
})
