import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'

const createClientSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  plan_code: z.string().min(1, 'Plan is required'),
  hours_monthly: z.number().int().positive('Monthly hours must be positive'),
  cycle_start: z.string().optional(),
  owner_user_id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
})

async function assertIsAdmin() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, status: 401 as const, error: 'Unauthorized' }
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
    return { ok: false, status: 500 as const, error: membershipsError.message }
  }

  const isAdminOrPM = memberships?.some((m) => m.role === 'admin' || m.role === 'pm')
  if (!isAdminOrPM) {
    return { ok: false, status: 403 as const, error: 'Forbidden' }
  }

  return { ok: true as const }
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  const payload = await req.json().catch(() => ({}))
  const parsed = createClientSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Use regular Supabase client (RLS should allow admin/pm to create clients)
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: parsed.data.name,
      plan_code: parsed.data.plan_code,
      hours_monthly: parsed.data.hours_monthly,
      cycle_start: parsed.data.cycle_start ?? new Date().toISOString().slice(0, 10),
      owner_user_id: parsed.data.owner_user_id ?? null,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ client: data }, { status: 201 })
}


