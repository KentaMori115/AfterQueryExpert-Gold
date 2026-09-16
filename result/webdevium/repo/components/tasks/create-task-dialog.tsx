import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-react'

type ClientOption = {
  id: string
  name: string
}

type DeveloperOption = {
  id: string
  email: string
}

type CreatedTask = {
  id: string
  client_id: string
}

interface CreateTaskDialogProps {
  isOpen: boolean
  onClose: () => void
  clients: ClientOption[]
  developers: DeveloperOption[]
  defaultClientId?: string | null
  onCreated?: (task: CreatedTask) => void
}

export function CreateTaskDialog({
  isOpen,
  onClose,
  clients,
  developers,
  defaultClientId = null,
  onCreated,
}: CreateTaskDialogProps) {
  const [clientId, setClientId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [status, setStatus] = useState<'queued' | 'in_progress' | 'done'>('queued')
  const [estHours, setEstHours] = useState('')
  const [assignedDevId, setAssignedDevId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setClientId(defaultClientId ?? (clients[0]?.id ?? ''))
    setTitle('')
    setDescription('')
    setPriority('medium')
    setStatus('queued')
    setEstHours('')
    setAssignedDevId(null)
    setError(null)
  }, [clients, defaultClientId, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!clientId) {
      setError('Select a client before creating a task')
      return
    }

    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters')
      return
    }

    const payload: Record<string, any> = {
      client_id: clientId,
      title: title.trim(),
      priority,
      status,
    }

    // Only include description if it's not empty
    if (description.trim()) {
      payload.description = description.trim()
    }

    // Only include est_hours if it's provided and valid
    if (estHours && estHours.trim() !== '') {
      const parsedEst = Number(estHours)
      if (!Number.isFinite(parsedEst) || parsedEst < 0) {
        setError('Estimated hours must be zero or positive')
        return
      }
      payload.est_hours = Math.floor(parsedEst) // Ensure it's an integer
    }

    // Only include assigned_dev_id if it's provided and not empty
    if (assignedDevId && assignedDevId.trim() !== '') {
      payload.assigned_dev_id = assignedDevId
    }

    try {
      setLoading(true)
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies in the request
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        // Handle Zod validation errors (they come as an object with field errors)
        let errorMessage = 'Failed to create task'
        if (data.error) {
          if (typeof data.error === 'string') {
            errorMessage = data.error
          } else if (typeof data.error === 'object') {
            // Handle Zod error format
            const fieldErrors = Object.values(data.error).flat() as string[]
            if (fieldErrors.length > 0) {
              errorMessage = fieldErrors[0]
            } else {
              errorMessage = 'Validation error: Please check all fields'
            }
          }
        }
        throw new Error(errorMessage)
      }

      if (data.task) {
        onCreated?.(data.task)
      }
      onClose()
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">New Task</CardTitle>
              <CardDescription>Create a task for any client</CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={loading}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="task-client">Client</Label>
                <select
                  id="task-client"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={loading}
                  required
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-priority">Priority</Label>
                <select
                  id="task-priority"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high')}
                  disabled={loading}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-title">Task Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Build marketing landing page"
                maxLength={200}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-description">Description</Label>
              <textarea
                id="task-description"
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Share context, goals, and any supporting links…"
                maxLength={2000}
                disabled={loading}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="task-status">Status</Label>
                <select
                  id="task-status"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as 'queued' | 'in_progress' | 'done')
                  }
                  disabled={loading}
                >
                  <option value="queued">Queued</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-est-hours">Est. Hours</Label>
                <Input
                  id="task-est-hours"
                  type="number"
                  min={0}
                  value={estHours}
                  onChange={(event) => setEstHours(event.target.value)}
                  placeholder="e.g. 6"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-dev">Assign Developer</Label>
                <select
                  id="task-dev"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={assignedDevId ?? ''}
                  onChange={(event) => setAssignedDevId(event.target.value || null)}
                  disabled={loading}
                >
                  <option value="">Unassigned</option>
                  {developers.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Task'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}


