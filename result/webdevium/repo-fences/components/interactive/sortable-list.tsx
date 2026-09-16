'use client'

import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

export type SortableItem = {
  id: string
  label: string
}

type SortableListProps = {
  items: SortableItem[]
  onReorder?: (items: SortableItem[]) => void
}

function moveItem(items: SortableItem[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function SortableList({ items, onReorder }: SortableListProps) {
  const labelId = useId()
  const statusId = useId()
  const [internalItems, setInternalItems] = useState(items)
  const [announcement, setAnnouncement] = useState('List order unchanged')

  const ordered = onReorder ? items : internalItems

  const commit = (next: SortableItem[], message: string) => {
    if (!onReorder) {
      setInternalItems(next)
    }
    onReorder?.(next)
    setAnnouncement(message)
  }

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction
    const next = moveItem(ordered, index, target)
    if (next === ordered) return
    const item = ordered[index]
    commit(
      next,
      `${item.label} moved to position ${target + 1} of ${ordered.length}`
    )
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (!event.altKey) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleMove(index, -1)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      handleMove(index, 1)
    }
  }

  const countLabel = useMemo(
    () => `${ordered.length} items`,
    [ordered.length]
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id={labelId} className="text-sm font-medium">
          Queue order
        </h2>
        <p className="text-sm text-muted-foreground">{countLabel}</p>
      </div>
      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {announcement}
      </p>
      <ol aria-labelledby={labelId} aria-describedby={statusId} className="space-y-2">
        {ordered.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            tabIndex={0}
            onKeyDown={(event) => handleKeyDown(index, event)}
            aria-label={`${item.label}, position ${index + 1} of ${ordered.length}. Alt plus arrow keys to reorder.`}
          >
            <span className="text-sm font-medium">
              {index + 1}. {item.label}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleMove(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${item.label} up`}
              >
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleMove(index, 1)}
                disabled={index === ordered.length - 1}
                aria-label={`Move ${item.label} down`}
              >
                Down
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
