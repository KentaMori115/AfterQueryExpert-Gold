import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PaginatedList, type PaginatedItem } from './paginated-list'

const items: PaginatedItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: `inv-${index + 1}`,
  label: index % 2 === 0 ? `Invoice ${index + 1}` : `Credit ${index + 1}`,
  meta: `$${(index + 1) * 10}`,
}))

describe('PaginatedList', () => {
  it('pages through results and disables navigation at the edges', async () => {
    const user = userEvent.setup()
    render(<PaginatedList items={items} pageSize={3} />)

    expect(screen.getByRole('status')).toHaveTextContent('Showing 1–3 of 8')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('status')).toHaveTextContent('Showing 4–6 of 8')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('status')).toHaveTextContent('Showing 7–8 of 8')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('resets to the first page when the filter changes', async () => {
    const user = userEvent.setup()
    render(<PaginatedList items={items} pageSize={3} />)

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter invoices'), 'Credit')

    expect(screen.getByRole('status')).toHaveTextContent('Showing 1–3 of 4')
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.queryByText('Invoice 1')).not.toBeInTheDocument()
  })
})
