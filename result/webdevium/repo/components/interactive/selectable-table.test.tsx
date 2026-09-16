import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectableTable, type SelectableTableRow } from './selectable-table'

const rows: SelectableTableRow[] = [
  { id: 'alpha', label: 'Alpha site', description: 'Marketing homepage' },
  { id: 'beta', label: 'Beta app', description: 'Client portal' },
  { id: 'gamma', label: 'Gamma shop', description: 'Checkout work' },
]

describe('SelectableTable', () => {
  it('keeps selected rows after the table is filtered', async () => {
    const user = userEvent.setup()
    render(<SelectableTable rows={rows} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha site' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Gamma shop' }))
    await user.type(screen.getByLabelText('Filter rows'), 'shop')

    expect(screen.queryByText('Alpha site')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Gamma shop' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('1 shown, 2 selected')

    await user.clear(screen.getByLabelText('Filter rows'))

    expect(screen.getByRole('checkbox', { name: 'Select Alpha site' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Gamma shop' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Beta app' })).not.toBeChecked()
  })

  it('selects only visible rows without clearing hidden selections', async () => {
    const user = userEvent.setup()
    render(<SelectableTable rows={rows} defaultSelectedIds={['alpha']} />)

    await user.type(screen.getByLabelText('Filter rows'), 'app')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible rows' }))

    expect(screen.getByRole('checkbox', { name: 'Select Beta app' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('1 shown, 2 selected')

    await user.clear(screen.getByLabelText('Filter rows'))

    expect(screen.getByRole('checkbox', { name: 'Select Alpha site' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Beta app' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Gamma shop' })).not.toBeChecked()
  })

  it('ignores stale async filter results that arrive out of order', async () => {
    const pending: Array<{
      query: string
      resolve: (value: SelectableTableRow[]) => void
    }> = []
    const onFilter = vi.fn((query: string) => {
      return new Promise<SelectableTableRow[]>((resolve) => {
        pending.push({ query, resolve })
      })
    })

    const latest = (query: string) =>
      [...pending].reverse().find((item) => item.query === query)

    render(<SelectableTable rows={rows} onFilter={onFilter} />)

    await waitFor(() => expect(latest('')).toBeTruthy())
    await act(async () => {
      latest('')?.resolve(rows)
    })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Filter rows'), 'be')

    await waitFor(() => {
      expect(latest('b')).toBeTruthy()
      expect(latest('be')).toBeTruthy()
    })

    await act(async () => {
      latest('be')?.resolve([rows[1]])
    })
    await act(async () => {
      latest('b')?.resolve([rows[1], rows[2]])
    })

    expect(screen.getByText('Beta app')).toBeInTheDocument()
    expect(screen.queryByText('Gamma shop')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 shown')
  })
})
