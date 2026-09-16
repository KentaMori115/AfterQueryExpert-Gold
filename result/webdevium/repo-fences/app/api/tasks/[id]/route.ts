import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'

const updateSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low','medium','high']).optional(),
  est_hours: z.number().int().min(0).nullable().optional(),
  status: z.enum(['queued','in_progress','done']).optional(),
  assigned_dev_id: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
  completed_at: z.string().nullable().optional()
}).refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getServerSupabase()
  const body = await req.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  
  // Handle completed_at - set to now() if status is 'done', null otherwise
  const updateData: any = { ...parsed.data }
  
  // Remove completed_at from parsed data if it exists (we'll handle it based on status)
  if ('completed_at' in updateData) {
    delete updateData.completed_at
  }
  
  // Enforce one active task at a time rule
  if (updateData.status === 'in_progress') {
    // Get the task's client_id
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('client_id')
      .eq('id', id)
      .single()
    
    if (currentTask?.client_id) {
      // Check if there's already an in_progress task for this client
      const { data: existingActive } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('client_id', currentTask.client_id)
        .eq('status', 'in_progress')
        .neq('id', id)
        .maybeSingle()
      
      if (existingActive) {
        return NextResponse.json({ 
          error: `Only one active task allowed. "${existingActive.title}" is currently in progress. Please complete or queue it first.` 
        }, { status: 400 })
      }
    }
  }
  
  // Get current task data to check status change
  const { data: currentTask } = await supabase
    .from('tasks')
    .select('status, completed_at, client_id, hours_spent')
    .eq('id', id)
    .single()

  if (!currentTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const wasNotDone = currentTask.status !== 'done'
  const isMovingToDone = updateData.status === 'done' && wasNotDone

  if (updateData.status === 'done') {
    // Only set completed_at if it's not already set
    if (!currentTask.completed_at) {
      updateData.completed_at = new Date().toISOString()
    }
  } else if (updateData.status && updateData.status !== 'done') {
    updateData.completed_at = null
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', id)
    .select(`
      *,
      assigned_dev:users!tasks_assigned_dev_id_fkey(id, email)
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // If task was moved to done, automatically log usage
  if (isMovingToDone && data && currentTask.client_id) {
    // Use hours_spent if available, otherwise use est_hours, default to 1 hour
    const hoursToLog = data.hours_spent || data.est_hours || 1
    
    if (hoursToLog > 0) {
      // Log usage asynchronously - don't fail task update if this fails
      const { data: { user } } = await supabase.auth.getUser()
      Promise.resolve(supabase.from('usage_logs').insert({
        client_id: currentTask.client_id,
        task_id: id,
        hours: hoursToLog,
        logged_by: user?.id ?? null,
      })).then(({ error: logError }) => {
        if (logError) {
          console.error('Failed to log usage:', logError)
        }
      }).catch((err: unknown) => {
        console.error('Error logging usage:', err)
      })
    }
  }

  return NextResponse.json({ task: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getServerSupabase()
  const { id } = await params

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}


