'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, MoreHorizontal, Paperclip, Calendar, User } from 'lucide-react'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { SubmitTaskDialog } from '@/components/tasks/submit-task-dialog'
import { EditTaskDialog } from '@/components/tasks/edit-task-dialog'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/contexts/user-context'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Task = {
  id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'queued' | 'in_progress' | 'done'
  attachments: any[]
  created_at: string
  completed_at: string | null
  assigned_dev_id: string | null
  est_hours: number | null
  hours_spent: number | null
  position?: number
  assigned_dev?: {
    id?: string
    email: string
  }
}

interface TaskCardProps {
  task: any
  canReorder?: boolean
  onEdit?: (task: any) => void
}

function TaskCard({ task, canReorder = false, onEdit }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: false, // Always draggable
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  }

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'destructive'
      case 'medium': return 'warning'
      case 'low': return 'secondary'
      default: return 'default'
    }
  }

  const getPriorityLabel = (priority: string) => {
    if (!priority) return 'Medium'
    return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
  }

  // Track click vs drag using refs
  const clickStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragging = useRef(false)

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open edit if clicking the menu button
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    
    // If we were dragging, don't open edit
    if (wasDragging.current) {
      wasDragging.current = false
      return
    }
    
    // Check if mouse moved during click
    if (clickStartPos.current) {
      const deltaX = Math.abs(e.clientX - clickStartPos.current.x)
      const deltaY = Math.abs(e.clientY - clickStartPos.current.y)
      
      // If moved more than 8px (same as drag activation), it was a drag
      if (deltaX > 8 || deltaY > 8) {
        clickStartPos.current = null
        return
      }
    }
    
    if (onEdit) {
      onEdit(task)
    }
    clickStartPos.current = null
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (onEdit) {
      onEdit(task)
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only track if not clicking a button
    if (!(e.target as HTMLElement).closest('button')) {
      clickStartPos.current = { x: e.clientX, y: e.clientY }
      wasDragging.current = false
    }
  }

  const handleMouseMove = () => {
    // If mouse moves, mark as dragging
    if (clickStartPos.current) {
      wasDragging.current = true
    }
  }

  const cardContent = (
    <Card 
      className="mb-3 cursor-pointer hover:shadow-md transition-shadow"
      onClick={handleCardClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-medium text-sm">{task.title}</h4>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6"
            onClick={handleMenuClick}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </div>
        
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
          {task.description}
        </p>

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <Badge variant={getPriorityColor(task.priority) as any} className="text-xs">
              {getPriorityLabel(task.priority)}
            </Badge>
            {task.attachments > 0 && (
              <div className="flex items-center text-xs text-muted-foreground">
                <Paperclip className="h-3 w-3 mr-1" />
                {task.attachments}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center text-xs text-muted-foreground">
          <Calendar className="h-3 w-3 mr-1" />
          {task.created_at ? new Date(task.created_at).toLocaleDateString('en-US', { dateStyle: 'short' }) : 'N/A'}
        </div>

        {task.assigned_dev && (
          <div className="mt-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Assigned to: <span className="font-medium">{task.assigned_dev.email || 'Unknown'}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {cardContent}
    </div>
  )
}

interface KanbanColumnProps {
  title: string
  tasks: any[]
  canReorder?: boolean
  count: number
  status: 'queued' | 'in_progress' | 'done'
  onEditTask?: (task: any) => void
}

function KanbanColumn({ title, tasks, canReorder = false, count, status, onEditTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  })

  const taskIds = tasks.map(task => task.id)
  
  return (
    <div 
      ref={setNodeRef}
      className={`flex-1 min-w-0 border-2 rounded-lg p-4 transition-colors ${
        isOver 
          ? 'border-primary bg-primary/5' 
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      
      <div className="space-y-3 min-h-[200px]">
        {taskIds.length > 0 ? (
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <TaskCard 
                key={task.id} 
                task={task} 
                canReorder={canReorder}
                onEdit={onEditTask}
              />
            ))}
          </SortableContext>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No tasks</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TasksPage() {
  const router = useRouter()
  const pathname = usePathname()
  // Use cached user data from context instead of fetching
  const { clientId, userRole, loading: userLoading, membership, isAdmin } = useUser()
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [submitTaskOpen, setSubmitTaskOpen] = useState(false)
  const [editTaskOpen, setEditTaskOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const supabase = getBrowserSupabase()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Only activate drag if pointer moves 8px
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Fetch tasks (user data comes from context)
  useEffect(() => {
    // Reset loading state when route changes
    setLoading(true)
    
    // Wait for user data to load
    if (userLoading) return

    let cancelled = false
    
    async function loadTasks() {
      // Use cached user data from context
      if (!membership?.client_id) {
        // Redirect to onboarding if no client (use client-side navigation)
        router.push('/onboarding')
        return
      }

      setLoading(true)
      try {
        const clientId = membership.client_id

        // Fetch tasks with assigned dev info (limit to prevent large loads)
        const { data: tasksData, error } = await supabase
          .from('tasks')
          .select(`
            id,
            title,
            description,
            priority,
            status,
            created_at,
            completed_at,
            assigned_dev_id,
            est_hours,
            hours_spent,
            position,
            assigned_dev:users!tasks_assigned_dev_id_fkey(id, email)
          `)
          .eq('client_id', membership.client_id)
          .order('position', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(100) // Limit to prevent performance issues

        if (cancelled) return

        if (error) {
          console.error('Error fetching tasks:', error)
        } else if (tasksData) {
          setTasks(tasksData as any)
        }
      } catch (e) {
        console.error('Failed to load tasks:', e)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadTasks()
    
    return () => {
      cancelled = true
    }
  }, [supabase, router, pathname, membership, userLoading])

  const onEditTask = (task: Task) => {
    setSelectedTask(task)
    setEditTaskOpen(true)
  }

  // Priority sorting helper: high = 3, medium = 2, low = 1
  const getPriorityValue = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 3
      case 'medium': return 2
      case 'low': return 1
      default: return 2
    }
  }

  // Helper functions for priority display (used in DragOverlay)
  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'destructive'
      case 'medium': return 'warning'
      case 'low': return 'secondary'
      default: return 'default'
    }
  }

  const getPriorityLabel = (priority: string) => {
    if (!priority) return 'Medium'
    return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
  }


  // Handle drag start to track active item
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  // Handle drag end for tasks
  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event

    if (!over || !clientId) {
      return
    }

    const draggedTask = tasks.find(t => t.id === active.id)
    if (!draggedTask) return

    // Restriction: Clients can only reorder tasks in "queued" status
    // PM/Admin can drag across all columns
    const isClient = userRole === 'client'
    if (isClient && draggedTask.status !== 'queued') {
      // Client tried to drag a non-queued task - revert
      return
    }

    // Check if dropped on a column (status change) - this is the primary case
    const targetStatus = ['queued', 'in_progress', 'done'].includes(over.id as string) 
      ? (over.id as string)
      : null
    
    // If dropped directly on a column (including empty areas)
    if (targetStatus && draggedTask.status !== targetStatus) {
      // Restriction: Clients can only move tasks within "queued" status
      if (isClient && targetStatus !== 'queued') {
        // Client tried to move to non-queued column - revert
        return
      }
      
      const newStatus = targetStatus as 'queued' | 'in_progress' | 'done'
      
      // Get tasks in the target status (including the moved task)
      const targetStatusTasks = tasks.filter(t => t.status === newStatus && t.id !== draggedTask.id)
      const updatedDraggedTask = { ...draggedTask, status: newStatus }
      
      // Add the moved task to the end (it will be sorted by priority on next render)
      const newTargetTasks = [...targetStatusTasks, updatedDraggedTask]
      
      // Update local state optimistically
      const updatedTasks = tasks.map(task =>
        task.id === draggedTask.id ? updatedDraggedTask : task
      )
      setTasks(updatedTasks)

      try {
        // First update the status
        const statusResponse = await fetch(`/api/tasks/${draggedTask.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: newStatus,
          }),
        })

        if (!statusResponse.ok) {
          // Revert on error
          loadTasks()
          return
        }

        // Then update positions for all tasks in the target status
        // Sort by priority first, then assign positions
        const sortedTasks = sortTasksByPriority(newTargetTasks)
        const order = sortedTasks.map((task, index) => ({
          id: task.id,
          position: index,
        }))

        const orderResponse = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            status: newStatus,
            order,
          }),
        })

        if (!orderResponse.ok) {
          // Revert on error
          loadTasks()
        }
      } catch (error) {
        console.error('Failed to update task status:', error)
        loadTasks()
      }
      return
    }

    // If dropped on another task (check if it's a different status or reordering)
    const targetTask = tasks.find(t => t.id === over.id)
    
    if (targetTask) {
      // If dropped on a task with different status, move to that status
      if (draggedTask.status !== targetTask.status) {
        // Restriction: Clients can only move tasks within "queued" status
        if (isClient && targetTask.status !== 'queued') {
          // Client tried to move to non-queued column - revert
          return
        }
        
        const newStatus = targetTask.status
        
        // Get tasks in the target status (excluding the dragged task)
        const targetStatusTasks = tasks.filter(t => t.status === newStatus && t.id !== draggedTask.id)
        const updatedDraggedTask = { ...draggedTask, status: newStatus }
        
        // Add the moved task to the end (it will be sorted by priority on next render)
        const newTargetTasks = [...targetStatusTasks, updatedDraggedTask]
        
        // Update local state optimistically
        const updatedTasks = tasks.map(task =>
          task.id === draggedTask.id ? updatedDraggedTask : task
        )
        setTasks(updatedTasks)

        try {
          // First update the status
          const statusResponse = await fetch(`/api/tasks/${draggedTask.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: newStatus,
            }),
          })

          if (!statusResponse.ok) {
            loadTasks()
            return
          }

          // Then update positions for all tasks in the target status
          // Sort by priority first, then assign positions
          const sortedTasks = sortTasksByPriority(newTargetTasks)
          const order = sortedTasks.map((task, index) => ({
            id: task.id,
            position: index,
          }))

          const orderResponse = await fetch('/api/tasks', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: clientId,
              status: newStatus,
              order,
            }),
          })

          if (!orderResponse.ok) {
            loadTasks()
          }
        } catch (error) {
          console.error('Failed to update task status:', error)
          loadTasks()
        }
        return
      }

      // Reordering within same status (Trello-like - all columns reorderable)
      if (draggedTask.status === targetTask.status) {
        const sameStatusTasks = tasks.filter(t => t.status === draggedTask.status)
        const oldIndex = sameStatusTasks.findIndex(t => t.id === active.id)
        const newIndex = sameStatusTasks.findIndex(t => t.id === over.id)

        if (oldIndex === -1 || newIndex === -1) {
          return
        }

        // Update local state optimistically
        const reorderedTasks = arrayMove(sameStatusTasks, oldIndex, newIndex)
        const updatedTasks = tasks.map(task => {
          if (task.status === draggedTask.status) {
            const newTask = reorderedTasks.find(t => t.id === task.id)
            return newTask || task
          }
          return task
        })
        setTasks(updatedTasks)

        // Update positions in database for all reordered tasks
        try {
          const order = reorderedTasks.map((task, index) => ({
            id: task.id,
            position: index,
          }))

          const response = await fetch('/api/tasks', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: clientId,
              status: draggedTask.status,
              order,
            }),
          })

          if (!response.ok) {
            // Revert on error
            loadTasks()
          }
        } catch (error) {
          console.error('Failed to update task order:', error)
          // Revert on error
          loadTasks()
        }
      }
    }
  }

  const loadTasks = useCallback(async () => {
    if (!clientId) return
    
    try {
      const { data: tasksData, error } = await supabase
        .from('tasks')
        .select(`
          *,
          assigned_dev:users!tasks_assigned_dev_id_fkey(email)
        `)
        .eq('client_id', clientId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(100) // Limit to prevent performance issues

      if (error) {
        console.error('Error fetching tasks:', error)
      } else if (tasksData) {
        setTasks(tasksData as any)
      }
    } catch (e) {
      console.error('Failed to load tasks:', e)
    }
  }, [clientId, supabase])

  // Memoize sort function to avoid recreation
  const sortTasksByPriority = useCallback((taskList: Task[]) => {
    return [...taskList].sort((a, b) => {
      // First sort by priority (high first)
      const priorityDiff = getPriorityValue(b.priority) - getPriorityValue(a.priority)
      if (priorityDiff !== 0) return priorityDiff
      
      // Then sort by position
      const posA = a.position ?? 0
      const posB = b.position ?? 0
      return posA - posB
    })
  }, [getPriorityValue])

  // Memoize grouped and sorted tasks to avoid recalculation on every render
  const { queuedTasks, inProgressTasks, doneTasks } = useMemo(() => {
    const queued = sortTasksByPriority(tasks.filter(t => t.status === 'queued'))
    const inProgress = sortTasksByPriority(tasks.filter(t => t.status === 'in_progress'))
    const done = sortTasksByPriority(tasks.filter(t => t.status === 'done'))
    return { queuedTasks: queued, inProgressTasks: inProgress, doneTasks: done }
  }, [tasks, sortTasksByPriority])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-bold">My Tasks</h1>
            <p className="text-muted-foreground">Track your project progress</p>
          </div>
          <Button onClick={() => setSubmitTaskOpen(true)} disabled={!clientId}>
            <Plus className="h-4 w-4 mr-2" />
            Submit New Task
          </Button>
        </div>

        {/* Submit Task Dialog */}
        {clientId && (
          <SubmitTaskDialog 
            isOpen={submitTaskOpen}
            onClose={() => setSubmitTaskOpen(false)}
            clientId={clientId}
            onTaskCreated={() => {
              loadTasks()
            }}
          />
        )}

        {/* Edit Task Dialog */}
        {clientId && selectedTask && (
          <EditTaskDialog
            isOpen={editTaskOpen}
            onClose={() => {
              setEditTaskOpen(false)
              setSelectedTask(null)
            }}
            task={selectedTask}
            clientId={clientId}
            userRole={userRole}
            onTaskUpdated={() => {
              loadTasks()
            }}
          />
        )}

        {/* Loading State */}
        {loading && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Loading tasks...</p>
            </CardContent>
          </Card>
        )}

        {/* Task Board */}
        {!loading && clientId && (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KanbanColumn 
                  title="Queued" 
                  tasks={queuedTasks} 
                  canReorder={true}
                  count={queuedTasks.length}
                  status="queued"
                  onEditTask={onEditTask}
                />
                <KanbanColumn 
                  title="In Progress" 
                  tasks={inProgressTasks}
                  canReorder={true}
                  count={inProgressTasks.length}
                  status="in_progress"
                  onEditTask={onEditTask}
                />
                <KanbanColumn 
                  title="Done" 
                  tasks={doneTasks}
                  canReorder={true}
                  count={doneTasks.length}
                  status="done"
                  onEditTask={onEditTask}
                />
              </div>
              
              <DragOverlay>
                {activeId ? (() => {
                  const activeTask = tasks.find(t => t.id === activeId)
                  if (!activeTask) return null
                  
                  return (
                    <div style={{ opacity: 1, transform: 'rotate(2deg)' }}>
                      <Card className="mb-3 cursor-grabbing shadow-2xl w-64">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-sm">{activeTask.title}</h4>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                            {activeTask.description}
                          </p>

                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <Badge variant={getPriorityColor(activeTask.priority) as any} className="text-xs">
                                {getPriorityLabel(activeTask.priority)}
                              </Badge>
                              {activeTask.attachments && Array.isArray(activeTask.attachments) && activeTask.attachments.length > 0 && (
                                <div className="flex items-center text-xs text-muted-foreground">
                                  <Paperclip className="h-3 w-3 mr-1" />
                                  {activeTask.attachments.length}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3 mr-1" />
                            {activeTask.created_at ? new Date(activeTask.created_at).toLocaleDateString('en-US', { dateStyle: 'short' }) : 'N/A'}
                          </div>

                          {activeTask.assigned_dev && (
                            <div className="mt-2 pt-2 border-t">
                              <p className="text-xs text-muted-foreground">
                                Assigned to: <span className="font-medium">{activeTask.assigned_dev.email || 'Unknown'}</span>
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )
                })() : null}
              </DragOverlay>
            </DndContext>

            {/* Info Card */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                  <span>Submit new tasks using the button above. Our team will review and start working on them according to your plan's capacity.</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
