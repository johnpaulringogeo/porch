import { describe, expect, it } from 'vitest';
import type { Database } from '@porch/db';
import { auditLog, persona, post } from '@porch/db';
import { PersonaModerationAction, PostModerationAction } from '@porch/types/api';
import {
  PersonaModerationState,
  PostAudienceMode,
  PostMode,
  PostModerationState,
} from '@porch/types/domain';
import { actionPersona, actionPost } from './action.js';

type PostRow = typeof post.$inferSelect;
type PersonaRow = typeof persona.$inferSelect;

/**
 * Minimal Database fake that mirrors the exact Drizzle call chains the
 * moderation ops use:
 *
 *   tx.select().from(post|persona).where(cond).limit(1)
 *   tx.update(post|persona).set(...).where(...).returning()
 *   tx.insert(auditLog).values(...)
 *
 *   // outside the tx (actionPost only, to load author persona):
 *   db.select().from(persona).where(...).limit(1)
 *
 * Stores mutable post + persona rows; records every audit insert so tests
 * can assert on the metadata shape (previous/new state, action name,
 * durationDays). Not a deep Drizzle reimplementation — we don't inspect
 * `where` clauses; table identity (`table === post`) is the only routing.
 */
function makeFakeDb(opts: {
  post?: PostRow | null;
  /**
   * Persona used for two purposes:
   *  - in actionPersona tests it's the row being moderated
   *  - in actionPost tests it's the author row fetched after the tx
   */
  persona?: PersonaRow | null;
}) {
  let currentPost: PostRow | null = opts.post ?? null;
  let currentPersona: PersonaRow | null = opts.persona ?? null;
  const auditInserts: Array<Record<string, unknown>> = [];

  function select() {
    return {
      from(table: unknown) {
        return {
          where(_cond: unknown) {
            return {
              async limit(_n: number) {
                if (table === post) return currentPost ? [currentPost] : [];
                if (table === persona)
                  return currentPersona ? [currentPersona] : [];
                return [];
              },
            };
          },
        };
      },
    };
  }

  function update(table: unknown) {
    return {
      set(values: Record<string, unknown>) {
        return {
          where(_cond: unknown) {
            return {
              async returning() {
                if (table === post && currentPost) {
                  currentPost = { ...currentPost, ...values } as PostRow;
                  return [currentPost];
                }
                if (table === persona && currentPersona) {
                  currentPersona = {
                    ...currentPersona,
                    ...values,
                  } as PersonaRow;
                  return [currentPersona];
                }
                return [];
              },
            };
          },
        };
      },
    };
  }

  function insert(table: unknown) {
    return {
      async values(values: Record<string, unknown>) {
        if (table === auditLog) {
          auditInserts.push(values);
          return;
        }
        throw new Error(`fake db: unexpected insert target ${String(table)}`);
      },
    };
  }

  interface FakeTx {
    select: typeof select;
    update: typeof update;
    insert: typeof insert;
  }
  const tx: FakeTx = { select, update, insert };

  const db = {
    select,
    update,
    insert,
    async transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };

  return {
    db: db as unknown as Database,
    auditInserts,
    getPost: () => currentPost,
    getPersona: () => currentPersona,
  };
}

function basePostRow(overrides: Partial<PostRow> = {}): PostRow {
  const createdAt = new Date('2026-04-01T00:00:00Z');
  return {
    id: 'post_abc',
    authorPersonaId: 'persona_alice',
    mode: PostMode.Home,
    audienceMode: PostAudienceMode.AllContacts,
    content: 'Hello world',
    createdAt,
    editedAt: null,
    deletedAt: null,
    moderationState: PostModerationState.Ok,
    moderationReason: null,
    moderatedAt: null,
    ...overrides,
  };
}

function basePersonaRow(overrides: Partial<PersonaRow> = {}): PersonaRow {
  const createdAt = new Date('2026-03-01T00:00:00Z');
  return {
    id: 'persona_alice',
    accountId: 'acct_alice',
    username: 'alice',
    did: 'did:web:example.com:users:alice',
    displayName: 'Alice',
    bio: null,
    avatarUrl: null,
    isDefault: true,
    createdAt,
    archivedAt: null,
    moderationState: PersonaModerationState.Ok,
    moderationReason: null,
    ...overrides,
  };
}

const ADMIN_ACTOR = {
  accountId: 'acct_admin',
  personaId: 'persona_admin',
  ipAddress: '10.0.0.1',
  userAgent: 'test-mod-cli/1.0',
};

