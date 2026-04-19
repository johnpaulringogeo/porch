export const PersonaModerationState = {
  Ok: 'ok',
  Restricted: 'restricted',
  Suspended: 'suspended',
} as const;

export type PersonaModerationState =
  (typeof PersonaModerationState)[keyof typeof PersonaModerationState];

export interface Persona {
  id: string;
  username: string;
  did: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  archivedAt: string | null;
  moderationState: PersonaModerationState;
}

/**
 * Public-facing persona view — what other users see. Excludes account_id and any
 * cross-persona linkage. Never include the account_id in this shape.
 */
export interface PublicPersona {
  id: string;
  username: string;
  did: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}
