'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Users, AlertTriangle, Clock, TrendingUp, Plus, X, Trash2, CreditCard, ExternalLink, Link2, Unlink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Client = {
  id: string
  name: string
  plan_code: string
  hours_monthly: number
  hours_used_month: number
  cycle_start: string
  owner_user_id: string
  plan_name?: string
  usage_percent?: number
  risk_flag?: 'low' | 'medium' | 'high'
  stripe_customer_id?: string | null
}

type Plan = {
  code: string
  name: string
  hours_monthly: number
}

type ClientFormSubmit = {
  name: string
  plan_code: string
  hours_monthly: number
  cycle_start: string
  hours_used_month?: number
}

interface ClientModalProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  plans: Plan[]
  client?: Client | null
  onClose: () => void
  onSubmit: (values: ClientFormSubmit) => Promise<void>
  onDelete?: () => Promise<void>
}

function ClientModal({
  isOpen,
  mode,
  plans,
  client,
  onClose,
  onSubmit,
  onDelete,
}: ClientModalProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const defaultPlan = useMemo(() => plans[0] ?? null, [plans])
  const [name, setName] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [hoursMonthly, setHoursMonthly] = useState('')
  const [cycleStart, setCycleStart] = useState(today)
  const [hoursUsed, setHoursUsed] = useState('0')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('')
  const [stripeInfo, setStripeInfo] = useState<any>(null)
  const [loadingStripe, setLoadingStripe] = useState(false)
  const [stripeError, setStripeError] = useState<string | null>(null)

  const loadStripeInfo = useCallback(async (clientId: string) => {
    setLoadingStripe(true)
    setStripeError(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/stripe`)
      const data = await response.json()
      if (response.ok) {
        setStripeInfo(data)
        setStripeCustomerId(data.stripe_customer_id || '')
      } else {
        setStripeError(data.error || 'Failed to load Stripe info')
      }
    } catch (err: any) {
      setStripeError(err.message || 'Failed to load Stripe info')
    } finally {
      setLoadingStripe(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    setName(client?.name ?? '')
    const initialPlanCode = client?.plan_code ?? defaultPlan?.code ?? ''
    setPlanCode(initialPlanCode)
    if (client) {
      setHoursMonthly(client.hours_monthly.toString())
      setCycleStart(client.cycle_start ?? today)
      setHoursUsed((client.hours_used_month ?? 0).toString())
      setStripeCustomerId(client.stripe_customer_id || '')
      // Load Stripe info if customer ID exists
      if (client.stripe_customer_id) {
        loadStripeInfo(client.id)
      } else {
        setStripeInfo(null)
      }
    } else {
      setHoursMonthly((defaultPlan?.hours_monthly ?? 40).toString())
      setCycleStart(today)
      setHoursUsed('0')
      setStripeCustomerId('')
      setStripeInfo(null)
    }
    setError(null)
    setStripeError(null)
  }, [client, defaultPlan, isOpen, today, loadStripeInfo])

  const handleLinkStripe = async () => {
    if (!client || !stripeCustomerId.trim()) {
      setStripeError('Please enter a Stripe customer ID')
      return
    }

    setLoadingStripe(true)
    setStripeError(null)
    try {
      const response = await fetch(`/api/admin/clients/${client.id}/stripe`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripe_customer_id: stripeCustomerId.trim() }),
      })
      const data = await response.json()
      if (response.ok) {
        await loadStripeInfo(client.id)
      } else {
        setStripeError(data.error || 'Failed to link Stripe customer')
      }
    } catch (err: any) {
      setStripeError(err.message || 'Failed to link Stripe customer')
    } finally {
      setLoadingStripe(false)
    }
  }

  const handleUnlinkStripe = async () => {
    if (!client) return
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Unlink Stripe customer? This will remove the connection but not delete the customer in Stripe.')
      : true
    if (!confirmed) return

    setLoadingStripe(true)
    setStripeError(null)
    try {
      const response = await fetch(`/api/admin/clients/${client.id}/stripe`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripe_customer_id: null }),
      })
      const data = await response.json()
      if (response.ok) {
        setStripeInfo(null)
        setStripeCustomerId('')
      } else {
        setStripeError(data.error || 'Failed to unlink Stripe customer')
      }
    } catch (err: any) {
      setStripeError(err.message || 'Failed to unlink Stripe customer')
    } finally {
      setLoadingStripe(false)
    }
  }

  const handleOpenStripePortal = async () => {
    if (!client) return
    setLoadingStripe(true)
    setStripeError(null)
    try {
      const response = await fetch(`/api/admin/clients/${client.id}/stripe`, {
        method: 'POST',
      })
      const data = await response.json()
      if (response.ok && data.url) {
        window.open(data.url, '_blank')
      } else {
        setStripeError(data.error || 'Failed to open Stripe portal')
      }
    } catch (err: any) {
      setStripeError(err.message || 'Failed to open Stripe portal')
    } finally {
      setLoadingStripe(false)
    }
  }

  if (!isOpen) return null

  const handlePlanChange = (value: string) => {
    setPlanCode(value)
    const planMatch = plans.find((p) => p.code === value)
    if (planMatch) {
      setHoursMonthly(planMatch.hours_monthly.toString())
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Client name is required')
      return
    }

    if (!planCode) {
      setError('Please select a plan')
      return
    }

    const hoursValue = Number(hoursMonthly)
    if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
      setError('Monthly hours must be greater than zero')
      return
    }

    const payload: ClientFormSubmit = {
      name: trimmedName,
      plan_code: planCode,
      hours_monthly: hoursValue,
      cycle_start: cycleStart || today,
    }

    if (mode === 'edit') {
      const parsedHoursUsed = Number(hoursUsed)
      if (!Number.isFinite(parsedHoursUsed) || parsedHoursUsed < 0) {
        setError('Hours used must be zero or positive')
        return
      }
      payload.hours_used_month = parsedHoursUsed
    }

    try {
      setSaving(true)
      await onSubmit(payload)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save client')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setError(null)
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Delete this client? This will also remove related tasks and usage.')
      : true

    if (!confirmed) return

    try {
      setDeleting(true)
      await onDelete()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to delete client')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-xl shadow-2xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-xl">
              {mode === 'create' ? 'Add Client' : 'Edit Client'}
            </CardTitle>
            <CardDescription>
              {mode === 'create'
                ? 'Create a new client and set starting capacity'
                : 'Update billing details or remove the client'}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={saving || deleting}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="client-name">Client Name</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Corp"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-plan">Plan</Label>
                <select
                  id="client-plan"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={planCode}
                  onChange={(event) => handlePlanChange(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a plan
                  </option>
                  {plans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name} ({plan.hours_monthly}h)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="client-hours">Monthly Hours</Label>
                <Input
                  id="client-hours"
                  type="number"
                  min={1}
                  value={hoursMonthly}
                  onChange={(event) => setHoursMonthly(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-cycle">Cycle Start</Label>
                <Input
                  id="client-cycle"
                  type="date"
                  value={cycleStart}
                  onChange={(event) => setCycleStart(event.target.value)}
                  required
                />
              </div>

              {mode === 'edit' && (
                <div className="space-y-2">
                  <Label htmlFor="client-hours-used">Hours Used (this month)</Label>
                  <Input
                    id="client-hours-used"
                    type="number"
                    min={0}
                    step="0.1"
                    value={hoursUsed}
                    onChange={(event) => setHoursUsed(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Adjust usage if you need to reconcile billing.
                  </p>
                </div>
              )}
            </div>

            {/* Stripe Management Section - Only in Edit Mode */}
            {mode === 'edit' && client && (
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center space-x-2">
                  <CreditCard className="h-5 w-5" />
                  <Label className="text-base font-semibold">Stripe Settings</Label>
                </div>

                {stripeError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {stripeError}
                  </div>
                )}

                {loadingStripe ? (
                  <div className="text-sm text-muted-foreground">Loading Stripe info...</div>
                ) : stripeInfo?.has_stripe && stripeInfo.customer ? (
                  <div className="space-y-3">
                    <div className="rounded-md border bg-muted/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Stripe Customer ID</span>
                        <Badge variant="secondary">{stripeInfo.stripe_customer_id}</Badge>
                      </div>
                      {stripeInfo.customer.email && (
                        <div className="text-sm text-muted-foreground">
                          Email: {stripeInfo.customer.email}
                        </div>
                      )}
                      {stripeInfo.subscriptions && stripeInfo.subscriptions.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Active Subscriptions:</div>
                          {stripeInfo.subscriptions.map((sub: any) => (
                            <div key={sub.id} className="text-xs text-muted-foreground pl-2">
                              • {sub.status} - {new Date(sub.current_period_end * 1000).toLocaleDateString()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOpenStripePortal}
                        disabled={loadingStripe}
                        className="flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open Stripe Portal
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleUnlinkStripe}
                        disabled={loadingStripe}
                        className="flex items-center gap-2"
                      >
                        <Unlink className="h-4 w-4" />
                        Unlink
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      No Stripe customer linked to this client.
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="cus_..."
                        value={stripeCustomerId}
                        onChange={(e) => setStripeCustomerId(e.target.value)}
                        className="font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleLinkStripe}
                        disabled={loadingStripe || !stripeCustomerId.trim()}
                        className="flex items-center gap-2"
                      >
                        <Link2 className="h-4 w-4" />
                        Link Customer
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter a Stripe customer ID (e.g., cus_xxx) to link this client to a Stripe customer.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {mode === 'edit' && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={saving || deleting}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Deleting...' : 'Delete Client'}
                </Button>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={saving || deleting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || deleting}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function AdminClientsPage() {
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [userRole, setUserRole] = useState<'admin' | 'pm' | 'dev' | 'client' | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [clientToManage, setClientToManage] = useState<Client | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = getBrowserSupabase()

  const loadData = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      // Get user first, then fetch memberships
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // Get memberships
      const { data: memberships, error: membershipsError } = await supabase
        .from('client_members')
        .select('role')
        .eq('user_id', user.id)

      if (membershipsError) {
        throw membershipsError
      }

      const isAdminOrPM = memberships?.some((m) => m.role === 'admin' || m.role === 'pm')
      if (!isAdminOrPM) {
        router.push('/dashboard')
        return
      }

      const adminOrPMMembership = memberships?.find((m) => m.role === 'admin' || m.role === 'pm')
      if (adminOrPMMembership) {
        setUserRole(adminOrPMMembership.role as 'admin' | 'pm')
      }

      // Parallel: Fetch clients and plans together
      const [
        { data: clientsData, error: clientsError },
        { data: plansData, error: plansError },
      ] = await Promise.all([
        supabase
          .from('clients')
          .select(
            `
            id,
            name,
            plan_code,
            cycle_start,
            owner_user_id,
            hours_monthly,
            hours_used_month,
            stripe_customer_id,
            plans(name)
          `
          )
          .order('name'),
        supabase.from('plans').select('code, name, hours_monthly').order('hours_monthly'),
      ])

      if (clientsError) {
        throw clientsError
      }
      if (plansError) {
        throw plansError
      }

      if (plansData) {
        setPlans(plansData as Plan[])
      }

      if (clientsData) {
        const clientArray = clientsData as any[]
        const clientIds = clientArray.map((c) => c.id).filter(Boolean)

        // Fetch usage data in parallel if we have clients
        let usageMap = new Map<string, { hours_used: number; pct_used: number }>()
        if (clientIds.length > 0) {
          const { data: usageData, error: usageError } = await supabase
            .from('v_client_usage')
            .select('client_id, hours_used, pct_used')
            .in('client_id', clientIds)

          if (usageError) {
            throw usageError
          }

          if (usageData) {
            usageMap = new Map(
              usageData.map((u: any) => [
                u.client_id,
                {
                  hours_used: Number(u.hours_used || 0),
                  pct_used: Number(u.pct_used || 0),
                },
              ])
            )
          }
        }

        const formattedClients: Client[] = clientArray.map((c: any) => {
          const usage = usageMap.get(c.id) || { hours_used: Number(c.hours_used_month || 0), pct_used: 0 }
          const usagePercent = usage.pct_used
          const planName = c.plans?.name || c.plan_code

          let riskFlag: 'low' | 'medium' | 'high' = 'low'
          if (usagePercent >= 100) riskFlag = 'high'
          else if (usagePercent >= 80) riskFlag = 'medium'

          return {
            id: c.id,
            name: c.name,
            plan_code: c.plan_code,
            hours_monthly: Number(c.hours_monthly || 0),
            hours_used_month: Number(usage.hours_used || 0),
            cycle_start: c.cycle_start,
            owner_user_id: c.owner_user_id,
            plan_name: planName,
            usage_percent: usagePercent,
            risk_flag: riskFlag,
            stripe_customer_id: c.stripe_customer_id || null,
          }
        })

        setClients(formattedClients)
      }
    } catch (e: any) {
      console.error('Failed to load clients:', e)
      setPageError(e.message || 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }, [router, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreateClient = useCallback(
    async (values: ClientFormSubmit) => {
      const response = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to create client')
      }

      await loadData()
    },
    [loadData]
  )

  const handleUpdateClient = useCallback(
    async (clientId: string, values: ClientFormSubmit) => {
      const response = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to update client')
      }

      await loadData()
    },
    [loadData]
  )

  const handleDeleteClient = useCallback(
    async (clientId: string) => {
      const response = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to delete client')
      }

      await loadData()
    },
    [loadData]
  )

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case 'high': return 'destructive'
      case 'medium': return 'warning'
      default: return 'success'
    }
  }

  const getNextResetDate = (cycleStart: string) => {
    const start = new Date(cycleStart)
    start.setMonth(start.getMonth() + 1)
    return start
  }

  if (loading) {
    return (
      <DashboardLayout isAdmin={true}>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading clients...</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout isAdmin={true}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Clients</h1>
            <p className="text-muted-foreground">Manage all clients and monitor usage</p>
          </div>
          <Button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2"
            disabled={plans.length === 0}
          >
            <Plus className="h-4 w-4" />
            Add Client
          </Button>
        </div>

        {pageError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {pageError}
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clients.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">At Risk</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {clients.filter(c => c.risk_flag === 'high' || c.risk_flag === 'medium').length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Hours Used</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {clients.reduce((sum, c) => sum + c.hours_used_month, 0).toFixed(1)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Usage</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {clients.length > 0 
                  ? (clients.reduce((sum, c) => sum + (c.usage_percent || 0), 0) / clients.length).toFixed(1)
                  : '0'}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Clients List */}
        <Card>
          <CardHeader>
            <CardTitle>All Clients</CardTitle>
            <CardDescription>Internal view: hours used and capacity tracking</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {clients.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No clients found</p>
                </div>
              ) : (
                clients.map((client) => {
                  const nextReset = getNextResetDate(client.cycle_start)
                  const daysUntilReset = Math.ceil((nextReset.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  
                  return (
                    <div key={client.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="font-semibold text-lg">{client.name}</h3>
                            <Badge variant="secondary">{client.plan_name}</Badge>
                            <Badge variant={getRiskBadgeVariant(client.risk_flag || 'low')}>
                              {client.risk_flag === 'high' ? 'High Risk' : 
                               client.risk_flag === 'medium' ? 'At Risk' : 'On Track'}
                            </Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Hours Used</p>
                              <p className="text-sm font-medium">
                                {client.hours_used_month.toFixed(1)} / {client.hours_monthly}
                              </p>
                            </div>
                            
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Usage %</p>
                              <p className="text-sm font-medium">{client.usage_percent?.toFixed(1) || 0}%</p>
                            </div>
                            
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Reset Date</p>
                              <p className="text-sm font-medium">
                                {nextReset.toLocaleDateString('en-US', { 
                                  month: 'short', 
                                  day: 'numeric' 
                                })}
                              </p>
                            </div>
                            
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Days Until Reset</p>
                              <p className="text-sm font-medium">{daysUntilReset} days</p>
                            </div>
                          </div>

                          <div className="mt-3">
                            <Progress 
                              value={Math.min(client.usage_percent || 0, 100)} 
                              className="h-2"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/admin/tasks?clientId=${client.id}`)}
                          >
                            View Tasks
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setClientToManage(client)}
                          >
                            Manage
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {createModalOpen && (
        <ClientModal
          isOpen={createModalOpen}
          mode="create"
          plans={plans}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={handleCreateClient}
        />
      )}

      {clientToManage && (
        <ClientModal
          isOpen={!!clientToManage}
          mode="edit"
          plans={plans}
          client={clientToManage}
          onClose={() => setClientToManage(null)}
          onSubmit={(values) => handleUpdateClient(clientToManage.id, values)}
          onDelete={() => handleDeleteClient(clientToManage.id)}
        />
      )}
    </DashboardLayout>
  )
}

