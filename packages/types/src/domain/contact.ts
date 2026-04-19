import type { PublicPersona } from './persona.js';

export const ContactRequestStatus = {
  Pending: 'pending',
  Accepted: 'accepted',
  Declined: 'declined',
  Cancelled: 'cancelled',
} as const;
export type ContactRequestStatus =
  (typeof ContactRequestStatus)[keyof typeof ContactRequestStatus];

export interface ContactRequest {
  id: string;
  from: PublicPersona;
  to: PublicPersona;
  message: string | null;
  status: ContactRequestStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface Contact {
  persona: PublicPersona;
  nickname: string | null;
  establishedAt: string;
}
