import { z } from 'zod';
import type { Account, Persona } from '../domain/index.js';

/** Username regex from §4.6 of v0-implementation.md. */
export const usernameRegex = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export const SignupRequest = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(255),
  username: z.string().regex(usernameRegex),
  displayName: z.string().min(1).max(64),
  ageAttestation: z.object({
    isAdult: z.literal(true),
    jurisdiction: z.string().length(2),
  }),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export interface SessionResponse {
  account: Pick<Account, 'id' | 'email' | 'emailVerified'>;
  persona: Pick<Persona, 'id' | 'username' | 'displayName' | 'did'>;
  session: {
    accessToken: string;
    expiresAt: string;
  };
}
