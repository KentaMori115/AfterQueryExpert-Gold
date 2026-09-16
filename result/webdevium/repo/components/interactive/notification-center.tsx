'use client'

import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export type AppNotification = {
  id: string
  title: string
  body: string
  read: boolean
}

type NotificationCenterProps = {
  notifications: AppNotification[]
  onChange?: (notifications: AppNotification[]) => void
}

export function NotificationCenter({
  notifications,
  onChange,
}: NotificationCenterProps) {
  const headingId = useId()
  const statusId = useId()
  const [internal, setInternal] = useState(notifications)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const items = onChange ? notifications : internal

  const commit = (next: AppNotification[]) => {
    if (!onChange) {
      setInternal(next)
    }
    onChange?.(next)
  }

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items]
  )

  const visible = unreadOnly ? items.filter((item) => !item.read) : items

  const markRead = (id: string) => {
    commit(items.map((item) => (item.id === id ? { ...item, read: true } : item)))
  }

  const markAllRead = () => {
    commit(items.map((item) => ({ ...item, read: true })))
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-medium">
          Notifications
        </h2>
        <Badge variant={unreadCount > 0 ? 'default' : 'secondary'}>
          {unreadCount} unread
        </Badge>
      </div>

      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {unreadCount === 0
          ? 'You are caught up.'
          : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={unreadOnly ? 'default' : 'outline'}
          size="sm"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((current) => !current)}
        >
          {unreadOnly ? 'Show all' : 'Show unread only'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={markAllRead}
          disabled={unreadCount === 0}
        >
          Mark all as read
        </Button>
      </div>

      <ul aria-labelledby={headingId} aria-describedby={statusId} className="space-y-2">
        {visible.length === 0 ? (
          <li className="rounded-md border px-3 py-4 text-sm text-muted-foreground">
            {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
          </li>
        ) : (
          visible.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {item.title}
                  {!item.read ? (
                    <span className="ml-2 text-xs text-muted-foreground">(unread)</span>
                  ) : (
                    <span className="ml-2 text-xs text-muted-foreground">(read)</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </div>
              {!item.read ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => markRead(item.id)}
                  aria-label={`Mark ${item.title} as read`}
                >
                  Mark read
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
