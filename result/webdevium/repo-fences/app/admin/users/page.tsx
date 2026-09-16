'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Users, Plus, X, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/user-context'

type User = {
  id: string
  email: string
  role: 'admin' | 'client' | 'pm' | 'dev'
  created_at: string
}

type UserFormData = {
  email: string
  password: string
  role: 'admin' | 'client' | 'pm' | 'dev'
}

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onUserCreated: () => void
}

function UserModal({ isOpen, onClose, onUserCreated }: UserModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'client' | 'pm' | 'dev'>('client')
  const [createClient, setCreateClient] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientPlanCode, setClientPlanCode] = useState('starter')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      // Reset form when modal closes
      setEmail('')
      setPassword('')
      setRole('client')
      setCreateClient(false)
      setClientName('')
      setClientPlanCode('starter')
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          role,
          create_client: createClient && role === 'client',
          ...(createClient && role === 'client' && clientName && { client_name: clientName }),
          ...(createClient && role === 'client' && clientPlanCode && { client_plan_code: clientPlanCode }),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle different error formats
        let errorMessage = 'Failed to create user'
        if (typeof data.error === 'string') {
          errorMessage = data.error
        } else if (data.error && typeof data.error === 'object') {
          // Zod validation errors
          const fieldErrors = Object.values(data.error.fieldErrors || {})
          if (fieldErrors.length > 0) {
            errorMessage = Array.isArray(fieldErrors[0]) 
              ? fieldErrors[0][0] 
              : String(fieldErrors[0])
          } else {
            errorMessage = data.error.message || errorMessage
          }
        }
        
        // Log full error for debugging
        console.error('User creation error:', {
          status: response.status,
          error: data.error,
          details: data.details
        })
        
        throw new Error(errorMessage)
      }

      // Success - close modal and refresh list
      onUserCreated()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Create New User</CardTitle>
              <CardDescription>Create a new user account with a specific role</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                Password must be at least 8 characters long
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-role">Role</Label>
              <select
                id="user-role"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={role}
                onChange={(event) => setRole(event.target.value as 'admin' | 'client' | 'pm' | 'dev')}
                required
              >
                <option value="admin">Admin</option>
                <option value="pm">Project Manager (PM)</option>
                <option value="dev">Developer</option>
                <option value="client">Client</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Select the role for this user. Admins and PMs have full access, developers can be assigned tasks, and clients have limited access.
              </p>
            </div>

            {/* Client Creation Section - Only show for client role */}
            {role === 'client' && (
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5" />
                  <Label className="text-base font-semibold">Client Account</Label>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="create-client"
                      checked={createClient}
                      onChange={(e) => setCreateClient(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="create-client" className="font-normal cursor-pointer">
                      Create client account for this user
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    Automatically create a client account and link it to this user. You can manage Stripe settings later from the Clients page.
                  </p>

                  {createClient && (
                    <div className="space-y-3 pl-6">
                      <div className="space-y-2">
                        <Label htmlFor="client-name">Client Name (Optional)</Label>
                        <Input
                          id="client-name"
                          type="text"
                          value={clientName}
                          onChange={(event) => setClientName(event.target.value)}
                          placeholder="Company name (defaults to email prefix)"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="client-plan">Plan</Label>
                        <select
                          id="client-plan"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          value={clientPlanCode}
                          onChange={(event) => setClientPlanCode(event.target.value)}
                        >
                          <option value="starter">Starter (40h/month)</option>
                          <option value="growth">Growth (80h/month)</option>
                          <option value="scale">Scale (120h/month)</option>
                          <option value="dedicated">Dedicated (160h/month)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create User'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function getRoleBadgeVariant(role: string) {
  switch (role) {
    case 'admin':
      return 'destructive'
    case 'pm':
      return 'default'
    case 'dev':
      return 'secondary'
    case 'client':
      return 'outline'
    default:
      return 'outline'
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'pm':
      return 'Project Manager'
    case 'dev':
      return 'Developer'
    case 'client':
      return 'Client'
    default:
      return role
  }
}

export default function AdminUsersPage() {
  const { user, isAdmin: isUserAdmin, loading: userLoading, userRole } = useUser()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const router = useRouter()
  const supabase = getBrowserSupabase()

  useEffect(() => {
    if (userLoading) return

    let cancelled = false

    async function load() {
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
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('id, email, role, created_at')
          .order('created_at', { ascending: false })

        if (usersError) {
          throw usersError
        }

        if (usersData && !cancelled) {
          setUsers(usersData as User[])
        }
      } catch (e) {
        console.error('Failed to load users:', e)
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
  }, [supabase, router, user, isUserAdmin, userRole, userLoading])

  const handleUserCreated = () => {
    // Reload users list
    const loadUsers = async () => {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, email, role, created_at')
        .order('created_at', { ascending: false })

      if (!usersError && usersData) {
        setUsers(usersData as User[])
      }
    }
    loadUsers()
  }

  if (loading || userLoading) {
    return (
      <DashboardLayout isAdmin={true}>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading users...</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    )
  }

  // Count users by role
  const roleCounts = users.reduce(
    (acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <DashboardLayout isAdmin={true}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-muted-foreground">Manage user accounts and roles</p>
          </div>
          <Button onClick={() => setIsModalOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Create User
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Admins</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{roleCounts.admin || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">PMs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{roleCounts.pm || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Developers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{roleCounts.dev || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Users List */}
        <Card>
          <CardHeader>
            <CardTitle>All Users</CardTitle>
            <CardDescription>List of all users in the system</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users found</p>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium">{user.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(user.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={getRoleBadgeVariant(user.role)}>
                      {getRoleLabel(user.role)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <UserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onUserCreated={handleUserCreated}
      />
    </DashboardLayout>
  )
}

