import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

const Stripe = require('stripe')

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = await getServerSupabase()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get client's Stripe customer ID
    const { data: membership } = await supabase
      .from('client_members')
      .select('client_id, clients!inner(stripe_customer_id)')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    // Type assertion: clients is a single object, not an array
    const client = membership?.clients as { stripe_customer_id: string } | undefined
    
    if (!client?.stripe_customer_id) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 400 })
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: client.stripe_customer_id,
      return_url: `${req.nextUrl.origin}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Stripe portal error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create portal session' }, { status: 500 })
  }
}

