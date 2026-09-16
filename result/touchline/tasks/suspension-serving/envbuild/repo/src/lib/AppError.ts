/**
 * Every failure the service answers with is one of these.
 *
 * The status and the machine-readable code travel together so a handler never
 * has to decide which number a given kind of refusal deserves. The distinction
 * that matters most here: a request that will not parse is a 400, a request
 * that parsed but asks for something the league's rules refuse is a 409.
 */

export type ErrorCode = 'bad_request' | 'unauthorised' | 'not_found' | 'conflict' | 'internal';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'The request will not parse', details: Record<string, unknown> = {}) {
    super(400, 'bad_request', message, details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorisedError extends AppError {
  constructor(message = 'Credentials are missing or will not do') {
    super(401, 'unauthorised', message);
    this.name = 'UnauthorisedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'There is no such thing here') {
    super(404, 'not_found', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The league will not allow that', details: Record<string, unknown> = {}) {
    super(409, 'conflict', message, details);
    this.name = 'ConflictError';
  }
}
