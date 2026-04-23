import { describe, expect, it } from 'vitest';
import type { Database } from '@porch/db';
import { auditLog } from '@porch/db';
import {
  decodeCursor,
  encodeCursor,
  listAccountAudit,
  toApiAuditEntry,
} from './list.js';

type AuditRow = typeof auditLog.$inferSelect;

/**
 * Minimal Database fake that matches the exact Drizzle call chain
 * `listAccountAudit` uses:
 *
 *   db.select().from(auditLog).where(cond).orderBy(desc, desc).limit(n)
 *
 * The fake ignores the `cond` and `orderBy` arguments — we don't need to
 * reimplement Drizzle's operator semantics in a unit test. Instead we feed
 * pre-sorted rows in and capture the requested `limit` so assertions can
 * verify the limit+1 hasMore pattern. Cursor semantics and row filtering
 * belong in an integration test against a real DB; here we focus on the
 * shape of the result and the projection into `AuditEntry`.
 */
function makeFakeDb(rows: AuditRow[]) {
  const calls: { limit?: number; sawWhere: boolean; sawOrderBy: boolean } = {
    sawWhere: false,
    sawOrderBy: false,
  };

  function select() {
    return {
      from(_table: unknown) {
        return {
          where(_cond: unknown) {
            calls.sawWhere = true;
            return {
              orderBy(..._args: unknown[]) {
                calls.sawOrderBy = true;
                return {
                  async limit(n: number) {
                    calls.limit = n;
                    return rows.slice(0, n);
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  const db = { select };
  return { db: db as unknown as Database, calls };
}

/**
 * Build an AuditRow with sensible defaults. Overrides win. Kept permissive
 * on types so callers can override null → Date on the fields they care
 * about without restating the whole row.
 */
function baseRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'audit_001',
    accountId: 'acct_abc',
    personaId: null,
    action: 'auth.login',
    entityType: null,
    entityId: null,
    metadata: null,
    ipAddress: null,
    userAgent: null,
    createdAt: new Date('2026-04-10T12:00:00Z'),
    ...overrides,
  };
}

describe('listAccountAudit', () => {
  it('returns projected entries with null nextCursor when there is only one page', async () => {
    const rows: AuditRow[] = [
      baseRow({ id: 'a', createdAt: new Date('2026-04-10T12:00:03Z') }),
      baseRow({ id: 'b', createdAt: new Date('2026-04-10T12:00:02Z') }),
      baseRow({ id: 'c', createdAt: new Date('2026-04-10T12:00:01Z') }),
    ];
    const { db, calls } = makeFakeDb(rows);

    const res = await listAccountAudit(db, {
      accountId: 'acct_abc',
      limit: 50,
    });

    expect(res.entries).toHaveLength(3);
    expect(res.nextCursor).toBeNull();
    // The op must over-fetch by one so the hasMore check is free.
    expect(calls.limit).toBe(51);
    expect(calls.sawWhere).toBe(true);
    expect(calls.sawOrderBy).toBe(true);

    // Projection: each entry round-trips the row into ISO createdAt.
    expect(res.entries[0]!.id).toBe('a');
    expect(res.entries[0]!.createdAt).toBe('2026-04-10T12:00:03.000Z');
  });

  it('sets nextCursor when the server returns one more row than the limit', async () => {
    // 3 rows, user-requested limit 2. Over-fetch pulls all 3; we slice to 2
    // and use the second (= last returned) row as the cursor basis.
    const rows: AuditRow[] = [
      baseRow({ id: 'a', createdAt: new Date('2026-04-10T12:00:03Z') }),
      baseRow({ id: 'b', createdAt: new Date('2026-04-10T12:00:02Z') }),
      baseRow({ id: 'c', createdAt: new Date('2026-04-10T12:00:01Z') }),
    ];
    const { db } = makeFakeDb(rows);

    const res = await listAccountAudit(db, {
      accountId: 'acct_abc',
      limit: 2,
    });

    expect(res.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).not.toBeNull();

    const decoded = decodeCursor(res.nextCursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe('b');
    expect(decoded!.createdAt).toBe('2026-04-10T12:00:02.000Z');
  });

  it('returns an empty page and null cursor when there are no entries', async () => {
    const { db, calls } = makeFakeDb([]);

    const res = await listAccountAudit(db, {
      accountId: 'acct_xyz',
      limit: 50,
    });

    expect(res.entries).toEqual([]);
    expect(res.nextCursor).toBeNull();
    expect(calls.limit).toBe(51);
  });

  it('does not set nextCursor when result count equals the limit exactly', async () => {
    // Exactly `limit` rows available — the over-fetch returns `limit`, not
    // `limit+1`, so hasMore is false and nextCursor must be null.
    const rows: AuditRow[] = [
      baseRow({ id: 'a', createdAt: new Date('2026-04-10T12:00:02Z') }),
      baseRow({ id: 'b', createdAt: new Date('2026-04-10T12:00:01Z') }),
    ];
    const { db } = makeFakeDb(rows);

    const res = await listAccountAudit(db, {
      accountId: 'acct_abc',
      limit: 2,
    });

    expect(res.entries).toHaveLength(2);
    expect(res.nextCursor).toBeNull();
  });

  it('accepts a cursor argument without throwing (the fake ignores filtering)', async () => {
    // Smoke-test: passing a decoded cursor must not alter the result shape
    // in this fake (which doesn't implement cursor filtering). The real test
    // of cursor filtering belongs to an integration test; here we just
    // verify the cursor path doesn't crash or change the contract.
    const rows: AuditRow[] = [
      baseRow({ id: 'a', createdAt: new Date('2026-04-10T12:00:02Z') }),
    ];
    const { db } = makeFakeDb(rows);

    const res = await listAccountAudit(db, {
      accountId: 'acct_abc',
      limit: 50,
      cursor: { createdAt: '2026-04-10T12:00:05Z', id: 'z' },
    });

    expect(res.entries).toHaveLength(1);
  });
});

describe('cursor codec', () => {
  it('round-trips {createdAt, id}', () => {
    const original = { createdAt: '2026-04-10T12:00:00.000Z', id: 'audit_xyz' };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  it('returns null for invalid base64', () => {
    expect(decodeCursor('!!!not base64!!!')).toBeNull();
  });

  it('returns null when fields are missing or wrong types', () => {
    const badShape = btoa(JSON.stringify({ createdAt: 123, id: 'x' }));
    expect(decodeCursor(badShape)).toBeNull();

    const missingId = btoa(JSON.stringify({ createdAt: '2026-04-10T12:00:00Z' }));
    expect(decodeCursor(missingId)).toBeNull();
  });
});

describe('toApiAuditEntry', () => {
  it('stringifies createdAt and keeps all other fields intact', () => {
    const row = baseRow({
      id: 'entry_1',
      accountId: 'acct_abc',
      personaId: 'persona_1',
      action: 'post.create',
      entityType: 'post',
      entityId: 'post_xyz',
      metadata: { foo: 'bar' },
      ipAddress: '10.0.0.1',
      userAgent: 'test-agent/1.0',
      createdAt: new Date('2026-04-10T12:00:00Z'),
    });

    const entry = toApiAuditEntry(row);

    expect(entry).toEqual({
      id: 'entry_1',
      accountId: 'acct_abc',
      personaId: 'persona_1',
      action: 'post.create',
      entityType: 'post',
      entityId: 'post_xyz',
      metadata: { foo: 'bar' },
      ipAddress: '10.0.0.1',
      userAgent: 'test-agent/1.0',
      createdAt: '2026-04-10T12:00:00.000Z',
    });
  });

  it('normalises missing metadata to null (not undefined)', () => {
    const entry = toApiAuditEntry(baseRow({ metadata: null }));
    expect(entry.metadata).toBeNull();
  });

  it('preserves nullable fields that were null on the row', () => {
    const entry = toApiAuditEntry(
      baseRow({
        personaId: null,
        entityType: null,
        entityId: null,
        ipAddress: null,
        userAgent: null,
      }),
    );
    expect(entry.personaId).toBeNull();
    expect(entry.entityType).toBeNull();
    expect(entry.entityId).toBeNull();
    expect(entry.ipAddress).toBeNull();
    expect(entry.userAgent).toBeNull();
  });
});
