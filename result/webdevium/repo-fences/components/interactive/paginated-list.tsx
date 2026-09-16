'use client'

import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { filterByQuery, paginate } from '@/lib/paginate'

export type PaginatedItem = {
  id: string
  label: string
  meta?: string
}

type PaginatedListProps = {
  items: PaginatedItem[]
  pageSize?: number
  label?: string
}

export function PaginatedList({
  items,
  pageSize = 5,
  label = 'Invoices',
}: PaginatedListProps) {
  const searchId = useId()
  const statusId = useId()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => filterByQuery(items, query), [items, query])
  const view = useMemo(
    () => paginate(filtered, page, pageSize),
    [filtered, page, pageSize]
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">
          Filter {label.toLowerCase()}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search"
        />
      </div>

      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {view.total === 0
          ? `No ${label.toLowerCase()} match the current filter.`
          : `Showing ${view.start}–${view.end} of ${view.total}`}
      </p>

      <ul aria-label={label} aria-describedby={statusId} className="divide-y rounded-md border">
        {view.items.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing to show on this page.
          </li>
        ) : (
          view.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-medium">{item.label}</span>
              {item.meta ? (
                <span className="text-sm text-muted-foreground">{item.meta}</span>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={view.page <= 1}
        >
          Previous page
        </Button>
        <p className="text-sm text-muted-foreground">
          Page {view.page} of {view.totalPages}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => Math.min(view.totalPages, current + 1))}
          disabled={view.page >= view.totalPages}
        >
          Next page
        </Button>
      </div>
    </div>
  )
}
