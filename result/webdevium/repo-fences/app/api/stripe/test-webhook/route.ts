import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Test webhook endpoint
export async function POST(req: NextRequest) {
  try {
    const supabase = await getServerSupabase()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin or PM
    const { data: membership } = await supabase
      .from('client_members')
      .select('role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (!membership || (membership.role !== 'admin' && membership.role !== 'pm')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ 
        error: 'Stripe is not fully configured. Please set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET environment variables.' 
      }, { status: 400 })
    }

    // Return success - webhook endpoint exists and is accessible
    return NextResponse.json({ 
      success: true,
      message: 'Webhook endpoint is accessible and configured correctly',
      webhookUrl: `${req.nextUrl.origin}/api/stripe/webhook`
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to test webhook' }, { status: 500 })
  }
}

