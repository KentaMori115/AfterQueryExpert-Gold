import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

const Stripe = require('stripe')

export const runtime = 'nodejs'

// Build PRICE_TO_PLAN mapping from environment variables
// Falls back to default hardcoded values if env vars are not set (for backward compatibility)
function getPriceToPlanMapping(): Record<string, { plan_code: string; hours: number }> {
  const mapping: Record<string, { plan_code: string; hours: number }> = {}
  
  // Starter Plan - 40 hours
  const starterPriceId = process.env.STRIPE_PRICE_STARTER
  if (starterPriceId) {
    mapping[starterPriceId] = { plan_code: 'starter', hours: 40 }
  }
  
  // Growth Plan - 80 hours
  const growthPriceId = process.env.STRIPE_PRICE_GROWTH
  if (growthPriceId) {
    mapping[growthPriceId] = { plan_code: 'growth', hours: 80 }
  }
  
  // Scale Plan - 120 hours
  const scalePriceId = process.env.STRIPE_PRICE_SCALE
  if (scalePriceId) {
    mapping[scalePriceId] = { plan_code: 'scale', hours: 120 }
  }
  
  // Dedicated Plan - 160 hours
  const dedicatedPriceId = process.env.STRIPE_PRICE_DEDICATED
  if (dedicatedPriceId) {
    mapping[dedicatedPriceId] = { plan_code: 'dedicated', hours: 160 }
  }
  
  // Fallback to hardcoded values if no env vars are set (backward compatibility)
  if (Object.keys(mapping).length === 0) {
    return {
      price_starter: { plan_code: 'starter', hours: 40 },
      price_growth: { plan_code: 'growth', hours: 80 },
      price_scale: { plan_code: 'scale', hours: 120 },
      price_dedicated: { plan_code: 'dedicated', hours: 160 }
    }
  }
  
  return mapping
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') as string
  const raw = await req.text()

  // Initialize Stripe client inside the function to avoid build-time errors
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  let event: any
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${err.message}` }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const PRICE_TO_PLAN = getPriceToPlanMapping()

  // Log warning if using hardcoded fallback values (means env vars not set)
  const hasEnvVars = process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_GROWTH || 
                     process.env.STRIPE_PRICE_SCALE || process.env.STRIPE_PRICE_DEDICATED
  if (!hasEnvVars && Object.keys(PRICE_TO_PLAN).length > 0) {
    console.warn('⚠️ Stripe Price IDs not configured in environment variables. Using fallback values. Set STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_SCALE, and STRIPE_PRICE_DEDICATED in .env.local')
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const customerId = session.customer
        const priceId = session.metadata?.price_id || session.line_items?.data?.[0]?.price?.id
        if (!priceId) break
        const plan = PRICE_TO_PLAN[priceId]
        if (!plan) {
          console.warn(`Unknown price ID in checkout: ${priceId}`)
          break
        }

        const name = session.client_reference_id || session.customer_details?.name || 'New Client'
        await supabase.from('clients').insert({
          name,
          stripe_customer_id: customerId,
          plan_code: plan.plan_code,
          hours_monthly: plan.hours,
          cycle_start: new Date().toISOString().slice(0, 10)
        })
        break
      }
      case 'customer.subscription.updated': {
        // Handle subscription updates including plan changes and status changes
        const sub = event.data.object
        const priceId = sub.items.data[0]?.price?.id
        const plan = priceId ? PRICE_TO_PLAN[priceId] : undefined
        
        // Check subscription status
        if (sub.status === 'active' && plan) {
          // Subscription is active - update plan and restore hours
          await supabase
            .from('clients')
            .update({ plan_code: plan.plan_code, hours_monthly: plan.hours })
            .eq('stripe_customer_id', sub.customer)
        } else if (sub.status === 'canceled' || sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
          // Subscription is canceled, past due, or unpaid - disable access
          await supabase
            .from('clients')
            .update({ hours_monthly: 0 })
            .eq('stripe_customer_id', sub.customer)
          console.log(`Subscription ${sub.status} for customer: ${sub.customer}`)
        } else if (plan) {
          // Other status but valid plan - update plan/hours normally
          await supabase
            .from('clients')
            .update({ plan_code: plan.plan_code, hours_monthly: plan.hours })
            .eq('stripe_customer_id', sub.customer)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object
        await supabase
          .from('clients')
          .update({ cycle_start: new Date().toISOString().slice(0, 10), hours_used_month: 0 })
          .eq('stripe_customer_id', inv.customer)
        break
      }
      case 'customer.subscription.deleted': {
        // Subscription canceled - disable access by setting hours to 0
        const sub = event.data.object
        await supabase
          .from('clients')
          .update({ hours_monthly: 0 })
          .eq('stripe_customer_id', sub.customer)
        console.log(`Subscription deleted for customer: ${sub.customer}`)
        break
      }
      case 'invoice.payment_failed': {
        // Payment failed - disable access by setting hours to 0
        // Client will need to update payment method via portal to restore access
        const inv = event.data.object
        await supabase
          .from('clients')
          .update({ hours_monthly: 0 })
          .eq('stripe_customer_id', inv.customer)
        console.log(`Payment failed for customer: ${inv.customer}`)
        break
      }
    }
  } catch (e: any) {
    console.error('Webhook processing error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}


