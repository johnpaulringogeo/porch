/**
 * Canonical error codes used across API responses and service layer.
 */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  UnprocessableEntity: 'UNPROCESSABLE_ENTITY',
  RateLimited: 'RATE_LIMITED',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    field?: string;
  };
}

export class PorchError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly field?: string,
    public readonly status: number = mapCodeToStatus(code),
  ) {
    super(message);
    this.name = 'PorchError';
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, field: this.field } };
  }
}

function mapCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.BadRequest:
      return 400;
    case ErrorCode.Unauthorized:
      return 401;
    case ErrorCode.Forbidden:
      return 403;
    case ErrorCode.NotFound:
      return 404;
    case ErrorCode.Conflict:
      return 409;
    case ErrorCode.UnprocessableEntity:
      return 422;
    case ErrorCode.RateLimited:
      return 429;
    case ErrorCode.InternalError:
      return 500;
  }
}
