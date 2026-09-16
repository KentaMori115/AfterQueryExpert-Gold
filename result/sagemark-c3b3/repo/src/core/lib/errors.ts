export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} with id ${id} was not found`)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends DomainError {
  readonly issues: Record<string, string>

  constructor(issues: Record<string, string>) {
    super('validation_failed', formatIssues(issues))
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'ConflictError'
  }
}

function formatIssues(issues: Record<string, string>): string {
  const entries = Object.entries(issues)
  if (entries.length === 0) return 'validation failed'
  return entries.map(([k, v]) => `${k}: ${v}`).join('; ')
}

export function asDomainError(value: unknown): DomainError | null {
  return value instanceof DomainError ? value : null
}
