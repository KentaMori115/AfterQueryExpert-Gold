import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'


const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'client', 'pm', 'dev']),
  create_client: z.boolean().optional().default(false),
  client_name: z.string().optional(),
  client_plan_code: z.string().optional(),
  client_hours_monthly: z.number().int().positive().optional(),
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
  const authCheck = await assertIsAdmin()
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
  }

  const payload = await req.json().catch(() => ({}))
  const parsed = createUserSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Use service role key to create user in Supabase Auth
  // This requires SUPABASE_SERVICE_ROLE_KEY to be set in environment variables
  let supabaseAdmin
  try {
    supabaseAdmin = getAdminSupabase()
    
    // Verify the service role key has admin access by trying to list users
    // This will help identify if the key has the right permissions
    const { error: testError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (testError && testError.status === 403) {
      return NextResponse.json(
        { 
          error: 'Service role key does not have admin permissions',
          details: 'The service role key is valid but does not have permission to use Admin API functions.',
          help: 'This is a Supabase project configuration issue. The Admin API might be disabled for your project. You can: 1) Create users manually in Supabase Dashboard → Authentication → Users, 2) Contact Supabase support to enable Admin API, or 3) Check if there are project-level restrictions in your Supabase settings.'
        },
        { status: 403 }
      )
    }
  } catch (error: any) {
    console.error('Failed to get admin Supabase client:', error.message)
    return NextResponse.json(
      { 
        error: 'Service role key configuration error',
        details: error.message,
        help: 'To fix this: 1) Go to Supabase Dashboard → Settings → API, 2) Copy the "service_role" key (NOT the anon key), 3) Add it to .env.local as SUPABASE_SERVICE_ROLE_KEY=your_key_here, 4) Restart your dev server'
      },
      { status: 500 }
    )
  }

  try {
    // Step 1: Create user in Supabase Auth using admin API
    // Try using the REST API directly if the client method fails
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    let authData: any = null
    let authError: any = null
    
    // First try the client method
    const clientResult = await supabaseAdmin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        role: parsed.data.role,
      },
    })
    
    if (clientResult.error) {
      // If client method fails with 403, try REST API directly
      if (clientResult.error.status === 403 && supabaseUrl && serviceRoleKey) {
        try {
          const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
              'apikey': serviceRoleKey,
            },
            body: JSON.stringify({
              email: parsed.data.email,
              password: parsed.data.password,
              email_confirm: true,
              user_metadata: {
                role: parsed.data.role,
              },
            }),
          })
          
          const restData = await response.json()
          
          if (!response.ok) {
            authError = {
              message: restData.message || restData.error_description || 'Failed to create user',
              status: response.status,
              name: 'AuthApiError'
            }
          } else {
            authData = { user: restData }
          }
        } catch (restError: any) {
          // If REST API also fails, use the original error
          authError = clientResult.error
        }
      } else {
        authError = clientResult.error
      }
    } else {
      authData = clientResult.data
    }

    if (authError) {
      console.error('Supabase Auth Error Details:', {
        message: authError.message,
        status: authError.status,
        name: authError.name
      })
      
      // Provide more helpful error messages based on error type
      let errorMessage = authError.message
      let helpText = ''
      
      if (authError.status === 401 || authError.message?.includes('Invalid API key') || authError.message?.includes('invalid')) {
        errorMessage = 'Invalid Supabase service role key. Please check your SUPABASE_SERVICE_ROLE_KEY in .env.local file.'
        helpText = 'Make sure you\'re using the service_role key (not the anon key) from Supabase Dashboard → Settings → API.'
      } else if (authError.status === 403 || authError.message?.includes('not allowed') || authError.message?.includes('User not allowed') || authError.message?.includes('Permission denied')) {
        errorMessage = 'Permission denied. Cannot create users via Admin API with current service role key.'
        helpText = 'WORKAROUND: Create users manually in Supabase Dashboard → Authentication → Users → Add user, then their role will be set automatically. To enable API creation: Check Supabase Dashboard → Authentication → Settings for "Enable admin user creation" or contact Supabase support if this option is not available.'
      } else if (authError.message?.includes('already registered') || authError.message?.includes('already exists')) {
        errorMessage = 'A user with this email already exists.'
        helpText = 'Please use a different email address or check if the user already exists in Supabase Auth.'
      }
      
      return NextResponse.json({ 
        error: `Failed to create user: ${errorMessage}`,
        details: {
          message: authError.message,
          status: authError.status,
          help: helpText || 'Check your Supabase configuration and service role key permissions.'
        }
      }, { status: 400 })
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    // Step 2: Create or update user record in public.users with the specified role
    const regularSupabase = await getServerSupabase()
    const userData: any = {
      id: authData.user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    }

    const { data: userRecord, error: userError } = await regularSupabase
      .from('users')
      .insert(userData)
      .select()
      .single()

    // Step 3: Create client if requested (for client role users)
    let createdClient: any = null
    
    if (parsed.data.create_client && parsed.data.role === 'client') {
      const clientName = parsed.data.client_name || `${parsed.data.email.split('@')[0]}'s Company`
      const planCode = parsed.data.client_plan_code || 'starter'
      
      // Get plan hours if not provided
      let hoursMonthly = parsed.data.client_hours_monthly
      if (!hoursMonthly) {
        const planDetails: Record<string, number> = {
          starter: 40,
          growth: 80,
          scale: 120,
          dedicated: 160,
        }
        hoursMonthly = planDetails[planCode] || 40
      }
      
      try {
        const { data: client, error: clientError } = await regularSupabase
          .from('clients')
          .insert({
            name: clientName,
            owner_user_id: authData.user.id,
            plan_code: planCode,
            hours_monthly: hoursMonthly,
            cycle_start: new Date().toISOString().slice(0, 10),
          })
          .select('*')
          .single()
        
        if (clientError) {
          console.error('Failed to create client:', clientError)
          // Don't fail user creation if client creation fails
        } else {
          createdClient = client
          
          // Link user to client
          const { error: memberError } = await regularSupabase
            .from('client_members')
            .insert({
              client_id: client.id,
              user_id: authData.user.id,
              role: 'client',
            })
          
          if (memberError) {
            console.error('Failed to create client membership:', memberError)
          }
        }
      } catch (err: any) {
        console.error('Error creating client:', err)
        // Don't fail user creation if client creation fails
      }
    }

    if (userError) {
      // If user record already exists (from trigger), update it
      const { data: updatedUser, error: updateError } = await regularSupabase
        .from('users')
        .update({ role: parsed.data.role })
        .eq('id', authData.user.id)
        .select()
        .single()

      if (updateError) {
        console.error('Failed to update user role:', updateError)
        return NextResponse.json(
          { error: `User created but failed to set role: ${updateError.message}` },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { 
          user: { ...authData.user, role: parsed.data.role },
          client: createdClient
        },
        { status: 201 }
      )
    }

    return NextResponse.json(
      { 
        user: { ...authData.user, role: parsed.data.role },
        client: createdClient
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    )
  }
}

