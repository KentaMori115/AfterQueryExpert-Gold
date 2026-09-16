'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Users, CheckSquare, Clock, TrendingUp, AlertTriangle, Activity, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/contexts/user-context'

type ClientSummary = {
  total: number
  atRisk: number
  totalHoursUsed: number
  avgUsagePercent: number
}

type TaskSummary = {
  total: number
  queued: number
  inProgress: number
  done: number
}

export default function AdminDashboardPage() {
  // Use cached user data from context instead of fetching
  const { user, isAdmin: isUserAdmin, loading: userLoading, userRole } = useUser()
  const [loading, setLoading] = useState(true)
  const [clientSummary, setClientSummary] = useState<ClientSummary>({
    total: 0,
    atRisk: 0,
    totalHoursUsed: 0,
    avgUsagePercent: 0,
  })
  const [taskSummary, setTaskSummary] = useState<TaskSummary>({
    total: 0,
    queued: 0,
    inProgress: 0,
    done: 0,
  })
  const [recentClients, setRecentClients] = useState<any[]>([])
  const router = useRouter()
  const pathname = usePathname()
  const supabase = getBrowserSupabase()

  useEffect(() => {
    // Wait for user data to load
    if (userLoading) return

    let cancelled = false
    
    async function load() {
      // Use cached user data from context
      if (!user) {
        router.push('/login')
        return
      }

      // Check if user is admin using cached data
      if (!isUserAdmin && userRole !== 'admin' && userRole !== 'pm') {
        router.push('/dashboard')
        return
      }

      setLoading(true)
      try {

        // Optimize: Use count() queries instead of fetching all data
        const [
          { data: clientsData, error: clientsError },
          { data: usageData, error: usageError },
          { count: queuedCount, error: queuedError },
          { count: inProgressCount, error: inProgressError },
          { count: doneCount, error: doneError },
        ] = await Promise.all([
          supabase
            .from('clients')
            .select('id, name, hours_monthly, hours_used_month'),
          supabase
            .from('v_client_usage')
            .select('client_id, pct_used'),
          supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'queued'),
          supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'in_progress'),
          supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'done'),
        ])

        if (clientsError) {
          throw clientsError
        }
        if (usageError) {
          throw usageError
        }
        if (queuedError || inProgressError || doneError) {
          throw queuedError || inProgressError || doneError
        }

        // Calculate total tasks from counts (much faster than fetching all)
        const totalTasks = (queuedCount ?? 0) + (inProgressCount ?? 0) + (doneCount ?? 0)

        if (clientsData && usageData) {
          const usageMap = new Map()
          usageData.forEach((u: any) => {
            usageMap.set(u.client_id, Number(u.pct_used || 0))
          })

          const total = clientsData.length
          const atRisk = clientsData.filter(c => {
            const usage = usageMap.get(c.id) || 0
            return usage >= 80
          }).length
          const totalHoursUsed = clientsData.reduce((sum, c) => sum + Number(c.hours_used_month || 0), 0)
          const avgUsagePercent = total > 0 
            ? Array.from(usageMap.values()).reduce((sum, pct) => sum + pct, 0) / total
            : 0

          setClientSummary({
            total,
            atRisk,
            totalHoursUsed,
            avgUsagePercent,
          })

          // Get recent clients with usage
          const recentClientsWithUsage = clientsData.slice(0, 5).map((c: any) => ({
            id: c.id,
            name: c.name || 'Unknown',
            usagePercent: usageMap.get(c.id) || 0,
            hoursUsed: Number(c.hours_used_month || 0),
            hoursMonthly: Number(c.hours_monthly || 0),
          }))
          setRecentClients(recentClientsWithUsage)
        }

        // Use counts from optimized queries
        setTaskSummary({
          total: totalTasks,
          queued: queuedCount ?? 0,
          inProgress: inProgressCount ?? 0,
          done: doneCount ?? 0,
        })
      } catch (e) {
        console.error('Failed to load dashboard:', e)
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
  }, [supabase, router, pathname, user, isUserAdmin, userRole, userLoading])

  if (loading || userLoading) {
    return (
      <DashboardLayout isAdmin={true}>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading dashboard...</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout isAdmin={true}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">Overview of all clients and tasks</p>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clientSummary.total}</div>
              <p className="text-xs text-muted-foreground">
                {clientSummary.atRisk} at risk
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{taskSummary.total}</div>
              <p className="text-xs text-muted-foreground">
                {taskSummary.inProgress} in progress
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Hours Used</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clientSummary.totalHoursUsed.toFixed(1)}</div>
              <p className="text-xs text-muted-foreground">Across all clients</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Usage</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clientSummary.avgUsagePercent.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">Average capacity</p>
            </CardContent>
          </Card>
        </div>

        {/* Task Status Breakdown */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Task Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                    <span className="text-sm">Queued</span>
                  </div>
                  <span className="font-semibold">{taskSummary.queued}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="h-2 w-2 rounded-full bg-yellow-500"></div>
                    <span className="text-sm">In Progress</span>
                  </div>
                  <span className="font-semibold">{taskSummary.inProgress}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
                    <span className="text-sm">Done</span>
                  </div>
                  <span className="font-semibold">{taskSummary.done}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Clients */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Recent Clients</CardTitle>
              <CardDescription>Top clients by activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentClients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No clients yet</p>
                ) : (
                  recentClients.map((client) => {
                    const riskFlag = client.usagePercent >= 100 ? 'high' : client.usagePercent >= 80 ? 'medium' : 'low'
                    return (
                      <div key={client.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <p className="font-medium text-sm">{client.name}</p>
                            <Badge 
                              variant={riskFlag === 'high' ? 'destructive' : riskFlag === 'medium' ? 'warning' : 'secondary'}
                              className="text-xs"
                            >
                              {riskFlag === 'high' ? 'High Risk' : riskFlag === 'medium' ? 'At Risk' : 'On Track'}
                            </Badge>
                          </div>
                          <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                            <span>{client.hoursUsed.toFixed(1)}h / {client.hoursMonthly}h</span>
                            <span>{client.usagePercent.toFixed(1)}% used</span>
                          </div>
                          <Progress value={Math.min(client.usagePercent, 100)} className="h-1 mt-2" />
                        </div>
                        <button
                          onClick={() => router.push(`/admin/clients`)}
                          className="ml-4 text-xs text-blue-600 hover:underline"
                        >
                          View
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              <button
                onClick={() => router.push('/admin/users')}
                className="p-4 border rounded-lg text-left hover:bg-accent transition-colors"
              >
                <UserPlus className="h-5 w-5 mb-2 text-muted-foreground" />
                <p className="font-medium text-sm">Manage Users</p>
                <p className="text-xs text-muted-foreground mt-1">Create and manage user accounts</p>
              </button>
              <button
                onClick={() => router.push('/admin/clients')}
                className="p-4 border rounded-lg text-left hover:bg-accent transition-colors"
              >
                <Users className="h-5 w-5 mb-2 text-muted-foreground" />
                <p className="font-medium text-sm">View All Clients</p>
                <p className="text-xs text-muted-foreground mt-1">Manage client accounts</p>
              </button>
              <button
                onClick={() => router.push('/admin/tasks')}
                className="p-4 border rounded-lg text-left hover:bg-accent transition-colors"
              >
                <CheckSquare className="h-5 w-5 mb-2 text-muted-foreground" />
                <p className="font-medium text-sm">Manage Tasks</p>
                <p className="text-xs text-muted-foreground mt-1">Assign and track tasks</p>
              </button>
              <button
                onClick={() => router.push('/settings')}
                className="p-4 border rounded-lg text-left hover:bg-accent transition-colors"
              >
                <Activity className="h-5 w-5 mb-2 text-muted-foreground" />
                <p className="font-medium text-sm">Settings</p>
                <p className="text-xs text-muted-foreground mt-1">Configure system</p>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}

