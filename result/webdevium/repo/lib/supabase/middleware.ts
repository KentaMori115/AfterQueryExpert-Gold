import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: any) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protect all routes except login, signup, auth pages, password reset, and onboarding
  const publicPaths = [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
    '/auth/confirm',
    '/onboarding'
  ]
  
  const isPublicPath = publicPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect to dashboard if already logged in and trying to access auth pages
  const authPages = ['/login', '/signup', '/forgot-password']
  if (user && authPages.includes(request.nextUrl.pathname)) {
    // Parallel: Check user role and membership at once for better performance
    const [{ data: userRecord }, { data: membership }] = await Promise.all([
      supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('client_members')
        .select('role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
    ])

    // If user record doesn't exist, it will be created via trigger with role='client'
    // ONLY check users.role for global admin/pm (not client_members.role which is per-client)
    if (userRecord && (userRecord.role === 'admin' || userRecord.role === 'pm')) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/dashboard'
      return NextResponse.redirect(url)
    }

    if (!membership) {
      // No client membership - redirect to onboarding
      // User has role='client' but needs to complete onboarding
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      return NextResponse.redirect(url)
    }

    // Regular client user with membership - redirect to client dashboard
    // Note: Even if client_members.role is 'admin' or 'pm', if users.role is 'client',
    // they should go to the client dashboard, not admin dashboard
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return response
}

