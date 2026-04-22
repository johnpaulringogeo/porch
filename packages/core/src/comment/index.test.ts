import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Database,
  Persona as PersonaRow,
  PostComment as PostCommentRow,
} from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';

import { decodeCursor, encodeCursor } from '../feed/index.js';

/**
 * Mock the post visibility gate.
 *
 * Every comment entrypoint funnels through `assertCanViewPost`. Faking the
 * post/contact/postAudience tables just to exercise that one helper in these
 * tests would be mostly noise — the helper has its own surface. We mock it
 * here and verify directly that:
 *   - createComment / listComments refuse to do work when it rejects
 *   - successful comment operations actually awaited it
 * Everything else is the comment module's own logic, which is what we're after.
 */
vi.mock('../post/helpers.js', () => ({
  assertCanViewPost: vi.fn(),
}));

import { assertCanViewPost } from '../post/helpers.js';
import {
  createComment,
  deleteComment,
  getCommentSummariesForPosts,
  getCommentSummary,
  listComments,
  toApiComment,
} from './index.js';

// ── Fake DB ────────────────────────────────────────────────────────────────

interface InsertCall {
  table: unknown;
  values: Record<string, unknown>;
}
interface UpdateCall {
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}

/**
 * Chainable, thenable proxy that mimics a drizzle select/update chain.
 * Every call (`.from`, `.where`, `.orderBy`, `.limit`, `.groupBy`) returns the
 * same object, and awaiting it resolves to the queued `result`. `onLimit` lets
 * tests inspect the page size the code asked for.
 */
