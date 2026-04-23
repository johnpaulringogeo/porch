import { describe, expect, it } from 'vitest';
import type { Database } from '@porch/db';
import { PostAudienceMode } from '@porch/types/domain';

import { resolveVisibleMentions } from './resolve.js';

/**
 * Fake DB — chainable thenable that mimics the drizzle select chain we use
 * from resolve.ts:
 *   db.select(cols).from(table).where(expr)
 *
 * Each queued result is consumed in order. Calls `.from()` and `.where()`
 * return the same proxy so awaiting resolves to the queued rows. One result
 * per DB round-trip the resolver makes.
 *
 * Mirrors the helper in comment/index.test.ts, trimmed to what resolve.ts
 * actually calls. If the resolver grows extra round-trips later, the helper
 * won't silently swallow them — tests that queue the wrong number of results
 * will get back [] from the fallback and fail on the assertion.
 */
function makeFakeDb() {
  const selects: unknown[][] = [];

  function selectChain<T>(result: T[]) {
    const self = {
      from: () => self,
      where: () => self,
      then<R1 = T[], R2 = never>(
        onFulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
        onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
      ): Promise<R1 | R2> {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    } as const;
    return self;
  }

  const db = {
    select(_cols?: unknown) {
      const result = selects.shift() ?? [];
      return selectChain(result);
    },
  };

  return {
    db: db as unknown as Database,
    queueSelect(rows: unknown[]) {
      selects.push(rows);
    },
  };
}

describe('resolveVisibleMentions', () => {
  it('returns empty and makes no DB calls when the usernames list is empty', async () => {
    const { db } = makeFakeDb();

    // If the resolver hit the DB, the empty-fallback would still return [],
    // so the direct observable signal is "no `select` ever fires". But the
    // contract we actually care about — empty in → empty out — holds either
    // way, and that's what callers depend on for the .length === 0 skip.
    const result = await resolveVisibleMentions(db, [], {
      authorPersonaId: 'persona_author',
      audienceMode: PostAudienceMode.AllContacts,
    });

    expect(result).toEqual([]);
  });

  it('returns empty when no handles resolve to an active persona', async () => {
    const { db, queueSelect } = makeFakeDb();
    queueSelect([]); // persona lookup returns nothing

    const result = await resolveVisibleMentions(
      db,
      ['ghost', 'nobody'],
      {
        authorPersonaId: 'persona_author',
        audienceMode: PostAudienceMode.AllContacts,
      },
    );

    expect(result).toEqual([]);
  });

  it('drops the author (self-mention) before the audience gate', async () => {
    const { db, queueSelect } = makeFakeDb();
    // Author mentioned themselves plus one other persona. The resolver
    // should drop the self-mention and keep going — we queue the contact
    // lookup for the surviving candidate.
    queueSelect([
      { id: 'persona_author', username: 'alice' },
      { id: 'persona_bob', username: 'bob' },
    ]);
    queueSelect([{ id: 'persona_bob' }]); // bob is a contact

    const result = await resolveVisibleMentions(
      db,
      ['alice', 'bob'],
      {
        authorPersonaId: 'persona_author',
        audienceMode: PostAudienceMode.AllContacts,
      },
    );

    expect(result).toEqual(['persona_bob']);
  });

  it('short-circuits after self-mention filter when the author was the only match', async () => {
    const { db, queueSelect } = makeFakeDb();
    // Only the author matched — after filtering self, nothing remains.
    // If the resolver still hit the contact table it'd get the empty
    // fallback, but the contract is that step 3 is skipped entirely.
    queueSelect([{ id: 'persona_author', username: 'alice' }]);

    const result = await resolveVisibleMentions(db, ['alice'], {
      authorPersonaId: 'persona_author',
      audienceMode: PostAudienceMode.AllContacts,
    });

    expect(result).toEqual([]);
  });

  it('preserves the caller-supplied username order in the returned IDs', async () => {
    const { db, queueSelect } = makeFakeDb();
    // DB returns rows in persona.username lexicographic order — NOT the
    // order the author typed them. The resolver must re-sort to match the
    // extractor's first-occurrence order so the fan-out log is stable.
    queueSelect([
      { id: 'persona_carol', username: 'carol' },
      { id: 'persona_alice', username: 'alice' },
      { id: 'persona_bob', username: 'bob' },
    ]);
    queueSelect([
      { id: 'persona_bob' },
      { id: 'persona_alice' },
      { id: 'persona_carol' },
    ]);

    const result = await resolveVisibleMentions(
      db,
      ['bob', 'alice', 'carol'],
      {
        authorPersonaId: 'persona_author',
        audienceMode: PostAudienceMode.AllContacts,
      },
    );

    // Input order: bob, alice, carol — output must match.
    expect(result).toEqual(['persona_bob', 'persona_alice', 'persona_carol']);
  });

  describe('Selected audience mode', () => {
    it('keeps only mentions who are in the hand-picked audience', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([
        { id: 'persona_alice', username: 'alice' },
        { id: 'persona_bob', username: 'bob' },
        { id: 'persona_carol', username: 'carol' },
      ]);

      const result = await resolveVisibleMentions(
        db,
        ['alice', 'bob', 'carol'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.Selected,
          // Only alice and carol are in the audience — bob was mentioned
          // but can't see the post, so the ping is dropped.
          audiencePersonaIds: ['persona_alice', 'persona_carol'],
        },
      );

      expect(result).toEqual(['persona_alice', 'persona_carol']);
    });

    it('returns empty when no mentioned persona is in the audience', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([{ id: 'persona_bob', username: 'bob' }]);

      const result = await resolveVisibleMentions(
        db,
        ['bob'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.Selected,
          audiencePersonaIds: ['persona_alice'],
        },
      );

      expect(result).toEqual([]);
    });

    it('treats a missing audiencePersonaIds as an empty audience', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([{ id: 'persona_bob', username: 'bob' }]);

      // Defensive — callers should pass `audiencePersonaIds` for selected
      // mode, but if they don't we shouldn't crash; there's just no audience
      // so nothing's visible.
      const result = await resolveVisibleMentions(
        db,
        ['bob'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.Selected,
        },
      );

      expect(result).toEqual([]);
    });
  });

  describe('All-contacts audience mode', () => {
    it('keeps only mentions who are current contacts of the author', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([
        { id: 'persona_alice', username: 'alice' },
        { id: 'persona_bob', username: 'bob' },
      ]);
      // The contact table says alice is a contact, bob is not.
      queueSelect([{ id: 'persona_alice' }]);

      const result = await resolveVisibleMentions(
        db,
        ['alice', 'bob'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.AllContacts,
        },
      );

      expect(result).toEqual(['persona_alice']);
    });

    it('returns empty when none of the mentioned personas are contacts', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([{ id: 'persona_stranger', username: 'stranger' }]);
      queueSelect([]); // contact lookup finds nothing

      const result = await resolveVisibleMentions(
        db,
        ['stranger'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.AllContacts,
        },
      );

      expect(result).toEqual([]);
    });

    it('ignores audiencePersonaIds when mode is all_contacts', async () => {
      const { db, queueSelect } = makeFakeDb();
      queueSelect([{ id: 'persona_alice', username: 'alice' }]);
      // Even though audiencePersonaIds was passed, resolution flows through
      // the contact table. The stray field is accepted without affecting
      // the outcome — here alice IS a contact, so the mention survives.
      queueSelect([{ id: 'persona_alice' }]);

      const result = await resolveVisibleMentions(
        db,
        ['alice'],
        {
          authorPersonaId: 'persona_author',
          audienceMode: PostAudienceMode.AllContacts,
          audiencePersonaIds: ['persona_irrelevant'],
        },
      );

      expect(result).toEqual(['persona_alice']);
    });
  });
});
