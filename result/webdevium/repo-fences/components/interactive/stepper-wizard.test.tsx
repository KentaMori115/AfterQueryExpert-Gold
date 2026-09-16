import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StepperWizard } from './stepper-wizard'

describe('StepperWizard', () => {
  it('blocks the first step without a title and keeps entered values after going back', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<StepperWizard onComplete={onComplete} />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('status')).toHaveTextContent('Add a title before continuing.')
    expect(onComplete).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Title'), 'Launch checklist')
    await user.type(screen.getByLabelText('Details'), 'Prep the go-live notes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByLabelText('high'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Launch checklist')).toBeInTheDocument()
    expect(screen.getByText('Prep the go-live notes')).toBeInTheDocument()
    expect(screen.getByText(/high/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('high')).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Launch checklist')
  })

  it('submits the collected values from the review step', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<StepperWizard onComplete={onComplete} />)

    await user.type(screen.getByLabelText('Title'), 'QA pass')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onComplete).toHaveBeenCalledWith({
      title: 'QA pass',
      details: '',
      priority: 'medium',
    })
  })
})
