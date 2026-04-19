import type { ErrorHandler } from 'hono';
import { PorchError } from '@porch/types';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof PorchError) {
    return c.json(err.toBody(), err.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: first?.message ?? 'Invalid input',
          field: first?.path.join('.') || undefined,
        },
      },
      422,
    );
  }
  console.error('unhandled', err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    500,
  );
};
