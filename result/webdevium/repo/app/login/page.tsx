'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { clearUserCache } from '@/contexts/user-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = getBrowserSupabase()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Clear user cache before login so the new session loads fresh (no previous user info)
    clearUserCache()

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
        return
      }

      if (data.user) {
        // Ensure user record exists with role='client' if not admin/pm
        let { data: userRecord } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle()

        // If user record doesn't exist, create it with role='client'
        if (!userRecord) {
          const { error: createError } = await supabase
            .from('users')
            .insert({
              id: data.user.id,
              email: data.user.email || '',
              role: 'client', // Default role is 'client', not 'user'
            })
          
          if (!createError) {
            userRecord = { role: 'client' }
          }
        }

        // ONLY check users.role for global admin/pm (not client_members.role which is per-client)
        if (userRecord && (userRecord.role === 'admin' || userRecord.role === 'pm')) {
          // Full page navigation so app remounts with new user (no previous user info)
          window.location.href = `${window.location.origin}/admin/dashboard`
          return
        }

        // For client users, check if they have a client membership
        const { data: membership } = await supabase
          .from('client_members')
          .select('role')
          .eq('user_id', data.user.id)
          .limit(1)
          .maybeSingle()

        if (!membership) {
          // No client membership - redirect to onboarding
          // User has role='client' but needs to complete onboarding
          window.location.href = `${window.location.origin}/onboarding`
          return
        }

        // Regular client user with membership - redirect to client dashboard
        // Full page navigation so app remounts with new user (no previous user info)
        window.location.href = `${window.location.origin}/dashboard`
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>
            Enter your credentials to access your dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a 
                  href="/forgot-password" 
                  className="text-xs text-blue-600 hover:underline"
                >
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>

            <div className="text-center text-sm text-gray-600">
              Don't have an account?{' '}
              <a href="/signup" className="text-blue-600 hover:underline">
                Sign up
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

