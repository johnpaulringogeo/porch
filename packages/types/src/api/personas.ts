import { z } from 'zod';
import { usernameRegex } from './auth.js';

export const CreatePersonaRequest = z.object({
  username: z.string().regex(usernameRegex),
  displayName: z.string().min(1).max(64),
  bio: z.string().max(280).optional(),
});
export type CreatePersonaRequest = z.infer<typeof CreatePersonaRequest>;

export const SwitchPersonaRequest = z.object({
  personaId: z.string().uuid(),
});
export type SwitchPersonaRequest = z.infer<typeof SwitchPersonaRequest>;

export const UpdatePersonaRequest = z.object({
  displayName: z.string().min(1).max(64).optional(),
  bio: z.string().max(280).nullable().optional(),
});
export type UpdatePersonaRequest = z.infer<typeof UpdatePersonaRequest>;
