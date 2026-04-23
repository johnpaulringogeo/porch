import { describe, it, expect } from 'vitest';
import { extractMentions, tokenizeMentions } from './index.js';

describe('extractMentions', () => {
  it('pulls a single mention out of a sentence', () => {
    expect(extractMentions('hey @alice great post')).toEqual(['alice']);
  });

  it('returns mentions in order of first occurrence', () => {
    expect(extractMentions('@bob says hi to @alice then @carol')).toEqual(['bob', 'alice', 'carol']);
  });

  it('deduplicates repeated mentions, keeping first occurrence position', () => {
    expect(extractMentions('@alice @bob @alice @alice')).toEqual(['alice', 'bob']);
  });

  it('lowercases handles even if the author used mixed case', () => {
    expect(extractMentions('hi @Alice and @BOB')).toEqual(['alice', 'bob']);
  });

  it('treats mixed-case variants of the same handle as a single mention', () => {
    // Both @Alice and @alice are the same persona target, so we should not
    // produce two notification targets for one dedupe key.
    expect(extractMentions('@Alice and @alice')).toEqual(['alice']);
  });

  it('accepts hyphens in the middle of a handle', () => {
    expect(extractMentions('ping @alice-b when you get a chance')).toEqual(['alice-b']);
  });

  it('does not match @ inside an email address', () => {
    expect(extractMentions('contact me at alice@example.com')).toEqual([]);
  });

  it('still extracts the non-email mention alongside an email', () => {
    expect(extractMentions('email alice@example.com or ping @bob')).toEqual(['bob']);
  });

  it('strips trailing punctuation from the mention', () => {
    expect(extractMentions('@alice. and @bob!')).toEqual(['alice', 'bob']);
  });

  it('rejects handles below the 3-character minimum', () => {
    expect(extractMentions('@a and @ab are too short')).toEqual([]);
  });

  it('accepts exactly 3 characters (minimum length)', () => {
    expect(extractMentions('@abc is the shortest valid handle')).toEqual(['abc']);
  });

  it('accepts exactly 32 characters (maximum length)', () => {
    const handle = 'a' + 'b'.repeat(30) + 'c'; // 32 chars total
    expect(extractMentions(`long one: @${handle}`)).toEqual([handle]);
  });

  it('rejects handles longer than 32 characters (no truncation)', () => {
    // The trailing negative-lookahead in MENTION_REGEX prevents the regex
    // from matching a 32-char prefix of a longer handle — otherwise a
    // 33-char typo could silently target a real 32-char persona.
    const tooLong = 'a' + 'b'.repeat(31) + 'c'; // 33 chars
    expect(extractMentions(`@${tooLong}`)).toEqual([]);
  });

  it('also rejects an over-long handle when surrounded by whitespace', () => {
    const tooLong = 'a' + 'b'.repeat(31) + 'c';
    expect(extractMentions(`hey @${tooLong} there`)).toEqual([]);
  });

  it('trims a trailing hyphen (handles must end alphanumeric)', () => {
    // The grammar requires the last char to be [a-zA-Z0-9], so the regex
    // matches "alice" and leaves the dangling hyphen behind.
    expect(extractMentions('@alice-')).toEqual(['alice']);
  });

  it('returns an empty array for content with no mentions', () => {
    expect(extractMentions('just some regular prose here')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(extractMentions('')).toEqual([]);
  });

  it('handles mention at the very start of content', () => {
    expect(extractMentions('@alice is first')).toEqual(['alice']);
  });

  it('handles mention at the very end of content with no trailing space', () => {
    expect(extractMentions('last word is @bob')).toEqual(['bob']);
  });

  it('matches across newlines and other whitespace', () => {
    expect(extractMentions('line one\n@alice\n\tline two @bob')).toEqual(['alice', 'bob']);
  });
});

describe('tokenizeMentions', () => {
  it('returns an empty array for empty input', () => {
    expect(tokenizeMentions('')).toEqual([]);
  });

  it('returns a single text segment when there are no mentions', () => {
    expect(tokenizeMentions('no mentions here')).toEqual([
      { type: 'text', value: 'no mentions here' },
    ]);
  });

  it('tokenizes a single mention at the start', () => {
    expect(tokenizeMentions('@alice hi')).toEqual([
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: ' hi' },
    ]);
  });

  it('tokenizes a single mention in the middle', () => {
    expect(tokenizeMentions('hey @alice great post')).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: ' great post' },
    ]);
  });

  it('tokenizes a single mention at the end', () => {
    expect(tokenizeMentions('thanks @bob')).toEqual([
      { type: 'text', value: 'thanks ' },
      { type: 'mention', raw: '@bob', username: 'bob' },
    ]);
  });

  it('preserves original casing in raw but lowercases username', () => {
    expect(tokenizeMentions('ping @Alice-B now')).toEqual([
      { type: 'text', value: 'ping ' },
      { type: 'mention', raw: '@Alice-B', username: 'alice-b' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('tokenizes multiple mentions with text between them', () => {
    expect(tokenizeMentions('@alice and @bob and @carol')).toEqual([
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: ' and ' },
      { type: 'mention', raw: '@bob', username: 'bob' },
      { type: 'text', value: ' and ' },
      { type: 'mention', raw: '@carol', username: 'carol' },
    ]);
  });

  it('does not collapse repeated mentions — tokens mirror the source', () => {
    // extractMentions dedupes for fan-out, but tokenizeMentions must preserve
    // every occurrence so the rendered output matches what the user wrote.
    const tokens = tokenizeMentions('@alice @alice');
    expect(tokens).toEqual([
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: ' ' },
      { type: 'mention', raw: '@alice', username: 'alice' },
    ]);
  });

  it('leaves email addresses as plain text', () => {
    expect(tokenizeMentions('email alice@example.com for details')).toEqual([
      { type: 'text', value: 'email alice@example.com for details' },
    ]);
  });

  it('separates a mention from a following email in one string', () => {
    expect(tokenizeMentions('@alice see alice@example.com')).toEqual([
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: ' see alice@example.com' },
    ]);
  });

  it('keeps punctuation immediately after a mention in the next text segment', () => {
    expect(tokenizeMentions('@alice. next sentence')).toEqual([
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: '. next sentence' },
    ]);
  });

  it('rejects sub-minimum handles by emitting the whole content as text', () => {
    expect(tokenizeMentions('@ab is too short')).toEqual([
      { type: 'text', value: '@ab is too short' },
    ]);
  });

  it('preserves whitespace, newlines, and unicode in text segments', () => {
    expect(tokenizeMentions('line one\n@alice\n🎉 done')).toEqual([
      { type: 'text', value: 'line one\n' },
      { type: 'mention', raw: '@alice', username: 'alice' },
      { type: 'text', value: '\n🎉 done' },
    ]);
  });

  it('produces a token sequence whose raw concatenation reconstructs the input', () => {
    // Stable-ordering guarantee — if a renderer joins all segment values back
    // together it should get the original content verbatim.
    const input = 'hey @Alice and @bob-c, email a@b.com please';
    const tokens = tokenizeMentions(input);
    const joined = tokens
      .map((t) => (t.type === 'text' ? t.value : t.raw))
      .join('');
    expect(joined).toBe(input);
  });
});
