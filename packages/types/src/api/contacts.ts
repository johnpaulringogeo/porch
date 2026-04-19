import { z } from 'zod';

export const CreateContactRequest = z.object({
  toPersonaUsername: z.string(),
  message: z.string().max(200).optional(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequest>;

export const RespondToContactRequest = z.object({
  accept: z.boolean(),
});
export type RespondToContactRequest = z.infer<typeof RespondToContactRequest>;
