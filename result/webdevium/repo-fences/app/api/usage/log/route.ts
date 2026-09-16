import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'

const logSchema = z.object({
  client_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  hours: z.number().positive(),
})

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const body = await req.json().catch(() => ({}))
  const parsed = logSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase.from('usage_logs').insert({
    client_id: parsed.data.client_id,
    task_id: parsed.data.task_id ?? null,
    hours: parsed.data.hours,
    logged_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // If task provided, update its hours via RPC
  if (parsed.data.task_id) {
    await supabase.rpc('increment_task_hours', { p_task_id: parsed.data.task_id, p_hours: parsed.data.hours })
  }

  return NextResponse.json({ usage: data })
}


