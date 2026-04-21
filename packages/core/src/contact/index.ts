/**
 * Contact relationships.
 *
 * State machine for contact requests:
 *   pending → accepted  (accepting creates two rows in `contact`)
 *   pending → declined
 *   pending → cancelled (requester retracts)
 *
 * Invariants (enforced in requests.ts):
 * - A request may not be created if a contact already exists.
 * - At most one pending request between two personas in either direction.
 * - Declined/cancelled requests do not block new requests after a cooldown
 *   (v0: 24 hours; trust & safety may tune via CONTACT_REREQUEST_COOLDOWN_MS).
 *
 * Mutual contacts (mutual.ts) are stored as two symmetric rows so per-owner
 * fields (nicknames) and queries stay simple.
 */
export {
  CONTACT_REREQUEST_COOLDOWN_MS,
  cancelRequest,
  createRequest,
  listIncomingRequests,
  listOutgoingRequests,
  respondToRequest,
} from './requests.js';
export type { ContactActor } from './requests.js';

export { listContacts, removeContact } from './mutual.js';

export { toApiContact, toApiContactRequest, toPublicPersona } from './helpers.js';
