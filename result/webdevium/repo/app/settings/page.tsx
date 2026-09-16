'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Save, CheckCircle, XCircle, ExternalLink, Copy, Key, Webhook, AlertCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/user-context'

export default function SettingsPage() {
  // Use cached user data from context instead of fetching
  const { user, userRole, loading: userLoading } = useUser()
  const [loading, setLoading] = useState(true)
  const [stripeConfig, setStripeConfig] = useState({
    apiKeyStatus: 'unknown',
    webhookUrl: '',
    webhookSecretStatus: 'unknown',
    priceIds: {
      starter: '',
      growth: '',
      scale: '',
      dedicated: ''
    }
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const supabase = getBrowserSupabase()

  useEffect(() => {
    // Wait for user data to load
    if (userLoading) return

    async function load() {
      // Use cached user data from context
      if (!user) {
        router.push('/login')
        return
      }

      setLoading(true)
      try {

        // Load Stripe configuration
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
        setStripeConfig(prev => ({
          ...prev,
          webhookUrl: `${baseUrl}/api/stripe/webhook`
        }))

        // Check Stripe API status
        const statusRes = await fetch('/api/stripe/status')
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setStripeConfig(prev => ({
            ...prev,
            apiKeyStatus: statusData.apiKeyConfigured ? 'configured' : 'missing',
            webhookSecretStatus: statusData.webhookSecretConfigured ? 'configured' : 'missing',
            priceIds: statusData.priceIds || prev.priceIds
          }))
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase, router, user, userLoading])

  const isAdminOrPM = userRole === 'admin' || userRole === 'pm'

  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(stripeConfig.webhookUrl)
    setMessage({ type: 'success', text: 'Webhook URL copied to clipboard!' })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleTestWebhook = async () => {
    try {
      const response = await fetch('/api/stripe/test-webhook', {
        method: 'POST'
      })
      const data = await response.json()
      if (response.ok) {
        setMessage({ type: 'success', text: 'Webhook test successful!' })
      } else {
        setMessage({ type: 'error', text: data.error || 'Webhook test failed' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to test webhook' })
    }
    setTimeout(() => setMessage(null), 5000)
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Loading settings...</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your account settings and preferences</p>
        </div>

        {message && (
          <Card className={message.type === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                {message.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <p className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
                  {message.text}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" disabled />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed here. Contact support to update your email.
              </p>
            </div>
            <Button disabled>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Stripe Configuration - Admin/PM Only */}
        {isAdminOrPM && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CreditCard className="h-5 w-5" />
                <span>Stripe Configuration</span>
              </CardTitle>
              <CardDescription>
                Configure Stripe payment settings and webhooks
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* API Key Status */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center space-x-2">
                    <Key className="h-4 w-4" />
                    <span>Stripe API Key</span>
                  </Label>
                  <Badge 
                    variant={stripeConfig.apiKeyStatus === 'configured' ? 'success' : 'destructive'}
                  >
                    {stripeConfig.apiKeyStatus === 'configured' ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 mr-1" />
                        Missing
                      </>
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Configured via <code className="px-1 py-0.5 bg-muted rounded">STRIPE_SECRET_KEY</code> environment variable
                </p>
              </div>

              {/* Webhook Configuration */}
              <div className="space-y-2">
                <Label className="flex items-center space-x-2">
                  <Webhook className="h-4 w-4" />
                  <span>Webhook Endpoint URL</span>
                </Label>
                <div className="flex items-center space-x-2">
                  <Input 
                    value={stripeConfig.webhookUrl} 
                    readOnly 
                    className="font-mono text-sm"
                  />
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    title="Copy webhook URL"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={handleTestWebhook}
                    title="Test webhook"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add this URL to your Stripe Dashboard → Developers → Webhooks
                </p>
              </div>

              {/* Webhook Secret Status */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center space-x-2">
                    <Webhook className="h-4 w-4" />
                    <span>Webhook Secret</span>
                  </Label>
                  <Badge 
                    variant={stripeConfig.webhookSecretStatus === 'configured' ? 'success' : 'destructive'}
                  >
                    {stripeConfig.webhookSecretStatus === 'configured' ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 mr-1" />
                        Missing
                      </>
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Configured via <code className="px-1 py-0.5 bg-muted rounded">STRIPE_WEBHOOK_SECRET</code> environment variable
                </p>
              </div>

              {/* Price ID Mappings */}
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label>Price ID Mappings</Label>
                  <Badge variant="secondary">Read-only</Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(stripeConfig.priceIds).map(([plan, priceId]) => (
                    <div key={plan} className="space-y-2">
                      <Label htmlFor={`price-${plan}`} className="capitalize">
                        {plan} Plan
                      </Label>
                      <Input 
                        id={`price-${plan}`}
                        value={priceId || 'Not configured'}
                        readOnly
                        className="font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Price IDs are configured in your Stripe Dashboard and mapped in the codebase
                </p>
              </div>

              {/* Webhook Events */}
              <div className="space-y-2 border-t pt-4">
                <Label>Required Webhook Events</Label>
                <div className="space-y-2">
                  {[
                    'checkout.session.completed',
                    'customer.subscription.updated',
                    'customer.subscription.deleted',
                    'invoice.payment_succeeded'
                  ].map((event) => (
                    <div key={event} className="flex items-center space-x-2 p-2 bg-muted rounded">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <code className="text-sm">{event}</code>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Ensure these events are enabled in your Stripe webhook configuration
                </p>
              </div>

              {/* Stripe Dashboard Link */}
              <div className="border-t pt-4">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Stripe Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info for non-admin users */}
        {!isAdminOrPM && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Stripe configuration is only available to administrators and project managers.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
