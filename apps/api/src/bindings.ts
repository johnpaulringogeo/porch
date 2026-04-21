import type { Env } from './env.js';
import type { Database } from '@porch/db';

export interface Actor {
  accountId: string;
  personaId: string;
  username: string;
  did: string;
  /**
   * ID of the session row backing this request. Populated from the JWT's
   * `sid` claim by requireAuth — non-auth-gated routes won't have it.
   * Used by POST /personas/switch to mutate session.active_persona_id
   * without relying on the refresh cookie (scoped to /api/auth).
   */
  sessionId: string;
}

/**
 * Hono generic — bindings = runtime env, variables = per-request state set by
 * middleware.
 */
export type AppBindings = {
  Bindings: Env;
  Variables: {
    db: Database;
    actor?: Actor;
  };
};
