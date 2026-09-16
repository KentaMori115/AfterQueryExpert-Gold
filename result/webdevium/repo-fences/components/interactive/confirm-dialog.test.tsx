import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

function Harness({
  onConfirm = () => {},
  onCancel = () => {},
}: {
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Delete task
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this task?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
        onCancel={() => {
          onCancel()
          setOpen(false)
        }}
      />
    </div>
  )
}

describe('ConfirmDialog', () => {
  it('moves focus into the dialog and restores it when closed', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Delete task' })
    trigger.focus()
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Delete this task?' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps tab focus inside the dialog and confirms from the keyboard', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Delete task' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
