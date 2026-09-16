'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Sparkles } from 'lucide-react'

export default function OnboardingPage() {
  const [companyName, setCompanyName] = useState('')
  const [plan, setPlan] = useState<'starter' | 'growth' | 'scale' | 'dedicated'>('growth')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [checkingClient, setCheckingClient] = useState(true)
  const router = useRouter()
  const supabase = getBrowserSupabase()

  useEffect(() => {
    async function checkForExistingClient() {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        setUserId(user.id)

        // Check if user already has a client
        const { data: membership } = await supabase
          .from('client_members')
          .select('client_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (membership?.client_id) {
          // User already has a client, redirect to dashboard
          router.push('/dashboard')
        }
      } catch (e) {
        console.error('Error checking client:', e)
      } finally {
        setCheckingClient(false)
      }
    }

    checkForExistingClient()
  }, [supabase, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) {
      setError('User ID not found. Please refresh and try again.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Debug: Log user ID
      console.log('Creating client for user:', userId)
      // Get plan details
      const planDetails: Record<string, { hours: number; name: string }> = {
        starter: { hours: 40, name: 'Starter' },
        growth: { hours: 80, name: 'Growth' },
        scale: { hours: 120, name: 'Scale' },
        dedicated: { hours: 160, name: 'Dedicated' },
      }

      const selectedPlan = planDetails[plan]

      // Step 0: Ensure user exists in public.users table
      // Get user email from auth
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        throw new Error('User not authenticated')
      }

      // Check if user exists in public.users, create if not
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle()

      if (!existingUser) {
        // Create user record in public.users
        const { error: userError } = await supabase
          .from('users')
          .insert({
            id: userId,
            email: authUser.email || '',
            role: 'client', // Default role, can be changed later
          })

        if (userError) {
          console.error('User creation error:', userError)
          throw new Error(`Failed to create user record: ${userError.message}`)
        }
      }

      // Step 1: Create client
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: companyName,
          owner_user_id: userId,
          plan_code: plan,
          hours_monthly: selectedPlan.hours,
          hours_used_month: 0,
          cycle_start: new Date().toISOString().split('T')[0],
        })
        .select('*')
        .single()

      if (clientError) {
        console.error('Client creation error:', clientError)
        console.error('Client error details:', {
          code: clientError.code,
          message: clientError.message,
          details: clientError.details,
          hint: clientError.hint
        })
        throw new Error(`Failed to create company: ${clientError.message}. Make sure you've run the RLS policy fix in Supabase SQL Editor. See supabase/RUN-THIS-FIRST.sql`)
      }

      if (!client) {
        throw new Error('Failed to create client')
      }

      // Step 2: Link user to client (MUST complete before creating tasks)
      const { error: memberError } = await supabase
        .from('client_members')
        .insert({
          client_id: client.id,
          user_id: userId,
          role: 'client',
        })

      if (memberError) {
        console.error('Membership creation error:', memberError)
        throw new Error(`Failed to create membership: ${memberError.message}`)
      }

      // Small delay to ensure membership is committed
      await new Promise(resolve => setTimeout(resolve, 100))

      // Step 3: Create a welcome task (only after membership exists)
      const { error: taskError } = await supabase.from('tasks').insert({
        client_id: client.id,
        title: '🎉 Welcome to Webdevium!',
        description: 'We\'re excited to work with you. This is your first task - feel free to delete it or replace it with your actual needs.',
        priority: 'medium',
        status: 'queued',
      })

      if (taskError) {
        console.error('Welcome task creation error:', taskError)
        // Don't throw - client and membership were created successfully
      }

      // Success! Redirect to dashboard
      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (checkingClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">Welcome to Webdevium!</CardTitle>
          <CardDescription className="text-base">
            Let's set up your account to get started with your development projects
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="companyName" className="text-base font-semibold">
                Company Name *
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <Input
                  id="companyName"
                  type="text"
                  placeholder="e.g. Acme Inc, My Startup, etc."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  disabled={loading}
                  className="pl-10 h-12"
                  minLength={2}
                  maxLength={100}
                />
              </div>
              <p className="text-xs text-gray-500">
                This is how we'll refer to your organization
              </p>
            </div>

            {/* Plan Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Select Your Plan *</Label>
              <p className="text-sm text-gray-600">
                Choose based on your development capacity needs (you can upgrade later)
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Starter Plan */}
                <button
                  type="button"
                  onClick={() => setPlan('starter')}
                  disabled={loading}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    plan === 'starter'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="font-semibold text-lg">Starter</div>
                  <div className="text-2xl font-bold text-blue-600">40 hrs/mo</div>
                  <div className="text-xs text-gray-500 mt-1">Perfect for small projects</div>
                </button>

                {/* Growth Plan */}
                <button
                  type="button"
                  onClick={() => setPlan('growth')}
                  disabled={loading}
                  className={`p-4 rounded-lg border-2 text-left transition-all relative ${
                    plan === 'growth'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded">
                    Popular
                  </div>
                  <div className="font-semibold text-lg">Growth</div>
                  <div className="text-2xl font-bold text-blue-600">80 hrs/mo</div>
                  <div className="text-xs text-gray-500 mt-1">Great for growing teams</div>
                </button>

                {/* Scale Plan */}
                <button
                  type="button"
                  onClick={() => setPlan('scale')}
                  disabled={loading}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    plan === 'scale'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="font-semibold text-lg">Scale</div>
                  <div className="text-2xl font-bold text-blue-600">120 hrs/mo</div>
                  <div className="text-xs text-gray-500 mt-1">More capacity & priority</div>
                </button>

                {/* Dedicated Plan */}
                <button
                  type="button"
                  onClick={() => setPlan('dedicated')}
                  disabled={loading}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    plan === 'dedicated'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="font-semibold text-lg">Dedicated</div>
                  <div className="text-2xl font-bold text-blue-600">160 hrs/mo</div>
                  <div className="text-xs text-gray-500 mt-1">Full development pod</div>
                </button>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold"> What happens next?</span>
                <br />
                Once you complete setup, you'll be able to submit tasks, track progress, and see your development capacity in real-time.
              </p>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading || !companyName.trim()}
              className="w-full h-12 text-base font-semibold"
              size="lg"
            >
              {loading ? 'Setting up your account...' : 'Complete Setup & Go to Dashboard'}
            </Button>

            {/* Footer Note */}
            <p className="text-xs text-center text-gray-500">
              By continuing, you agree to our terms of service and privacy policy
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

