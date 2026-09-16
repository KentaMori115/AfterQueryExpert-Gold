'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type SelectableTableRow = {
  id: string
  label: string
  description?: string
}

type SelectableTableProps = {
  rows: SelectableTableRow[]
  /** Async filter. Responses for an older query are ignored. */
  onFilter?: (query: string) => Promise<SelectableTableRow[]>
  selectedIds?: string[]
  defaultSelectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  caption?: string
}

function toggleId(current: Set<string>, id: string) {
  const next = new Set(current)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export function SelectableTable({
  rows,
  onFilter,
  selectedIds,
  defaultSelectedIds,
  onSelectionChange,
  caption = 'Selectable rows',
}: SelectableTableProps) {
  const instanceId = useId()
  const searchId = `${instanceId}-search`
  const statusId = `${instanceId}-status`
  const requestIdRef = useRef(0)

  const [query, setQuery] = useState('')
  const [asyncRows, setAsyncRows] = useState<SelectableTableRow[] | null>(null)
  const [isFiltering, setIsFiltering] = useState(false)
  const [internalSelected, setInternalSelected] = useState<Set<string>>(
    () => new Set(defaultSelectedIds ?? [])
  )

  const selected = selectedIds ? new Set(selectedIds) : internalSelected

  const visibleRows = useMemo(() => {
    if (onFilter) {
      return asyncRows ?? rows
    }

    const normalized = query.trim().toLowerCase()
    if (!normalized) return rows

    return rows.filter((row) => {
      return (
        row.label.toLowerCase().includes(normalized) ||
        (row.description?.toLowerCase().includes(normalized) ?? false)
      )
    })
  }, [onFilter, asyncRows, rows, query])

  useEffect(() => {
    if (!onFilter) {
      setAsyncRows(null)
      setIsFiltering(false)
      return
    }

    const requestId = ++requestIdRef.current
    setIsFiltering(true)
    let cancelled = false

    onFilter(query)
      .then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return
        setAsyncRows(result)
        setIsFiltering(false)
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return
        setIsFiltering(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, onFilter])

  const commitSelection = useCallback(
    (next: Set<string>) => {
      if (!selectedIds) {
        setInternalSelected(next)
      }
      onSelectionChange?.(Array.from(next))
    },
    [selectedIds, onSelectionChange]
  )

  const visibleSelectedCount = visibleRows.filter((row) => selected.has(row.id)).length
  const allVisibleSelected =
    visibleRows.length > 0 && visibleSelectedCount === visibleRows.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected

  const handleToggleRow = (id: string) => {
    commitSelection(toggleId(selected, id))
  }

  const handleToggleAllVisible = () => {
    const next = new Set(selected)
    if (allVisibleSelected) {
      for (const row of visibleRows) {
        next.delete(row.id)
      }
    } else {
      for (const row of visibleRows) {
        next.add(row.id)
      }
    }
    commitSelection(next)
  }

  const statusText = isFiltering
    ? 'Updating results'
    : `${visibleRows.length} shown, ${selected.size} selected`

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">
          Filter rows
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name"
          aria-controls={`${instanceId}-table`}
          aria-describedby={statusId}
        />
      </div>

      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {statusText}
      </p>

      <div className="overflow-x-auto rounded-md border">
        <table id={`${instanceId}-table`} className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(node) => {
                    if (node) node.indeterminate = someVisibleSelected
                  }}
                  onChange={handleToggleAllVisible}
                  disabled={visibleRows.length === 0}
                  aria-label="Select all visible rows"
                />
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  No rows match the current filter.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const checkboxId = `${instanceId}-row-${row.id}`
                return (
                  <tr
                    key={row.id}
                    className={cn(selected.has(row.id) && 'bg-accent/60')}
                  >
                    <td className="px-3 py-2">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => handleToggleRow(row.id)}
                        aria-label={`Select ${row.label}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label htmlFor={checkboxId} className="font-medium">
                        {row.label}
                      </label>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.description ?? '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
