'use client'

import { useEffect, useId, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { clampPercent, getUsageStatus, type UsageStatus } from '@/lib/usage'

type UsageMeterProps = {
  label: string
  used: number
  limit: number
  unit?: string
}

function statusVariant(status: UsageStatus) {
  if (status === 'Exceeded') return 'destructive' as const
  if (status === 'Approaching Limit') return 'warning' as const
  return 'success' as const
}

export function UsageMeter({ label, used, limit, unit = 'hours' }: UsageMeterProps) {
  const labelId = useId()
  const statusId = useId()
  const percent = limit <= 0 ? 0 : clampPercent((used / limit) * 100)
  const status = getUsageStatus(percent)
  const previousStatus = useRef(status)

  useEffect(() => {
    previousStatus.current = status
  }, [status])

  const remaining = Math.max(limit - used, 0)
  const statusChanged = previousStatus.current !== status

  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={labelId} className="text-sm font-medium">
          {label}
        </h2>
        <Badge variant={statusVariant(status)}>{status}</Badge>
      </div>

      <Progress value={percent} aria-labelledby={labelId} aria-describedby={statusId} />

      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {used} of {limit} {unit} used ({Math.round(percent)}%). {status}.
        {status === 'Exceeded'
          ? ` Over by ${used - limit} ${unit}.`
          : ` ${remaining} ${unit} remaining.`}
        {statusChanged ? ` Status changed to ${status}.` : ''}
      </p>
    </section>
  )
}
