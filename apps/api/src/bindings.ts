import type { Env } from './env.js';
import type { Database } from '@porch/db';

export interface Actor {
  accountId: string;
  personaId: string;
  username: string;
  did: string;
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
