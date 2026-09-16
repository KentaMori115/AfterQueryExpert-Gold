import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'

const createTaskSchema = z.object({
  client_id: z.string().uuid(),
  title: z.string().min(3),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['queued', 'in_progress', 'done']).optional(),
  est_hours: z.number().int().min(0).optional(),
  assigned_dev_id: z.string().uuid().optional(),
})

async function assertIsAdmin() {
  const supabase = await getServerSupabase()
  
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    console.error('Auth error:', userError?.message || 'No user found')
    return { ok: false, status: 401 as const, error: 'Unauthorized - Please sign in again' }
  }

  // First, try to check users.role using regular client (if RLS allows)
  const { data: userRecord, error: userRecordError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRecordError && userRecord && (userRecord.role === 'admin' || userRecord.role === 'pm')) {
    return { ok: true as const }
  }

  // Fallback to client_members check (like other endpoints)
  const { data: memberships, error: membershipsError } = await supabase
    .from('client_members')
    .select('role')
    .eq('user_id', user.id)

  if (membershipsError) {
    console.error('Memberships error:', membershipsError.message)
    return { ok: false, status: 500 as const, error: 'Failed to verify admin status' }
  }

  const isAdminOrPM = memberships?.some((m) => m.role === 'admin' || m.role === 'pm')
  if (!isAdminOrPM) {
    return { ok: false, status: 403 as const, error: 'Forbidden - Admin or PM access required' }
  }

  return { ok: true as const }
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  let payload = await req.json().catch(() => ({}))
  
  // Preprocess: clean up empty strings and invalid values before validation
  if (payload.description === '' || payload.description === null) {
    delete payload.description
  }
  if (payload.est_hours === '' || payload.est_hours === null || payload.est_hours === undefined) {
    delete payload.est_hours
  } else if (typeof payload.est_hours === 'string') {
    payload.est_hours = Number(payload.est_hours)
  }
  if (payload.assigned_dev_id === '' || payload.assigned_dev_id === null) {
    delete payload.assigned_dev_id
  }
  
  const parsed = createTaskSchema.safeParse(payload)
  if (!parsed.success) {
    // Format Zod errors into a user-friendly message
    const errors = parsed.error.issues
    const errorMessages = errors.map((e: any) => {
      const field = e.path.join('.')
      return `${field ? `${field}: ` : ''}${e.message}`
    })
    return NextResponse.json(
      { error: errorMessages[0] || 'Invalid request data', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const desiredStatus = parsed.data.status ?? 'queued'

  if (desiredStatus === 'in_progress') {
    const { data: existingActive, error: activeError } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('client_id', parsed.data.client_id)
      .eq('status', 'in_progress')
      .maybeSingle()

    if (activeError) {
      return NextResponse.json({ error: activeError.message }, { status: 400 })
    }

    if (existingActive) {
      return NextResponse.json(
        {
          error: `Only one task can be in progress for this client. "${existingActive.title}" is already active.`,
        },
        { status: 400 }
      )
    }
  }

  const insertPayload: Record<string, any> = {
    client_id: parsed.data.client_id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority,
    status: desiredStatus,
    est_hours: parsed.data.est_hours ?? null,
    assigned_dev_id: parsed.data.assigned_dev_id ?? null,
  }

  if (desiredStatus === 'done') {
    insertPayload.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert(insertPayload)
    .select(
      `
      *,
      assigned_dev:users!tasks_assigned_dev_id_fkey(id, email),
      clients(id, name)
    `
    )
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ task: data }, { status: 201 })
}


