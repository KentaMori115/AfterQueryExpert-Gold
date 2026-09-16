'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { CreditCard, Download, Calendar, DollarSign, AlertTriangle, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/contexts/user-context'

export default function BillingPage() {
  // Use cached user data from context instead of fetching
  const { membership, clientId: contextClientId, loading: userLoading } = useUser()
  const [loading, setLoading] = useState(true)
  const [planName, setPlanName] = useState<string>('')
  const [usagePercent, setUsagePercent] = useState<number>(0)
  const [hoursUsed, setHoursUsed] = useState<number>(0)
  const [hoursMonthly, setHoursMonthly] = useState<number>(0)
  const [cycleStart, setCycleStart] = useState<string>('')
  const [portalLoading, setPortalLoading] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = getBrowserSupabase()

  useEffect(() => {
    // Reset loading state when route changes
    setLoading(true)
    
    // Wait for user data to load
    if (userLoading) return

    async function load() {
      // Use cached user data from context
      if (!membership?.client_id) {
        router.push('/onboarding')
        return
      }

      setLoading(true)
      try {
        const clientId = membership.client_id

        // Parallel: Fetch usage and client data
        const [usageRes, clientRes] = await Promise.all([
          supabase
            .from('v_client_usage')
            .select('hours_monthly,hours_used,pct_used')
            .eq('client_id', membership.client_id)
            .maybeSingle(),
          supabase
            .from('clients')
            .select('plan_code, cycle_start, plans!inner(name)')
            .eq('id', membership.client_id)
            .single()
        ])

        if (usageRes.data) {
          setUsagePercent(Number(usageRes.data.pct_used ?? 0))
          setHoursUsed(Number(usageRes.data.hours_used ?? 0))
          setHoursMonthly(Number(usageRes.data.hours_monthly ?? 0))
        }

        if (clientRes.data) {
          setPlanName((clientRes.data as any).plans?.name || (clientRes.data as any).plan_code || '')
          setCycleStart((clientRes.data as any).cycle_start || '')
        }
      } catch (e) {
        console.error('Failed to load billing data:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      // Cleanup on unmount or dependency change
    }
  }, [supabase, router, pathname, membership, userLoading])

  const handlePortalClick = async () => {
    setPortalLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
      })
      const data = await response.json()
      
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Failed to open billing portal')
      }
    } catch (error) {
      console.error('Portal error:', error)
      alert('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  const getUsageStatus = () => {
    if (usagePercent >= 100) return { label: 'Exceeded', variant: 'destructive' as const }
    if (usagePercent >= 80) return { label: 'Approaching Limit', variant: 'warning' as const }
    return { label: 'On Track', variant: 'success' as const }
  }

  const usageStatus = getUsageStatus()
  const nextCycleDate = cycleStart ? new Date(cycleStart) : null
  if (nextCycleDate) {
    nextCycleDate.setMonth(nextCycleDate.getMonth() + 1)
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Billing & Subscription</h1>
          <p className="text-muted-foreground">Manage your subscription and billing information</p>
        </div>

        {loading || userLoading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Loading billing information...</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Current Plan</CardTitle>
                  <CardDescription>Your active subscription details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{planName || 'No Plan'}</span>
                    <Badge variant="success">Active</Badge>
                  </div>
                  {nextCycleDate && (
                    <p className="text-sm text-muted-foreground">
                      Next billing date: {nextCycleDate.toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </p>
                  )}
                  <Button 
                    className="w-full" 
                    onClick={handlePortalClick}
                    disabled={portalLoading}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {portalLoading ? 'Opening...' : 'Manage Subscription'}
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Usage This Month
                    <Badge variant={usageStatus.variant}>{usageStatus.label}</Badge>
                  </CardTitle>
                  <CardDescription>Your development capacity usage</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-2xl font-bold">{Math.round(usagePercent)}%</div>
                  <p className="text-sm text-muted-foreground">
                    {Math.round(hoursUsed)} hours used of {hoursMonthly} hours available
                  </p>
                  <Progress value={Math.min(usagePercent, 100)} className="h-3" />
                  {nextCycleDate && (
                    <p className="text-xs text-muted-foreground">
                      Resets on {nextCycleDate.toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Upgrade Nudge */}
            {usagePercent >= 80 && (
              <Card className="border-yellow-200 bg-gradient-to-r from-yellow-50 to-orange-50">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <AlertTriangle className="h-6 w-6 text-yellow-600" />
                      <div>
                        <p className="font-semibold text-yellow-900">
                          {usagePercent >= 100 ? 'Usage Limit Exceeded' : 'Approaching Usage Limit'}
                        </p>
                        <p className="text-sm text-yellow-700 mt-1">
                          {usagePercent >= 100 
                            ? 'You\'ve exceeded your plan capacity. Upgrade to continue receiving service.'
                            : `You're at ${Math.round(usagePercent)}% of your plan capacity. Consider upgrading for more hours.`}
                        </p>
                      </div>
                    </div>
                    <Button 
                      onClick={handlePortalClick}
                      size="sm"
                      className="bg-yellow-600 hover:bg-yellow-700 text-white"
                      disabled={portalLoading}
                    >
                      Upgrade Plan
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Billing Portal</CardTitle>
                <CardDescription>Access your Stripe customer portal to manage subscriptions, invoices, and payment methods</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={handlePortalClick}
                  disabled={portalLoading}
                  className="w-full md:w-auto"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {portalLoading ? 'Opening Portal...' : 'Open Customer Portal'}
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
                <p className="text-sm text-muted-foreground mt-4">
                  In the portal, you can update your payment method, view invoices, download receipts, and change your subscription plan.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
