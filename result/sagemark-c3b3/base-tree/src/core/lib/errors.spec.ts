import { describe, expect, it } from 'vitest'

import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
  asDomainError,
} from './errors'

describe('DomainError', () => {
  it('carries a code and message', () => {
    const e = new DomainError('x_failed', 'something went wrong')
    expect(e.code).toBe('x_failed')
    expect(e.message).toBe('something went wrong')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('NotFoundError', () => {
  it('formats a friendly message', () => {
    const e = new NotFoundError('Campaign', 'camp_1')
    expect(e.message).toBe('Campaign with id camp_1 was not found')
    expect(e.code).toBe('not_found')
  })
})

describe('ValidationError', () => {
  it('serialises issues into the message', () => {
    const e = new ValidationError({ name: 'is required', level: 'must be > 0' })
    expect(e.message).toContain('name: is required')
    expect(e.message).toContain('level: must be > 0')
    expect(e.code).toBe('validation_failed')
  })

  it('handles the empty issues case', () => {
    const e = new ValidationError({})
    expect(e.message).toBe('validation failed')
    expect(e.issues).toEqual({})
  })
})

describe('ConflictError', () => {
  it('is a domain error with code conflict', () => {
    const e = new ConflictError('already exists')
    expect(e.code).toBe('conflict')
    expect(e.message).toBe('already exists')
  })
})

describe('asDomainError', () => {
  it('returns the same error when value is a DomainError', () => {
    const e = new NotFoundError('Character', 'char_x')
    expect(asDomainError(e)).toBe(e)
  })

  it('returns null for other errors', () => {
    expect(asDomainError(new Error('plain'))).toBe(null)
    expect(asDomainError('string')).toBe(null)
    expect(asDomainError(undefined)).toBe(null)
  })
})
