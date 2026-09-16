'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { X, Trash2, Save, Clock } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { LogHoursDialog } from './log-hours-dialog'

type Task = {
  id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'queued' | 'in_progress' | 'done'
  est_hours: number | null
  hours_spent: number | null
  assigned_dev_id: string | null
  assigned_dev?: {
    id?: string
    email: string
  }
  created_at: string
  completed_at: string | null
}

interface EditTaskDialogProps {
  isOpen: boolean
  onClose: () => void
  task: Task | null
  clientId: string
  userRole: 'admin' | 'pm' | 'dev' | 'client' | null
  onTaskUpdated?: () => void
}

export function EditTaskDialog({ 
  isOpen, 
  onClose, 
  task, 
  clientId,
  userRole,
  onTaskUpdated 
}: EditTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [status, setStatus] = useState<'queued' | 'in_progress' | 'done'>('queued')
  const [estHours, setEstHours] = useState<string>('')
  const [assignedDevId, setAssignedDevId] = useState<string | null>(null)
  const [availableDevs, setAvailableDevs] = useState<Array<{ id: string; email: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showLogHours, setShowLogHours] = useState(false)
  const [showLogHoursButton, setShowLogHoursButton] = useState(false)
  const supabase = getBrowserSupabase()

  const isPMOrAdmin = userRole === 'admin' || userRole === 'pm'

  // Load task data when dialog opens
  useEffect(() => {
    if (task && isOpen) {
      setTitle(task.title || '')
      setDescription(task.description || '')
      setPriority(task.priority || 'medium')
      setStatus(task.status || 'queued')
      setEstHours(task.est_hours?.toString() || '')
      setAssignedDevId(task.assigned_dev_id || null)
      setError(null)
      setSuccess(false)
    }
  }, [task, isOpen])

  // Load available developers for PM/Admin
  useEffect(() => {
    if (isPMOrAdmin && isOpen) {
      async function loadDevs() {
        try {
          // Get ALL users with role 'dev' from users table
          const { data: devs, error } = await supabase
            .from('users')
            .select('id, email')
            .eq('role', 'dev')
            .order('email')

          if (error) {
            console.error('Error loading developers:', error)
            return
          }

          if (devs) {
            setAvailableDevs(devs)
          }
        } catch (e) {
          console.error('Failed to load developers:', e)
        }
      }
      loadDevs()
    }
  }, [isPMOrAdmin, isOpen, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!task) return

    setLoading(true)
    setError(null)

    try {
      const updateData: any = {
        title,
        description: description || null,
        priority,
      }

      // Only PM/Admin can update these fields
      if (isPMOrAdmin) {
        updateData.status = status
        if (estHours) {
          updateData.est_hours = parseInt(estHours, 10)
        } else {
          updateData.est_hours = null
        }
        updateData.assigned_dev_id = assignedDevId || null
      }

      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update task')
      }

      // If status changed to 'done', show log hours dialog
      if (updateData.status === 'done' && task.status !== 'done' && isPMOrAdmin) {
        setSuccess(false)
        onClose()
        setShowLogHours(true)
        if (onTaskUpdated) {
          onTaskUpdated()
        }
        return
      }

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        onClose()
        if (onTaskUpdated) {
          onTaskUpdated()
        }
      }, 800)
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!task) return
    
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) {
      return
    }

    setDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete task')
      }

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        onClose()
        if (onTaskUpdated) {
          onTaskUpdated()
        }
      }, 800)
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      console.error(err)
    } finally {
      setDeleting(false)
    }
  }

  if (!isOpen || !task) return null

  const getPriorityColor = (p: string) => {
    switch (p?.toLowerCase()) {
      case 'high': return 'destructive'
      case 'medium': return 'warning'
      case 'low': return 'secondary'
      default: return 'default'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl">Edit Task</CardTitle>
              <CardDescription className="mt-1">
                Update task details and information
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={loading || deleting}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Task updated successfully!
              </div>
            )}

            {/* Task Info Section */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Task Title *</Label>
                <Input
                  id="title"
                  type="text"
                  placeholder="Task title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={loading || deleting}
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  className="w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Task description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading || deleting}
                  maxLength={2000}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <select
                    id="priority"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                    disabled={loading || deleting}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                {isPMOrAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <select
                      id="status"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'queued' | 'in_progress' | 'done')}
                      disabled={loading || deleting}
                    >
                      <option value="queued">Queued</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                )}
              </div>

              {/* PM/Admin Only Fields */}
              {isPMOrAdmin && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="estHours">Estimated Hours</Label>
                      <Input
                        id="estHours"
                        type="number"
                        min="0"
                        placeholder="e.g. 4"
                        value={estHours}
                        onChange={(e) => setEstHours(e.target.value)}
                        disabled={loading || deleting}
                      />
                      <p className="text-xs text-muted-foreground">
                        Internal estimate (not visible to client)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="assignedDev">Assign Developer</Label>
                      <select
                        id="assignedDev"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                        value={assignedDevId || ''}
                        onChange={(e) => setAssignedDevId(e.target.value || null)}
                        disabled={loading || deleting}
                      >
                        <option value="">Unassigned</option>
                        {availableDevs.map((dev) => (
                          <option key={dev.id} value={dev.id}>
                            {dev.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Task Stats (Read-only) */}
                  <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-md">
                    <div>
                      <p className="text-xs text-muted-foreground">Hours Spent</p>
                      <p className="text-sm font-medium">{task.hours_spent || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p className="text-sm font-medium">
                        {task.created_at ? new Date(task.created_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Log Hours Button for Done Tasks */}
                  {status === 'done' && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-blue-900">Log Hours</p>
                          <p className="text-xs text-blue-700">
                            {task.hours_spent ? `Currently logged: ${task.hours_spent} hours` : 'No hours logged yet'}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowLogHours(true)}
                          disabled={loading || deleting}
                          className="bg-white"
                        >
                          <Clock className="h-4 w-4 mr-2" />
                          {task.hours_spent ? 'Add Hours' : 'Log Hours'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              {isPMOrAdmin && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={loading || deleting}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              )}
              <div className="flex-1" />
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading || deleting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || deleting}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {loading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Log Hours Dialog - shown when marking task as done */}
      {showLogHours && task && (
        <LogHoursDialog
          isOpen={showLogHours}
          onClose={() => {
            setShowLogHours(false)
            if (onTaskUpdated) {
              onTaskUpdated()
            }
          }}
          task={{
            id: task.id,
            title: task.title,
            client_id: clientId,
          }}
          onHoursLogged={() => {
            setShowLogHours(false)
            if (onTaskUpdated) {
              onTaskUpdated()
            }
          }}
        />
      )}
    </div>
  )
}

