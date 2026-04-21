import { z } from 'zod';
import type { Contact, ContactRequest } from '../domain/index.js';

export const CreateContactRequest = z.object({
  toPersonaUsername: z.string(),
  message: z.string().max(200).optional(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequest>;

export const RespondToContactRequest = z.object({
  accept: z.boolean(),
});
export type RespondToContactRequest = z.infer<typeof RespondToContactRequest>;

export interface CreateContactRequestResponse {
  request: ContactRequest;
}

export interface RespondToContactRequestResponse {
  request: ContactRequest;
  /** Set only when the request was accepted — represents the mutual edge from the actor's side. */
  contact?: Contact;
}

export interface ListContactsResponse {
  contacts: Contact[];
}

export interface ListContactRequestsResponse {
  requests: ContactRequest[];
}
