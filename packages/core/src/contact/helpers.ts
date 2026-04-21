import type { Contact, ContactRequest, PublicPersona } from '@porch/types/domain';
import type {
  Contact as ContactRow,
  ContactRequest as ContactRequestRow,
  Persona as PersonaRow,
} from '@porch/db';

/**
 * Drop account-level + moderation fields before handing a persona row to any
 * public surface. The API response shape is `PublicPersona`; never leak more.
 */
export function toPublicPersona(row: PersonaRow): PublicPersona {
  return {
    id: row.id,
    username: row.username,
    did: row.did,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
  };
}

export function toApiContactRequest(
  row: ContactRequestRow,
  from: PublicPersona,
  to: PublicPersona,
): ContactRequest {
  return {
    id: row.id,
    from,
    to,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

export function toApiContact(row: ContactRow, contactPersona: PublicPersona): Contact {
  return {
    persona: contactPersona,
    nickname: row.nickname,
    establishedAt: row.establishedAt.toISOString(),
  };
}
