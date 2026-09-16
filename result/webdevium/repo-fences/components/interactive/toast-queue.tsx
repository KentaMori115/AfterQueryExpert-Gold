'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'

export type Toast = {
  id: string
  title: string
  description?: string
  timeoutMs?: number
}

type ToastContextValue = {
  toasts: Toast[]
  publish: (toast: Omit<Toast, 'id'> & { id?: string }) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastCount = 0

export function ToastProvider({
  children,
  maxVisible = 3,
}: {
  children: ReactNode
  maxVisible?: number
}) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const publish = useCallback(
    (toast: Omit<Toast, 'id'> & { id?: string }) => {
      const id = toast.id ?? `toast-${++toastCount}`
      setToasts((current) => {
        const next = [...current, { ...toast, id }]
        return next.slice(-maxVisible)
      })
      const timeoutMs = toast.timeoutMs ?? 4000
      if (timeoutMs > 0) {
        const timer = setTimeout(() => dismiss(id), timeoutMs)
        timers.current.set(id, timer)
      }
      return id
    },
    [dismiss, maxVisible]
  )

  useEffect(() => {
    const timersMap = timers.current
    return () => {
      for (const timer of timersMap.values()) {
        clearTimeout(timer)
      }
      timersMap.clear()
    }
  }, [])

  const value = useMemo(
    () => ({ toasts, publish, dismiss }),
    [toasts, publish, dismiss]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ul
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <li
            key={toast.id}
            role="status"
            className="rounded-md border bg-background p-3 shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description ? (
                  <p className="text-sm text-muted-foreground">{toast.description}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss ${toast.title}`}
              >
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </ToastContext.Provider>
  )
}

export function useToasts() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToasts must be used within ToastProvider')
  }
  return context
}
