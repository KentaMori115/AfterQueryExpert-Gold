import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Monthly reset cron job
// Should be called daily to check for clients whose cycle needs to reset
export async function POST(req: Request) {
  // Verify cron secret if needed
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await getServerSupabase()
  const today = new Date().toISOString().slice(0, 10)
  
  // Reset usage for clients whose cycle_start date is today or in the past
  // This handles monthly billing cycles
  const { data: updated, error } = await supabase
    .from('clients')
    .update({ 
      hours_used_month: 0, 
      cycle_start: today 
    })
    .lte('cycle_start', today)
    .select('id, name')

  if (error) {
    console.error('Error resetting usage:', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ 
    ok: true, 
    reset_count: updated?.length || 0,
    clients_reset: updated?.map((c: any) => ({ id: c.id, name: c.name })) || []
  })
}


