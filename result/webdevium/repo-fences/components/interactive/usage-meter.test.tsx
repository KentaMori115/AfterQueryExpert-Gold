import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UsageMeter } from './usage-meter'
import { getUsageStatus } from '@/lib/usage'

describe('getUsageStatus', () => {
  it('derives status from the used percentage', () => {
    expect(getUsageStatus(0)).toBe('On Track')
    expect(getUsageStatus(79.9)).toBe('On Track')
    expect(getUsageStatus(80)).toBe('Approaching Limit')
    expect(getUsageStatus(99)).toBe('Approaching Limit')
    expect(getUsageStatus(100)).toBe('Exceeded')
  })
})

describe('UsageMeter', () => {
  it('shows remaining hours and an on-track status in text, not only color', () => {
    render(<UsageMeter label="Monthly hours" used={12} limit={20} />)

    expect(screen.getByRole('heading', { name: 'Monthly hours' })).toBeInTheDocument()
    expect(screen.getByText('On Track')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('12 of 20 hours used (60%). On Track.')
    expect(screen.getByRole('status')).toHaveTextContent('8 hours remaining')
  })

  it('announces an exceeded status and the amount over the limit', () => {
    render(<UsageMeter label="Monthly hours" used={24} limit={20} />)

    expect(screen.getByText('Exceeded')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Exceeded')
    expect(screen.getByRole('status')).toHaveTextContent('Over by 4 hours')
  })
})
