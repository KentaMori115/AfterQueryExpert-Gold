import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Check Stripe configuration status
export async function GET() {
  try {
    const apiKeyConfigured = !!process.env.STRIPE_SECRET_KEY
    const webhookSecretConfigured = !!process.env.STRIPE_WEBHOOK_SECRET
    
    // Price ID mappings (these should match your Stripe dashboard)
    const priceIds = {
      starter: process.env.STRIPE_PRICE_STARTER || '',
      growth: process.env.STRIPE_PRICE_GROWTH || '',
      scale: process.env.STRIPE_PRICE_SCALE || '',
      dedicated: process.env.STRIPE_PRICE_DEDICATED || ''
    }

    return NextResponse.json({
      apiKeyConfigured,
      webhookSecretConfigured,
      priceIds,
      mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test'
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

