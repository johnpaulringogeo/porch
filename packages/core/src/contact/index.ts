/**
 * Contact relationships. Stubs in v0 — the real implementations land as we
 * wire up the /api/contacts routes.
 *
 * State machine for contact requests:
 *   pending → accepted  (accepting creates two rows in `contact`)
 *   pending → declined
 *   pending → cancelled (requester retracts)
 *
 * Invariants (enforced here):
 * - A request may not be created if a contact already exists.
 * - At most one pending request between two personas in either direction.
 * - Declined/cancelled requests do not block new requests after a cooldown
 *   (v0: 24 hours; trust & safety may tune).
 */
export const CONTACT_REREQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Implementations TODO:
//   export async function createContactRequest(db, actor, toPersonaId, message): Promise<ContactRequest>
//   export async function respondToContactRequest(db, actor, requestId, accept): Promise<void>
//   export async function cancelContactRequest(db, actor, requestId): Promise<void>
//   export async function removeContact(db, actor, contactPersonaId): Promise<void>
//   export async function listContacts(db, personaId): Promise<Contact[]>
//   export async function listIncomingRequests(db, personaId): Promise<ContactRequest[]>
//   export async function listOutgoingRequests(db, personaId): Promise<ContactRequest[]>

export {}; // ensure module scope
