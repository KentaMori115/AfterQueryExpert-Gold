import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchCombobox, type ComboboxOption } from './search-combobox'

const options: ComboboxOption[] = [
  { id: 'design', label: 'Design review', hint: 'High priority' },
  { id: 'deploy', label: 'Deploy staging', hint: 'Ops' },
  { id: 'docs', label: 'Docs update', hint: 'Writing' },
]

describe('SearchCombobox', () => {
  it('lets a user search, move with the keyboard, and choose an option', async () => {
    const onChange = vi.fn()
    const onSearch = vi.fn(async (query: string) => {
      const normalized = query.toLowerCase()
      return options.filter((option) => option.label.toLowerCase().includes(normalized))
    })
    const user = userEvent.setup()

    render(
      <SearchCombobox
        label="Assign task"
        onSearch={onSearch}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('combobox', { name: 'Assign task' })
    await user.type(input, 'de')
    await screen.findByRole('option', { name: /Deploy staging/ })

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith(options[1])
    expect(screen.getByRole('status')).toHaveTextContent('Selected Deploy staging')
    expect(input).toHaveValue('Deploy staging')
  })

  it('ignores slower searches that finish after a newer query', async () => {
    const pending: Array<{
      query: string
      resolve: (value: ComboboxOption[]) => void
    }> = []
    const onSearch = vi.fn((query: string) => {
      return new Promise<ComboboxOption[]>((resolve) => {
        pending.push({ query, resolve })
      })
    })
    const latest = (query: string) =>
      [...pending].reverse().find((item) => item.query === query)

    render(<SearchCombobox label="Find client" onSearch={onSearch} />)

    await waitFor(() => expect(latest('')).toBeTruthy())
    await act(async () => {
      latest('')?.resolve(options)
    })

    const user = userEvent.setup()
    await user.type(screen.getByRole('combobox', { name: 'Find client' }), 'do')

    await waitFor(() => {
      expect(latest('d')).toBeTruthy()
      expect(latest('do')).toBeTruthy()
    })

    await act(async () => {
      latest('do')?.resolve([options[2]])
    })
    await act(async () => {
      latest('d')?.resolve([options[0], options[1]])
    })

    expect(screen.getByRole('option', { name: /Docs update/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Design review/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 results')
  })
})
