import { z } from 'zod';
import type { Persona, Post, PublicPersona } from '../domain/index.js';
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

/**
 * PATCH /api/personas/:personaId
 *
 * Mirrors CreatePersonaResponse so the client can swap the new shape into
 * any cached MyPersona/PublicProfile entry without a follow-up fetch. The
 * route enforces ownership and rejects archived/suspended targets, so any
 * 200 here is safe to apply optimistically.
 */
export interface UpdatePersonaResponse {
  persona: Pick<
    Persona,
    'id' | 'username' | 'displayName' | 'did' | 'bio' | 'avatarUrl' | 'isDefault'
  >;
}

/**
 * POST /api/personas/:personaId/archive
 *
 * Soft-deletes a persona — sets `archivedAt` to now. The server rejects:
 *   - the default persona                     (409 — account invariant)
 *   - the currently active persona            (409 — switch first)
 *   - an already-archived persona             (409 — nothing to do)
 *   - a suspended persona                     (403 — moderation)
 *
 * The response is deliberately minimal: the caller already knows the full
 * persona shape (from /api/personas). All we need back is the id it acted
 * on and the archivedAt stamp so the UI can either drop the row or render
 * an "archived at …" state if we ever surface archived personas.
 */
export interface ArchivePersonaResponse {
  persona: {
    id: string;
    archivedAt: string;
  };
}

// ── My personas (signed-in viewer) ────────────────────────────────────────

/**
 * The signed-in view of one of the viewer's own personas. Distinct from
 * PublicPersona — this shape adds `isDefault`, `createdAt`, and the
 * viewer-relative `isActive` flag so the switcher UI can render a check
 * next to the currently-active persona without a second request.
 *
 * Archived personas are excluded from listings in v0; if they return here
 * someday, add `archivedAt` to this interface rather than overloading the
 * current shape with a null sentinel.
 */
export interface MyPersona {
  id: string;
  username: string;
  did: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  /** True iff this persona is the one the current session is acting as. */
  isActive: boolean;
}

/**
 * GET /api/personas
 *
 * Returns every non-archived persona belonging to the viewer's account,
 * ordered default-first then by createdAt. Empty list is never expected in
 * v0 because signup always creates a default persona, but the shape
 * tolerates it so the UI can show an empty state if we ever loosen that.
 */
export interface ListMyPersonasResponse {
  personas: MyPersona[];
}

// ── Public profile ────────────────────────────────────────────────────────

/**
 * Relationship between the viewer and the profile subject. Drives the
 * primary CTA on the profile page:
 *   self              — no CTA (edit lives elsewhere in later milestones)
 *   contact           — already mutual; surface a "You're contacts" chip
 *   pending_outgoing  — viewer has an open request to this persona
 *   pending_incoming  — this persona has sent the viewer a request
 *   none              — no relationship; surface "Send contact request"
 *
 * Note: existence of a request in either direction is knowledge the viewer
 * already has access to via /contacts — we're not leaking anything new by
 * surfacing it here. Moderation-suspended profiles short-circuit to 404
 * before we ever compute this, so status is always resolvable.
 */
export const ContactStatus = {
  Self: 'self',
  Contact: 'contact',
  PendingOutgoing: 'pending_outgoing',
  PendingIncoming: 'pending_incoming',
  None: 'none',
} as const;
export type ContactStatus = (typeof ContactStatus)[keyof typeof ContactStatus];

/**
 * What a profile page renders. Strictly a superset of PublicPersona — we
 * intentionally don't expose moderationState/isDefault here; restricted
 * profiles are still visible, but the flag stays server-side.
 *
 * `postCount` is the count visible to the *viewer* — author sees their
 * full count, others see only posts they could have read individually.
 * This avoids surfacing a number that doesn't match the list below.
 */
export interface PublicProfile extends PublicPersona {
  joinedAt: string;
  postCount: number;
  contactStatus: ContactStatus;
}

/**
 * GET /api/personas/:username/profile
 */
export interface GetPersonaProfileResponse {
  profile: PublicProfile;
}

/**
 * GET /api/personas/:username/posts
 *
 *   ?cursor   opaque keyset cursor shared with the feed/my-posts codec
 *   ?limit    1..100, default 50
 *
 * Returns only posts the caller is allowed to see (same rules as getPost).
 * The list is empty — not 404 — for a valid profile with no visible posts,
 * so the UI can say "nothing visible yet" without guessing.
 */
export const ListPersonaPostsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPersonaPostsQuery = z.infer<typeof ListPersonaPostsQuery>;

export interface ListPersonaPostsResponse {
  posts: Post[];
  nextCursor: string | null;
}