describe('actionPost', () => {
  it("flips 'ok' → 'limited' with reason, stamps moderatedAt, and writes an audit entry", async () => {
    const { db, auditInserts, getPost } = makeFakeDb({
      post: basePostRow(),
      persona: basePersonaRow(),
    });

    const before = Date.now();
    const result = await actionPost(db, ADMIN_ACTOR, {
      postId: 'post_abc',
      action: PostModerationAction.Limit,
      reason: 'Off-topic per community norms.',
    });
    const after = Date.now();

    expect(result.moderationState).toBe(PostModerationState.Limited);
    expect(result.moderationReason).toBe('Off-topic per community norms.');
    // Author persona is joined in for the response shape.
    expect(result.author.username).toBe('alice');

    const updated = getPost()!;
    expect(updated.moderationState).toBe(PostModerationState.Limited);
    expect(updated.moderatedAt).toBeInstanceOf(Date);
    const stamped = updated.moderatedAt!.getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      accountId: 'acct_admin',
      personaId: 'persona_admin',
      action: 'moderation.post_actioned',
      entityType: 'post',
      entityId: 'post_abc',
      ipAddress: '10.0.0.1',
      userAgent: 'test-mod-cli/1.0',
    });
    const meta = auditInserts[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      action: 'limit',
      reason: 'Off-topic per community norms.',
      previousState: 'ok',
      newState: 'limited',
    });
  });

  it("maps 'hide' → 'hidden' and 'remove' → 'removed'", async () => {
    // hide
    {
      const { db } = makeFakeDb({
        post: basePostRow(),
        persona: basePersonaRow(),
      });
      const result = await actionPost(db, ADMIN_ACTOR, {
        postId: 'post_abc',
        action: PostModerationAction.Hide,
        reason: 'Spam.',
      });
      expect(result.moderationState).toBe(PostModerationState.Hidden);
    }

    // remove
    {
      const { db } = makeFakeDb({
        post: basePostRow(),
        persona: basePersonaRow(),
      });
      const result = await actionPost(db, ADMIN_ACTOR, {
        postId: 'post_abc',
        action: PostModerationAction.Remove,
        reason: 'TOS violation.',
      });
      expect(result.moderationState).toBe(PostModerationState.Removed);
    }
  });

  it("'restore' flips a limited post back to 'ok' while still recording a reason on the audit row", async () => {
    const { db, auditInserts, getPost } = makeFakeDb({
      post: basePostRow({
        moderationState: PostModerationState.Limited,
        moderationReason: 'Off-topic per community norms.',
        moderatedAt: new Date('2026-04-05T00:00:00Z'),
      }),
      persona: basePersonaRow(),
    });

    const result = await actionPost(db, ADMIN_ACTOR, {
      postId: 'post_abc',
      action: PostModerationAction.Restore,
      reason: 'Appealed successfully; original limit was overreach.',
    });

    expect(result.moderationState).toBe(PostModerationState.Ok);
    // Reason is kept on the row so a viewer of the audit trail can see the
    // last rationale that landed even after state is 'ok' again.
    expect(getPost()!.moderationReason).toBe(
      'Appealed successfully; original limit was overreach.',
    );

    const meta = auditInserts[0]!.metadata as Record<string, unknown>;
    expect(meta.previousState).toBe('limited');
    expect(meta.newState).toBe('ok');
  });

  it('404s when the post does not exist and writes no audit row', async () => {
    const { db, auditInserts } = makeFakeDb({
      post: null,
      persona: basePersonaRow(),
    });

    await expect(
      actionPost(db, ADMIN_ACTOR, {
        postId: 'post_missing',
        action: PostModerationAction.Limit,
        reason: 'Any reason.',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(auditInserts).toHaveLength(0);
  });
});

describe('actionPersona', () => {
  it("maps 'restrict' → 'restricted' with reason and audit entry", async () => {
    const { db, auditInserts, getPersona } = makeFakeDb({
      persona: basePersonaRow(),
    });

    const result = await actionPersona(db, ADMIN_ACTOR, {
      personaId: 'persona_alice',
      action: PersonaModerationAction.Restrict,
      reason: 'Repeated off-topic posts.',
    });

    expect(result.moderationState).toBe(PersonaModerationState.Restricted);
    expect(getPersona()!.moderationReason).toBe('Repeated off-topic posts.');

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      accountId: 'acct_admin',
      action: 'moderation.persona_actioned',
      entityType: 'persona',
      entityId: 'persona_alice',
    });
    const meta = auditInserts[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      action: 'restrict',
      previousState: 'ok',
      newState: 'restricted',
    });
    // durationDays should not appear on restrict metadata — it only makes
    // sense for suspend.
    expect(meta).not.toHaveProperty('durationDays');
  });

  it("records durationDays on the audit row for 'suspend' when provided", async () => {
    const { db, auditInserts } = makeFakeDb({ persona: basePersonaRow() });

    await actionPersona(db, ADMIN_ACTOR, {
      personaId: 'persona_alice',
      action: PersonaModerationAction.Suspend,
      reason: 'Coordinated abuse.',
      durationDays: 7,
    });

    const meta = auditInserts[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      action: 'suspend',
      newState: 'suspended',
      durationDays: 7,
    });
  });

  it("ignores durationDays on non-suspend actions even if passed", async () => {
    const { db, auditInserts } = makeFakeDb({
      persona: basePersonaRow({
        moderationState: PersonaModerationState.Restricted,
      }),
    });

    await actionPersona(db, ADMIN_ACTOR, {
      personaId: 'persona_alice',
      action: PersonaModerationAction.Restore,
      reason: 'Appeal granted.',
      durationDays: 30,
    });

    const meta = auditInserts[0]!.metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty('durationDays');
  });

  it("'restore' flips a restricted persona back to 'ok'", async () => {
    const { db, getPersona } = makeFakeDb({
      persona: basePersonaRow({
        moderationState: PersonaModerationState.Restricted,
        moderationReason: 'Original restriction reason.',
      }),
    });

    const result = await actionPersona(db, ADMIN_ACTOR, {
      personaId: 'persona_alice',
      action: PersonaModerationAction.Restore,
      reason: 'Appeal granted after review.',
    });

    expect(result.moderationState).toBe(PersonaModerationState.Ok);
    expect(getPersona()!.moderationReason).toBe(
      'Appeal granted after review.',
    );
  });

  it('404s when the persona does not exist and writes no audit row', async () => {
    const { db, auditInserts } = makeFakeDb({ persona: null });

    await expect(
      actionPersona(db, ADMIN_ACTOR, {
        personaId: 'persona_missing',
        action: PersonaModerationAction.Restrict,
        reason: 'Any.',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(auditInserts).toHaveLength(0);
  });
});
