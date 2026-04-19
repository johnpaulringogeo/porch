import { eq } from 'drizzle-orm';
import { persona, type Database } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { isReservedUsername } from './reserved-usernames.js';

export const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Validate username format, reserved-list, and uniqueness.
 * Throws a PorchError with a user-presentable message on failure.
 */
export async function assertUsernameAvailable(db: Database, username: string): Promise<void> {
  const lower = username.toLowerCase();

  if (!USERNAME_REGEX.test(lower)) {
    throw new PorchError(
      ErrorCode.UnprocessableEntity,
      'Username must be 3–32 characters, lowercase letters, digits, or hyphens, starting and ending with alphanumeric.',
      'username',
    );
  }

  if (isReservedUsername(lower)) {
    throw new PorchError(ErrorCode.Conflict, 'That username is reserved.', 'username');
  }

  const existing = await db.select({ id: persona.id }).from(persona).where(eq(persona.username, lower)).limit(1);
  if (existing.length > 0) {
    throw new PorchError(ErrorCode.Conflict, 'Username is already taken.', 'username');
  }
}
