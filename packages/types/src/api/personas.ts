import { z } from 'zod';
import type { Persona } from '../domain/index.js';
import { usernameRegex } from './auth.js';

export const CreatePersonaRequest = z.object({
  username: z.string().regex(usernameRegex),
  displayName: z.string().min(1).max(64),
  bio: z.string().max(280).optional(),
});
export type CreatePersonaRequest = z.infer<typeof CreatePersonaRequest>;

export interface CreatePersonaResponse {
  persona: Pick<Persona, 'id' | 'username' | 'displayName' | 'did' | 'bio' | 'isDefault'>;
}

export const SwitchPersonaRequest = z.object({
  personaId: z.string().uuid(),
});
export type SwitchPersonaRequest = z.infer<typeof SwitchPersonaRequest>;

export const UpdatePersonaRequest = z.object({
  displayName: z.string().min(1).max(64).optional(),
  bio: z.string().max(280).nullable().optional(),
});
export type UpdatePersonaRequest = z.infer<typeof UpdatePersonaRequest>;
