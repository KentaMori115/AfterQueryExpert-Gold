import { createClient } from '@supabase/supabase-js'

export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. Please set it in your .env.local file.')
  }

  // Basic validation: service role key should be a JWT token (starts with eyJ)
  if (!serviceKey.startsWith('eyJ')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY appears to be invalid. Service role keys should start with "eyJ" (JWT format). Make sure you\'re using the service_role key, not the anon key.')
  }

  // Check if it might be the anon key (shorter, different format)
  if (serviceKey.length < 200) {
    console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY seems too short. Service role keys are typically longer than 200 characters. Make sure you\'re using the service_role key from Supabase Dashboard → Settings → API.')
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}


