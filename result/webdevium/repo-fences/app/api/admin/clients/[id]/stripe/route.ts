import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

const Stripe = require('stripe')

async function assertIsAdmin() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, status: 401 as const, error: 'Unauthorized' }
  }

  // Check users.role for admin/pm (primary check)
  const { data: userRecord, error: userRecordError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRecordError && userRecord && (userRecord.role === 'admin' || userRecord.role === 'pm')) {
    return { ok: true as const }
  }

  // Fallback to client_members check
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

// GET: Get Stripe customer info for a client
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  const { id } = await params
  const supabase = await getServerSupabase()

  // Get client with Stripe customer ID
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, stripe_customer_id')
    .eq('id', id)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.stripe_customer_id) {
    return NextResponse.json({
      client_id: client.id,
      client_name: client.name,
      stripe_customer_id: null,
      has_stripe: false,
    })
  }

  // Fetch Stripe customer details
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const customer = await stripe.customers.retrieve(client.stripe_customer_id)
    const subscriptions = await stripe.subscriptions.list({
      customer: client.stripe_customer_id,
      limit: 10,
    })

    return NextResponse.json({
      client_id: client.id,
      client_name: client.name,
      stripe_customer_id: client.stripe_customer_id,
      has_stripe: true,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: customer.created,
      },
      subscriptions: subscriptions.data.map((sub: any) => ({
        id: sub.id,
        status: sub.status,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        items: sub.items.data.map((item: any) => ({
          price_id: item.price.id,
          product_id: item.price.product,
        })),
      })),
    })
  } catch (error: any) {
    console.error('Stripe API error:', error.message)
    return NextResponse.json(
      {
        client_id: client.id,
        client_name: client.name,
        stripe_customer_id: client.stripe_customer_id,
        has_stripe: true,
        error: error.message,
      },
      { status: 400 }
    )
  }
}

// PATCH: Update Stripe customer ID for a client
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { stripe_customer_id } = body

  const supabase = await getServerSupabase()

  // Validate Stripe customer ID if provided
  if (stripe_customer_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
      await stripe.customers.retrieve(stripe_customer_id)
    } catch (error: any) {
      return NextResponse.json(
        { error: `Invalid Stripe customer ID: ${error.message}` },
        { status: 400 }
      )
    }
  }

  // Update client
  const { data, error } = await supabase
    .from('clients')
    .update({ stripe_customer_id: stripe_customer_id || null })
    .eq('id', id)
    .select('id, name, stripe_customer_id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ client: data })
}

// POST: Create Stripe portal session for client
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  const { id } = await params
  const supabase = await getServerSupabase()

  // Get client's Stripe customer ID
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, stripe_customer_id')
    .eq('id', id)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.stripe_customer_id) {
    return NextResponse.json(
      { error: 'Client does not have a Stripe customer ID' },
      { status: 400 }
    )
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: client.stripe_customer_id,
      return_url: `${req.nextUrl.origin}/admin/clients`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Stripe portal error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create portal session' }, { status: 500 })
  }
}

