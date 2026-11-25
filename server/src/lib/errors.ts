export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'forbidden', message);
/** Use for resources the caller may not see: never reveal whether they exist (prevents IDOR probing). */
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const tooMany = (message = 'Too many requests') => new AppError(429, 'rate_limited', message);

/** Map PostgreSQL errors to safe API errors. Internal details are never returned to clients. */
export function fromPgError(e: unknown): AppError | null {
  const err = e as { code?: string; message?: string; constraint?: string };
  switch (err?.code) {
    case '42501': // insufficient_privilege / RLS violation
      return forbidden();
    case '23505':
      return conflict('This record already exists.', { constraint: err.constraint });
    case '23503':
      return badRequest('A related record does not exist or belongs to another company.');
    case '23514':
      return badRequest('A value is outside the allowed range.', { constraint: err.constraint });
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('Invalid value.');
    case 'P0001':
    case 'P0002':
    case 'P0003':
    case 'P0004':
    case 'P0005':
      return badRequest(err.message ?? 'Rule violation.');
    case '57014':
      return new AppError(503, 'timeout', 'The request took too long. Please try again.');
    case '40001':
    case '40P01':
      return new AppError(409, 'retry', 'The record was changed at the same time. Please retry.');
    default:
      return null;
  }
}
