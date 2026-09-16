import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Weekly recap email cron job
// Should be called weekly (e.g., every Monday at 9 AM)
export async function POST(req: Request) {
  // Verify cron secret if needed
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await getServerSupabase()
  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Get all clients with their members
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select(`
      id,
      name,
      plan_code,
      plans!inner(name),
      client_members!inner(user_id, users!inner(email))
    `)

  if (clientsErr) {
    console.error('Error fetching clients:', clientsErr)
    return NextResponse.json({ error: clientsErr.message }, { status: 400 })
  }

  const summaries: Array<{
    client_id: string
    client_name: string
    plan_name: string
    total_hours: number
    task_count: number
    emails: string[]
  }> = []

  for (const c of clients || []) {
    // Get usage logs from last 7 days
    const { data: logs, error: logsErr } = await supabase
      .from('usage_logs')
      .select('hours, logged_at, task_id')
      .eq('client_id', c.id)
      .gte('logged_at', sinceIso)
      .order('logged_at', { ascending: false })

    if (logsErr) {
      console.error(`Error fetching logs for client ${c.id}:`, logsErr)
      continue
    }

    const total = (logs || []).reduce((sum, row) => sum + Number(row.hours), 0)
    const taskCount = new Set((logs || []).map(l => l.task_id).filter(Boolean)).size

    // Extract emails from client members
    const emails = ((c as any).client_members || [])
      .map((m: any) => m.users?.email)
      .filter(Boolean)

    summaries.push({
      client_id: c.id,
      client_name: (c as any).name || 'Client',
      plan_name: ((c as any).plans as any)?.name || (c as any).plan_code || 'Unknown',
      total_hours: total,
      task_count: taskCount,
      emails,
    })
  }

  // Here you would send emails using Resend
  // For now, we'll just return the summaries
  // TODO: Integrate with Resend API to send emails
  // Example:
  // for (const summary of summaries) {
  //   await resend.emails.send({
  //     from: 'noreply@webdevium.com',
  //     to: summary.emails,
  //     subject: `Weekly Recap - ${summary.client_name}`,
  //     html: generateWeeklyRecapEmail(summary)
  //   })
  // }

  return NextResponse.json({ 
    ok: true, 
    summaries,
    message: 'Weekly recap summaries generated. Email integration pending.' 
  })
}
