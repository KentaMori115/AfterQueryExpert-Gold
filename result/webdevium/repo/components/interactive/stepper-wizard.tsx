'use client'

import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type WizardValues = {
  title: string
  details: string
  priority: 'low' | 'medium' | 'high'
}

const STEPS = ['Details', 'Priority', 'Review'] as const

type StepperWizardProps = {
  onComplete: (values: WizardValues) => void
}

const EMPTY_VALUES: WizardValues = {
  title: '',
  details: '',
  priority: 'medium',
}

export function StepperWizard({ onComplete }: StepperWizardProps) {
  const titleId = useId()
  const detailsId = useId()
  const errorId = useId()
  const statusId = useId()
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<WizardValues>(EMPTY_VALUES)
  const [error, setError] = useState('')

  const stepLabel = STEPS[step]
  const isLast = step === STEPS.length - 1

  const canContinue = useMemo(() => {
    if (step === 0) return values.title.trim().length > 0
    return true
  }, [step, values.title])

  const goNext = () => {
    if (!canContinue) {
      setError('Add a title before continuing.')
      return
    }
    setError('')
    if (isLast) {
      onComplete(values)
      return
    }
    setStep((current) => current + 1)
  }

  const goBack = () => {
    setError('')
    setStep((current) => Math.max(0, current - 1))
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        goNext()
      }}
    >
      <div>
        <p className="text-sm font-medium">New task</p>
        <ol className="mt-2 flex gap-2 text-sm" aria-label="Wizard steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={index === step ? 'font-semibold' : 'text-muted-foreground'}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Step {step + 1} of {STEPS.length}: {stepLabel}
        {error ? ` ${error}` : ''}
      </p>

      {step === 0 ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={titleId} className="text-sm font-medium">
              Title
            </label>
            <Input
              id={titleId}
              value={values.title}
              onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={detailsId} className="text-sm font-medium">
              Details
            </label>
            <textarea
              id={detailsId}
              value={values.details}
              onChange={(event) =>
                setValues((current) => ({ ...current, details: event.target.value }))
              }
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Priority</legend>
          {(['low', 'medium', 'high'] as const).map((priority) => (
            <label key={priority} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="radio"
                name="priority"
                value={priority}
                checked={values.priority === priority}
                onChange={() => setValues((current) => ({ ...current, priority }))}
              />
              {priority}
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 2 ? (
        <div className="rounded-md border p-3 text-sm">
          <p>
            <span className="font-medium">Title:</span> {values.title}
          </p>
          <p>
            <span className="font-medium">Details:</span> {values.details || 'None'}
          </p>
          <p className="capitalize">
            <span className="font-medium">Priority:</span> {values.priority}
          </p>
        </div>
      ) : null}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={goBack} disabled={step === 0}>
          Back
        </Button>
        <Button type="submit">{isLast ? 'Create task' : 'Continue'}</Button>
      </div>
    </form>
  )
}
