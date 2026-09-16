'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Save } from 'lucide-react'

interface LogHoursDialogProps {
  isOpen: boolean
  onClose: () => void
  task: {
    id: string
    title: string
    client_id: string
  } | null
  onHoursLogged?: () => void
}

export function LogHoursDialog({ 
  isOpen, 
  onClose, 
  task,
  onHoursLogged 
}: LogHoursDialogProps) {
  const [hours, setHours] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!task) return

    const hoursNum = parseFloat(hours)
    if (!hoursNum || hoursNum <= 0) {
      setError('Please enter a valid number of hours (greater than 0)')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/usage/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: task.client_id,
          task_id: task.id,
          hours: hoursNum,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to log hours')
      }

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setHours('')
        onClose()
        if (onHoursLogged) {
          onHoursLogged()
        }
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !task) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Log Hours</CardTitle>
              <CardDescription className="mt-1">
                Record time spent on: {task.title}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={loading}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Hours logged successfully!
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="hours">Hours Spent *</Label>
              <Input
                id="hours"
                type="number"
                step="0.1"
                min="0.1"
                placeholder="e.g. 6.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Enter the number of hours spent completing this task
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-800">
                <span className="font-semibold">💡 Note:</span>
                <br />
                Hours logged will be added to your monthly usage and update the task's hours spent.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {loading ? 'Logging...' : 'Log Hours'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