function selectChain<T>(result: T[], onLimit?: (n: number) => void) {
  const self = {
    from: () => self,
    where: () => self,
    orderBy: () => self,
    limit: (n: number) => {
      onLimit?.(n);
      return self;
    },
    groupBy: () => self,
    then<R1 = T[], R2 = never>(
      onFulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): Promise<R1 | R2> {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  } as const;
  return self;
}

/**
 * Build a fake Database exposing only the methods the comment module calls:
 *   - `select(cols?)` → chainable thenable that resolves to the next queued
 *     rows (or `[]` if the queue is empty).
 *   - `insert(table).values(v).returning()` → resolves to next queued insert
 *     rows. Insert payloads are recorded in `inserts` for assertion.
 *   - `update(table).set(v).where(c)` → awaitable no-op that records the call.
 *
 * Tests queue select / insert-returning results in the order the module
 * consumes them.
 */
function makeFakeDb() {
  const selects: unknown[][] = [];
  const insertRows: unknown[][] = [];
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const limitCalls: number[] = [];

  const db = {
    select(_cols?: unknown) {
      const result = selects.shift() ?? [];
      return selectChain(result, (n) => limitCalls.push(n));
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            async returning() {
              return insertRows.shift() ?? [];
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(setArg: Record<string, unknown>) {
          return {
            async where(whereArg: unknown) {
              updates.push({ table, set: setArg, where: whereArg });
            },
          };
        },
      };
    },
  };

  return {
    db: db as unknown as Database,
    inserts,
    updates,
    limitCalls,
    queueSelect(rows: unknown[]) {
      selects.push(rows);
    },
    queueInsertReturning(rows: unknown[]) {
      insertRows.push(rows);
    },
  };
}

// ── Row builders ───────────────────────────────────────────────────────────

function makePersonaRow(
  id: string,
  overrides: Partial<PersonaRow> = {},
): PersonaRow {
  return {
    id,
    accountId: 'acct_1',
    username: 'alice',
    did: `did:web:test:users:${id}`,
    displayName: 'Alice',
    bio: null,
    avatarUrl: null,
    isDefault: false,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    archivedAt: null,
    moderationState: 'ok',
    moderationReason: null,
    ...overrides,
  } as PersonaRow;
}

function makeCommentRow(
  id: string,
  overrides: Partial<PostCommentRow> = {},
): PostCommentRow {
  return {
    id,
    postId: 'post_1',
    authorPersonaId: 'persona_actor_1',
    content: 'hello',
    createdAt: new Date('2026-04-20T12:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  } as PostCommentRow;
}

// ── Shared ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(assertCanViewPost).mockReset();
  // Default: visibility gate resolves successfully. Tests that need it to
  // reject call `mockRejectedValueOnce`.
  vi.mocked(assertCanViewPost).mockResolvedValue({} as never);
});

// ── createComment ──────────────────────────────────────────────────────────

describe('createComment', () => {
  it('rejects empty content with BadRequest', async () => {
    const { db, inserts } = makeFakeDb();

    await expect(
      createComment(
        db,
        { personaId: 'persona_actor_1' },
        { postId: 'post_1', content: '' },
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
      field: 'content',
    });
    // Should not have even attempted an insert.
    expect(inserts).toHaveLength(0);
  });

  it('rejects whitespace-only content with BadRequest', async () => {
    const { db, inserts } = makeFakeDb();

    await expect(
      createComment(
        db,
        { personaId: 'persona_actor_1' },
        { postId: 'post_1', content: '   \n\t  ' },
      ),
    ).rejects.toBeInstanceOf(PorchError);
    expect(inserts).toHaveLength(0);
  });

  it('trims leading/trailing whitespace before inserting', async () => {
    const { db, inserts, queueSelect, queueInsertReturning } = makeFakeDb();
    queueInsertReturning([makeCommentRow('c1', { content: 'hi' })]);
    queueSelect([makePersonaRow('persona_actor_1')]);
    queueSelect([{ total: 1 }]);

    await createComment(
      db,
      { personaId: 'persona_actor_1' },
      { postId: 'post_1', content: '  hi\n  ' },
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toMatchObject({
      postId: 'post_1',
      authorPersonaId: 'persona_actor_1',
      content: 'hi',
    });
  });

  it('returns the comment with resolved author and the updated commentSummary', async () => {
    const { db, queueSelect, queueInsertReturning } = makeFakeDb();
    const createdAt = new Date('2026-04-20T12:00:00.000Z');
    queueInsertReturning([
      makeCommentRow('c1', { createdAt, content: 'first' }),
    ]);
    queueSelect([
      makePersonaRow('persona_actor_1', {
        username: 'alice',
        displayName: 'Alice',
        bio: 'hi there',
      }),
    ]);
    queueSelect([{ total: 7 }]);

    const result = await createComment(
      db,
      { personaId: 'persona_actor_1' },
      { postId: 'post_1', content: 'first' },
    );

    expect(result.comment).toEqual({
      id: 'c1',
      postId: 'post_1',
      author: {
        id: 'persona_actor_1',
        username: 'alice',
        did: 'did:web:test:users:persona_actor_1',
        displayName: 'Alice',
        bio: 'hi there',
        avatarUrl: null,
      },
      content: 'first',
      createdAt: createdAt.toISOString(),
      editedAt: null,
    });
    expect(result.commentSummary).toEqual({ totalComments: 7 });
  });

  it('runs the visibility gate before any insert and propagates its errors', async () => {
    const { db, inserts } = makeFakeDb();
    vi.mocked(assertCanViewPost).mockRejectedValueOnce(
      new PorchError(ErrorCode.NotFound, 'Post not found.'),
    );

    await expect(
      createComment(
        db,
        { personaId: 'persona_actor_1' },
        { postId: 'post_missing', content: 'hi' },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    expect(assertCanViewPost).toHaveBeenCalledWith(
      expect.anything(),
      { personaId: 'persona_actor_1' },
      'post_missing',
    );
    expect(inserts).toHaveLength(0);
  });
});

// ── listComments ───────────────────────────────────────────────────────────

describe('listComments', () => {
  it('propagates visibility errors before touching comment rows', async () => {
    const { db, queueSelect } = makeFakeDb();
    vi.mocked(assertCanViewPost).mockRejectedValueOnce(
      new PorchError(ErrorCode.NotFound, 'Post not found.'),
    );
    // Queue nothing — if the code attempted a select, it'd hit the empty
    // fallback, not an error. So the only way this test passes is if the
    // visibility check short-circuits before the select is reached.
    queueSelect([]);

    await expect(
      listComments(db, { personaId: 'v1' }, { postId: 'p1' }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it('returns an empty page with the current commentSummary when no rows match', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([]); // page query → no rows
    queueSelect([{ total: 0 }]); // getCommentSummary

    const result = await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1' },
    );

    expect(result.comments).toEqual([]);
    expect(result.commentSummary).toEqual({ totalComments: 0 });
    expect(result.nextCursor).toBeNull();
  });

  it('defaults the page size to 50 (asks for limit+1 from the db)', async () => {
    const { db, queueSelect, limitCalls } = makeFakeDb();
    queueSelect([]);
    queueSelect([{ total: 0 }]);

    await listComments(db, { personaId: 'v1' }, { postId: 'p1' });

    // First .limit() call is for the page query.
    expect(limitCalls[0]).toBe(51);
  });

  it('caps the page size at 100', async () => {
    const { db, queueSelect, limitCalls } = makeFakeDb();
    queueSelect([]);
    queueSelect([{ total: 0 }]);

    await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1', limit: 500 },
    );

    expect(limitCalls[0]).toBe(101);
  });

  it('enforces a minimum page size of 1', async () => {
    const { db, queueSelect, limitCalls } = makeFakeDb();
    queueSelect([]);
    queueSelect([{ total: 0 }]);

    await listComments(db, { personaId: 'v1' }, { postId: 'p1', limit: 0 });

    // max(1, 0) + 1 = 2
    expect(limitCalls[0]).toBe(2);
  });

  it('returns hydrated rows with batched authors and null nextCursor when the page fits', async () => {
    const { db, queueSelect } = makeFakeDb();
    const c1 = makeCommentRow('c1', {
      createdAt: new Date('2026-04-20T12:00:00.000Z'),
      authorPersonaId: 'p_author',
      content: 'one',
    });
    const c2 = makeCommentRow('c2', {
      createdAt: new Date('2026-04-19T12:00:00.000Z'),
      authorPersonaId: 'p_author',
      content: 'two',
    });
    queueSelect([c1, c2]); // 2 rows, default limit=50 → hasMore=false
    queueSelect([{ total: 2 }]); // getCommentSummary
    queueSelect([
      makePersonaRow('p_author', {
        username: 'author1',
        displayName: 'Author 1',
      }),
    ]);

    const result = await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1' },
    );

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({
      id: 'c1',
      content: 'one',
      author: { username: 'author1', displayName: 'Author 1' },
    });
    expect(result.comments[1]!.id).toBe('c2');
    expect(result.commentSummary).toEqual({ totalComments: 2 });
    expect(result.nextCursor).toBeNull();
  });

  it('drops rows whose author has vanished rather than 500ing the page', async () => {
    const { db, queueSelect } = makeFakeDb();
    const c1 = makeCommentRow('c1', { authorPersonaId: 'p_live' });
    const c2 = makeCommentRow('c2', { authorPersonaId: 'p_ghost' });
    queueSelect([c1, c2]);
    queueSelect([{ total: 2 }]);
    queueSelect([
      makePersonaRow('p_live', { username: 'live_author' }),
      // 'p_ghost' intentionally missing — simulates a deleted persona row
    ]);

    const result = await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1' },
    );

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.id).toBe('c1');
    expect(result.commentSummary).toEqual({ totalComments: 2 });
  });

  it('encodes nextCursor from the last in-page row when rows overflow the limit', async () => {
    const { db, queueSelect } = makeFakeDb();
    const rows = [
      makeCommentRow('c1', { createdAt: new Date('2026-04-20T00:00:00.000Z') }),
      makeCommentRow('c2', { createdAt: new Date('2026-04-19T00:00:00.000Z') }),
      makeCommentRow('c3', { createdAt: new Date('2026-04-18T00:00:00.000Z') }),
    ];
    // limit=2 → module asks db for 3; if we return 3, hasMore=true.
    queueSelect(rows);
    queueSelect([{ total: 10 }]);
    queueSelect([makePersonaRow('persona_actor_1')]);

    const result = await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1', limit: 2 },
    );

    expect(result.comments).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
    const decoded = decodeCursor(result.nextCursor!);
    // Cursor should key off the last *in-page* row (c2), not the overflow (c3).
    expect(decoded?.id).toBe('c2');
    expect(decoded?.createdAt).toBe(rows[1]!.createdAt.toISOString());
  });

  it('accepts a valid cursor without error', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([]);
    queueSelect([{ total: 0 }]);

    const cursor = encodeCursor({
      createdAt: '2026-04-20T00:00:00.000Z',
      id: 'cX',
    });
    const result = await listComments(
      db,
      { personaId: 'v1' },
      { postId: 'p1', cursor },
    );

    expect(result.comments).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

// ── deleteComment ──────────────────────────────────────────────────────────

describe('deleteComment', () => {
  it('throws NotFound when the comment row cannot be found', async () => {
    const { db, queueSelect, updates } = makeFakeDb();
    queueSelect([]); // lookup returns nothing

    await expect(
      deleteComment(
        db,
        { personaId: 'persona_actor_1' },
        { postId: 'p1', commentId: 'c1' },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    expect(updates).toHaveLength(0);
  });

  it('masks non-author deletes as NotFound without updating the row', async () => {
    const { db, queueSelect, updates } = makeFakeDb();
    queueSelect([
      makeCommentRow('c1', { authorPersonaId: 'persona_someone_else' }),
    ]);

    await expect(
      deleteComment(
        db,
        { personaId: 'persona_actor_1' },
        { postId: 'p1', commentId: 'c1' },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    expect(updates).toHaveLength(0);
  });

  it('soft-deletes by setting deletedAt and returns the refreshed summary', async () => {
    const { db, queueSelect, updates } = makeFakeDb();
    queueSelect([
      makeCommentRow('c1', { authorPersonaId: 'persona_actor_1' }),
    ]);
    queueSelect([{ total: 3 }]); // getCommentSummary after delete

    const result = await deleteComment(
      db,
      { personaId: 'persona_actor_1' },
      { postId: 'p1', commentId: 'c1' },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ deletedAt: expect.any(Date) });
    expect(result.commentSummary).toEqual({ totalComments: 3 });
  });
});

// ── getCommentSummary ──────────────────────────────────────────────────────

describe('getCommentSummary', () => {
  it('returns totalComments from the count row', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([{ total: 42 }]);

    const s = await getCommentSummary(db, 'p1');

    expect(s).toEqual({ totalComments: 42 });
  });

  it('returns 0 when the count query produces no rows', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([]);

    const s = await getCommentSummary(db, 'p1');

    expect(s).toEqual({ totalComments: 0 });
  });
});

// ── getCommentSummariesForPosts ────────────────────────────────────────────

describe('getCommentSummariesForPosts', () => {
  it('short-circuits to an empty map on empty input without hitting the db', async () => {
    const { db } = makeFakeDb();
    // Intentionally queue nothing — if the code reached the db path it would
    // still resolve via the empty-fallback, but this test documents the
    // explicit early-return contract (the module avoids `WHERE IN ()`).
    const result = await getCommentSummariesForPosts(db, []);

    expect(result.size).toBe(0);
  });

  it('zero-fills every requested postId when no rows come back', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([]); // grouped count → no rows at all

    const result = await getCommentSummariesForPosts(db, ['a', 'b', 'c']);

    expect(result.size).toBe(3);
    expect(result.get('a')).toEqual({ totalComments: 0 });
    expect(result.get('b')).toEqual({ totalComments: 0 });
    expect(result.get('c')).toEqual({ totalComments: 0 });
  });

  it('overrides the zero-defaults with real counts from grouped rows', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([
      { postId: 'a', total: 3 },
      { postId: 'c', total: 1 },
    ]);

    const result = await getCommentSummariesForPosts(db, ['a', 'b', 'c']);

    expect(result.get('a')).toEqual({ totalComments: 3 });
    // 'b' had no count row → stays at the zero default
    expect(result.get('b')).toEqual({ totalComments: 0 });
    expect(result.get('c')).toEqual({ totalComments: 1 });
  });
});

// ── toApiComment ───────────────────────────────────────────────────────────

describe('toApiComment', () => {
  const author = {
    id: 'persona_actor_1',
    username: 'alice',
    did: 'did:web:test:users:alice',
    displayName: 'Alice',
    bio: null,
    avatarUrl: null,
  } as const;

  it('shapes a row + author into the API Comment type (null editedAt)', () => {
    const row = makeCommentRow('c1', {
      createdAt: new Date('2026-04-20T12:00:00.000Z'),
      content: 'hey',
    });

    expect(toApiComment(row, author)).toEqual({
      id: 'c1',
      postId: 'post_1',
      author,
      content: 'hey',
      createdAt: '2026-04-20T12:00:00.000Z',
      editedAt: null,
    });
  });

  it('serializes editedAt as an ISO string when present', () => {
    const row = makeCommentRow('c1', {
      editedAt: new Date('2026-04-21T09:00:00.000Z'),
    });

    const result = toApiComment(row, author);

    expect(result.editedAt).toBe('2026-04-21T09:00:00.000Z');
  });
});
