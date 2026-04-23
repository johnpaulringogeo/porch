import { describe, expect, it } from 'vitest';
import type { Database } from '@porch/db';
import { account, session } from '@porch/db';
import { AccountStatus } from '@porch/types/domain';
import { ErrorCode } from '@porch/types';
import { requestDeletion } from './request.js';
import { cancelDeletion } from './cancel.js';
import { getAccountMe, toAccountMe } from './me.js';
import { GRACE_PERIOD_DAYS, GRACE_PERIOD_MS } from './grace.js';

type AccountRow = typeof account.$inferSelect;

/**
 * Minimal Database fake that emulates the Drizzle call chains used by the
 * AccountOps functions. We only care about the operations the code actually
 * performs:
 *
 *   db.transaction(fn) — passes through to fn(tx)
 *   (tx|db).select().from(account).where(eq(...)).limit(1)
 *   (tx|db).update(account).set({...}).where(eq(...)).returning()
 *   tx.update(session).set({...}).where(and(...))   // no returning, awaited
 *
 * The account-row state is kept live in `current` so a request → cancel
 * round-trip observes the intermediate flip.
 */
function makeFakeDb(initial: AccountRow | null) {
  let current: AccountRow | null = initial;
  const accountUpdates: Array<Record<string, unknown>> = [];
  const sessionUpdates: Array<Record<string, unknown>> = [];

  function select() {
    return {
      from(_table: unknown) {
        return {
          where(_cond: unknown) {
            return {
              async limit(_n: number) {
                return current ? [current] : [];
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
            if (table === account) {
              accountUpdates.push(values);
              if (current) {
                current = { ...current, ...values } as AccountRow;
              }
              const rows = current ? [current] : [];
              // Account updates call .returning(); session updates just await
              // the where() result. Both shapes are supported here.
              return {
                async returning() {
                  return rows;
                },
                then<T = unknown>(
                  onFulfilled?: (v: unknown[]) => T,
                  onRejected?: (e: unknown) => T,
                ) {
                  return Promise.resolve(rows).then(onFulfilled, onRejected);
                },
              };
            }
            if (table === session) {
              sessionUpdates.push(values);
              return {
                then<T = unknown>(
                  onFulfilled?: (v: unknown[]) => T,
                  onRejected?: (e: unknown) => T,
                ) {
                  return Promise.resolve([]).then(onFulfilled, onRejected);
                },
              };
            }
            throw new Error(
              `fake db: unexpected update target ${String(table)}`,
            );
          },
        };
      },
    };
  }

  // Build `tx` with an explicit type first so `db.transaction`'s parameter
  // type isn't a self-referential `typeof tx` (TS2502).
  interface FakeTx {
    select: typeof select;
    update: typeof update;
  }
  const tx: FakeTx = { select, update };

  const db = {
    select,
    update,
    async transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };

  return {
    db: db as unknown as Database,
    accountUpdates,
    sessionUpdates,
    getRow: () => current,
  };
}

function baseRow(overrides: Partial<AccountRow> = {}): AccountRow {
  const createdAt = new Date('2026-03-01T00:00:00Z');
  return {
    id: 'acct_abc',
    email: 'alice@example.com',
    emailVerifiedAt: createdAt,
    emailVerificationToken: null,
    passwordHash: 'hash',
    status: AccountStatus.Active,
    ageAttestedAt: createdAt,
    ageJurisdiction: 'US',
    createdAt,
    deletionRequestedAt: null,
    deletedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('requestDeletion', () => {
  it('flips active → deletion_requested, stamps a timestamp, and revokes sessions', async () => {
    const { db, accountUpdates, sessionUpdates } = makeFakeDb(baseRow());
    const before = Date.now();
    const result = await requestDeletion(db, 'acct_abc');
    const after = Date.now();

    expect(result.status).toBe(AccountStatus.DeletionRequested);
    expect(result.deletionRequestedAt).not.toBeNull();
    expect(result.deletionGraceEndsAt).not.toBeNull();

    const stamped = new Date(result.deletionRequestedAt!).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);

    const cutoff = new Date(result.deletionGraceEndsAt!).getTime();
    expect(cutoff - stamped).toBe(GRACE_PERIOD_MS);

    expect(accountUpdates).toHaveLength(1);
    expect(accountUpdates[0]).toMatchObject({
      status: AccountStatus.DeletionRequested,
    });
    expect(accountUpdates[0]!.deletionRequestedAt).toBeInstanceOf(Date);

    // Exactly one session-revocation update should have run as part of the tx.
    expect(sessionUpdates).toHaveLength(1);
    expect(sessionUpdates[0]).toMatchObject({ revokedAt: expect.any(Date) });
  });

  it('accepts restricted accounts (same "not deleted/suspended" rule)', async () => {
    const { db } = makeFakeDb(baseRow({ status: AccountStatus.Restricted }));
    const result = await requestDeletion(db, 'acct_abc');
    expect(result.status).toBe(AccountStatus.DeletionRequested);
  });

  it('409s if the account is already pending deletion (no clock restart)', async () => {
    const existing = new Date('2026-04-10T00:00:00Z');
    const { db, accountUpdates, sessionUpdates } = makeFakeDb(
      baseRow({
        status: AccountStatus.DeletionRequested,
        deletionRequestedAt: existing,
      }),
    );
    await expect(requestDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Conflict,
    });
    // Neither the status row nor the session table should be touched.
    expect(accountUpdates).toHaveLength(0);
    expect(sessionUpdates).toHaveLength(0);
  });

  it('403s if the account has already been deleted', async () => {
    const { db, accountUpdates } = makeFakeDb(
      baseRow({ status: AccountStatus.Deleted }),
    );
    await expect(requestDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Forbidden,
    });
    expect(accountUpdates).toHaveLength(0);
  });

  it('403s if the account is suspended', async () => {
    const { db } = makeFakeDb(baseRow({ status: AccountStatus.Suspended }));
    await expect(requestDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Forbidden,
    });
  });

  it('404s if the account row is missing', async () => {
    const { db } = makeFakeDb(null);
    await expect(requestDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe('cancelDeletion', () => {
  it('flips deletion_requested → active and clears the timestamp', async () => {
    const requestedAt = new Date('2026-04-10T00:00:00Z');
    const { db, accountUpdates } = makeFakeDb(
      baseRow({
        status: AccountStatus.DeletionRequested,
        deletionRequestedAt: requestedAt,
      }),
    );
    const result = await cancelDeletion(db, 'acct_abc');

    expect(result.status).toBe(AccountStatus.Active);
    expect(result.deletionRequestedAt).toBeNull();
    expect(result.deletionGraceEndsAt).toBeNull();

    expect(accountUpdates).toHaveLength(1);
    expect(accountUpdates[0]).toMatchObject({
      status: AccountStatus.Active,
      deletionRequestedAt: null,
    });
  });

  it('409s if the account is active (nothing to cancel)', async () => {
    const { db, accountUpdates } = makeFakeDb(
      baseRow({ status: AccountStatus.Active }),
    );
    await expect(cancelDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Conflict,
    });
    expect(accountUpdates).toHaveLength(0);
  });

  it('409s if the account is restricted', async () => {
    const { db } = makeFakeDb(baseRow({ status: AccountStatus.Restricted }));
    await expect(cancelDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Conflict,
    });
  });

  it('403s if the account has been deleted', async () => {
    const { db } = makeFakeDb(baseRow({ status: AccountStatus.Deleted }));
    await expect(cancelDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Forbidden,
    });
  });

  it('403s if the account is suspended', async () => {
    const { db } = makeFakeDb(baseRow({ status: AccountStatus.Suspended }));
    await expect(cancelDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.Forbidden,
    });
  });

  it('404s if the account row is missing', async () => {
    const { db } = makeFakeDb(null);
    await expect(cancelDeletion(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe('getAccountMe / toAccountMe', () => {
  it('projects an active account with no deletion state', async () => {
    const { db } = makeFakeDb(baseRow());
    const me = await getAccountMe(db, 'acct_abc');
    expect(me.id).toBe('acct_abc');
    expect(me.email).toBe('alice@example.com');
    expect(me.status).toBe(AccountStatus.Active);
    expect(me.emailVerified).toBe(true);
    expect(me.deletionRequestedAt).toBeNull();
    expect(me.deletionGraceEndsAt).toBeNull();
  });

  it('reports emailVerified=false when emailVerifiedAt is null', () => {
    const me = toAccountMe(baseRow({ emailVerifiedAt: null }));
    expect(me.emailVerified).toBe(false);
  });

  it('computes deletionGraceEndsAt = deletionRequestedAt + 30 days', () => {
    const requestedAt = new Date('2026-04-10T12:00:00Z');
    const me = toAccountMe(
      baseRow({
        status: AccountStatus.DeletionRequested,
        deletionRequestedAt: requestedAt,
      }),
    );
    expect(me.deletionGraceEndsAt).not.toBeNull();
    const cutoff = new Date(me.deletionGraceEndsAt!).getTime();
    expect(cutoff - requestedAt.getTime()).toBe(
      GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it('404s if the account row is missing', async () => {
    const { db } = makeFakeDb(null);
    await expect(getAccountMe(db, 'acct_abc')).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});

describe('request → cancel round-trip', () => {
  it('returns to active with timestamps cleared and does not re-revive sessions', async () => {
    const { db, accountUpdates, sessionUpdates } = makeFakeDb(baseRow());

    const requested = await requestDeletion(db, 'acct_abc');
    expect(requested.status).toBe(AccountStatus.DeletionRequested);
    expect(requested.deletionRequestedAt).not.toBeNull();
    expect(sessionUpdates).toHaveLength(1);

    const cancelled = await cancelDeletion(db, 'acct_abc');
    expect(cancelled.status).toBe(AccountStatus.Active);
    expect(cancelled.deletionRequestedAt).toBeNull();
    expect(cancelled.deletionGraceEndsAt).toBeNull();

    // Status was updated once on request and once on cancel.
    expect(accountUpdates).toHaveLength(2);
    // Cancel does NOT restore revoked sessions — see cancel.ts comment.
    expect(sessionUpdates).toHaveLength(1);
  });
});
