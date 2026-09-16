import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'

const createTaskSchema = z.object({
  client_id: z.string().uuid(),
  title: z.string().min(3),
  description: z.string().optional(),
  priority: z.enum(['low','medium','high']).optional().default('medium')
})

export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase()
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')

  let query = supabase.from('tasks').select('*').order('created_at', { ascending: false })
  if (clientId) query = query.eq('client_id', clientId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ tasks: data })
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const body = await req.json().catch(() => ({}))
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase.from('tasks').insert({
    client_id: parsed.data.client_id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority,
    status: 'queued'
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ task: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await getServerSupabase()
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    client_id: z.string().uuid(),
    status: z.enum(['queued', 'in_progress', 'done']),
    order: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) }))
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { client_id, status, order } = parsed.data
  const ids = order.map(o => o.id)

  const { data: tasks, error: fetchErr } = await supabase
    .from('tasks')
    .select('id,status,client_id')
    .in('id', ids)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 })

  if (!tasks || !tasks.every(t => t.client_id === client_id && t.status === status)) {
    return NextResponse.json({ error: `Only ${status} tasks of the same client can be reordered` }, { status: 400 })
  }

  const updates = order.map(o => ({ id: o.id, position: o.position }))
  const { error: updErr } = await supabase.from('tasks').upsert(updates)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}


