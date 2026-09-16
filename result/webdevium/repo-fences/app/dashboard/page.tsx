'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Plus, CreditCard, Clock, CheckCircle, TrendingUp, AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { SubmitTaskDialog } from '@/components/tasks/submit-task-dialog'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/contexts/user-context'

type UsageStatus = 'On Track' | 'Approaching Limit' | 'Exceeded'

type RecentTask = {
  id: string
  title: string
  status: 'queued' | 'in_progress' | 'done'
  created_at: string
  completed_at: string | null
}

function useDashboardData() {
  const router = useRouter()
  const pathname = usePathname()
  // Use cached user data from context instead of fetching
  const { user, membership, clientId: contextClientId, userRole, loading: userLoading, isAdmin } = useUser()
  const [loading, setLoading] = useState(true)
  const [planName, setPlanName] = useState<string>('')
  const [usagePercent, setUsagePercent] = useState<number>(0)
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([])
  const [tasksCompletedThisMonth, setTasksCompletedThisMonth] = useState<number>(0)
  const [avgTurnaroundDays, setAvgTurnaroundDays] = useState<number>(0)
  const [valueDelivered, setValueDelivered] = useState<number>(0)

  // Memoize month start date to avoid recalculation
  const monthStart = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }, [])

  useEffect(() => {
    // Reset loading state when route changes
    setLoading(true)
    
    // Wait for user data to load
    if (userLoading) return

    let cancelled = false
    let supabase: ReturnType<typeof getBrowserSupabase> | null = null
    try {
      supabase = getBrowserSupabase()
    } catch (e) {
      console.error('Error loading dashboard data:', e)
      setLoading(false)
      return
    }
    
    async function load() {
      if (cancelled) return

      // Use cached user data from context
      if (!user || !membership?.client_id) {
        // Redirect to onboarding if no client (use client-side navigation)
        router.push('/onboarding')
        return
      }

      if (isAdmin || userRole === 'admin' || userRole === 'pm') {
        // Use client-side navigation instead of full page reload
        router.push('/admin/dashboard')
        return
      }

      setLoading(true)
      
      try {
        const clientId = membership.client_id

        // Parallel: Fetch all dashboard data at once
        const [usageRes, tasksRes, clientRes, statsRes, valueRes] = await Promise.all([
          supabase!.from('v_client_usage').select('hours_monthly,hours_used,pct_used').eq('client_id', clientId).maybeSingle(),
          supabase!.from('tasks').select('id,title,status,created_at,completed_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(10),
          supabase!.from('clients').select('plan_code, plans!inner(name)').eq('id', clientId).single(),
          supabase!.rpc('calculate_task_stats', { p_client_id: clientId }).maybeSingle(),
          // Calculate value delivered: sum of hours_spent for completed tasks this month
          supabase!.from('tasks')
            .select('hours_spent')
            .eq('client_id', clientId)
            .eq('status', 'done')
            .not('completed_at', 'is', null)
            .gte('completed_at', monthStart)
        ])

        if (cancelled) return

        if (usageRes.data) {
          setUsagePercent(Number(usageRes.data.pct_used ?? 0))
        }
        
        // Get plan name from clients query
        if (clientRes.data) {
          const planName = (clientRes.data as any).plans?.name
          const planCode = (clientRes.data as any).plan_code
          setPlanName(planName || planCode || '')
        }

        if (tasksRes.data) setRecentTasks(tasksRes.data as any)

        if (statsRes?.data) {
          setTasksCompletedThisMonth(Number((statsRes.data as any).completed_this_month ?? 0))
          setAvgTurnaroundDays(Number(((statsRes.data as any).avg_turnaround_days ?? 0)))
        }

        // Calculate value delivered (total hours spent on completed tasks this month)
        if (valueRes?.data) {
          const totalHours = (valueRes.data as any[]).reduce((sum, task) => {
            return sum + (Number(task.hours_spent) || 0)
          }, 0)
          setValueDelivered(totalHours)
        }
      } catch (error) {
        console.error('Error loading dashboard:', error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    
    load()
    
    return () => {
      cancelled = true
    }
  }, [router, pathname, monthStart, user, membership, userLoading, isAdmin, userRole])

  const usageStatus: UsageStatus = useMemo(() => {
    if (usagePercent >= 100) return 'Exceeded'
    if (usagePercent >= 80) return 'Approaching Limit'
    return 'On Track'
  }, [usagePercent])

  return {
    loading: loading || userLoading,
    clientId: contextClientId,
    planName,
    usagePercent,
    usageStatus,
    recentTasks,
    tasksCompletedThisMonth,
    avgTurnaroundDays,
    valueDelivered,
  }
}

function UsageMeter({ usagePercent, usageStatus, router }: { usagePercent: number; usageStatus: UsageStatus; router: any }) {
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'On Track': return 'success'
      case 'Approaching Limit': return 'warning'
      case 'Exceeded': return 'destructive'
      default: return 'default'
    }
  }

  const getProgressColor = (usage: number) => {
    if (usage >= 100) return 'bg-red-500'
    if (usage >= 80) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Monthly Usage
          <Badge variant={getStatusColor(usageStatus) as any}>
            {usageStatus}
          </Badge>
        </CardTitle>
        <CardDescription>
          Your development capacity for this month
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between text-sm">
            <span>Used</span>
            <span>{usagePercent}% of plan capacity</span>
          </div>
          <Progress value={Math.min(usagePercent, 100)} className="h-3" />
          {usagePercent >= 80 && (
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="text-sm font-semibold text-yellow-900">
                    {usagePercent >= 100 ? 'Usage Limit Exceeded' : 'Approaching Usage Limit'}
                  </p>
                  <p className="text-xs text-yellow-700 mt-1">
                    {usagePercent >= 100 
                      ? 'You\'ve exceeded your plan capacity. Upgrade to continue receiving service.'
                      : 'You\'re at ' + Math.round(usagePercent) + '% of your plan capacity. Consider upgrading for more hours.'}
                  </p>
                </div>
              </div>
              <Button 
                onClick={() => router.push('/billing')}
                size="sm"
                className="bg-yellow-600 hover:bg-yellow-700 text-white"
              >
                Upgrade Plan
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StatsCards({ planName, tasksCompleted, avgTurnaround, valueDelivered }: { planName: string; tasksCompleted: number; avgTurnaround: number; valueDelivered: number }) {

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tasks Completed</CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{tasksCompleted}</div>
          <p className="text-xs text-muted-foreground">This month</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Turnaround</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{avgTurnaround.toFixed(1)} days</div>
          <p className="text-xs text-muted-foreground">Per task</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Value Delivered</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{valueDelivered.toFixed(1)}h</div>
          <p className="text-xs text-muted-foreground">This month</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Plan</CardTitle>
          <Badge variant="secondary" className="text-xs">{planName || '—'}</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-sm font-medium">{planName || 'No plan'}</div>
          <p className="text-xs text-muted-foreground">Current subscription</p>
        </CardContent>
      </Card>
    </div>
  )
}

const RecentActivity = ({ tasks }: { tasks: RecentTask[] }) => {
  // Memoize formatted dates to avoid recalculation on every render
  const taskList = useMemo(() => {
    return tasks.map((task) => {
      let dateStr = ''
      if (task.status === 'done' && task.completed_at) {
        dateStr = `Completed ${new Date(task.completed_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`
      } else if (task.status === 'in_progress' && task.created_at) {
        dateStr = `In progress since ${new Date(task.created_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`
      } else if (task.status === 'queued' && task.created_at) {
        dateStr = `Queued ${new Date(task.created_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`
      }
      
      return {
        ...task,
        formattedDate: dateStr || (task.status === 'done' ? 'Completed' : ''),
      }
    })
  }, [tasks])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Your latest task updates</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {taskList.map((task) => (
            <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex-1">
                <p className="font-medium">{task.title}</p>
                <p className="text-sm text-muted-foreground">{task.formattedDate}</p>
              </div>
              <Badge 
                variant={task.status === 'done' ? 'success' : task.status === 'in_progress' ? 'default' : 'secondary'}
              >
                {task.status === 'done' ? 'Completed' : task.status === 'in_progress' ? 'In Progress' : 'Queued'}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { loading, clientId, usagePercent, usageStatus, recentTasks, planName, tasksCompletedThisMonth, avgTurnaroundDays, valueDelivered } = useDashboardData()
  const [submitTaskOpen, setSubmitTaskOpen] = useState(false)
  const router = useRouter()

  if (loading) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading dashboard...</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-bold">Welcome back</h1>
            <p className="text-muted-foreground">Here's what's happening with your projects</p>
          </div>
          <div className="flex space-x-2">
            <Button onClick={() => setSubmitTaskOpen(true)} disabled={!clientId}>
              <Plus className="h-4 w-4 mr-2" />
              Submit New Task
            </Button>
            <Button variant="outline" onClick={() => router.push('/billing')}>
              <CreditCard className="h-4 w-4 mr-2" />
              Manage Billing
            </Button>
          </div>
        </div>

        {/* Submit Task Dialog */}
        {clientId && (
          <SubmitTaskDialog 
            isOpen={submitTaskOpen}
            onClose={() => setSubmitTaskOpen(false)}
            clientId={clientId}
          />
        )}

        {/* Usage Meter */}
        <UsageMeter usagePercent={usagePercent} usageStatus={usageStatus} router={router} />

        {/* Stats Cards */}
        <StatsCards planName={planName} tasksCompleted={tasksCompletedThisMonth} avgTurnaround={avgTurnaroundDays} valueDelivered={valueDelivered} />

        {/* Recent Activity */}
        <RecentActivity tasks={recentTasks} />
      </div>
    </DashboardLayout>
  )
}
