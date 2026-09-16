import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToasts } from './toast-queue'

function Harness({ timeoutMs = 4000 }: { timeoutMs?: number }) {
  const { publish } = useToasts()
  return (
    <div>
      <button type="button" onClick={() => publish({ title: 'Task queued', timeoutMs })}>
        Notify
      </button>
      <button
        type="button"
        onClick={() =>
          publish({ title: 'Sticky note', description: 'Needs review', timeoutMs: 0 })
        }
      >
        Sticky
      </button>
    </div>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('publishes, announces, and dismisses a toast', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Notify' }))

    expect(screen.getByText('Task queued')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Notifications' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss Task queued' }))
    expect(screen.queryByText('Task queued')).not.toBeInTheDocument()
  })

  it('auto-dismisses timed toasts and keeps sticky toasts', async () => {
    const user = userEvent.setup()

    render(
      <ToastProvider>
        <Harness timeoutMs={80} />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.getByText('Task queued')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Task queued')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Sticky' }))
    expect(screen.getByText('Sticky note')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(screen.getByText('Sticky note')).toBeInTheDocument()
  })

  it('caps the visible queue at the maxVisible count', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider maxVisible={2}>
        <Harness />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Notify' }))
    await user.click(screen.getByRole('button', { name: 'Sticky' }))
    await user.click(screen.getByRole('button', { name: 'Notify' }))

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    expect(screen.getByText('Sticky note')).toBeInTheDocument()
  })
})
