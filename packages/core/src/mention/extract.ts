/**
 * Mention extraction and tokenization.
 *
 * Pure string helpers. No DB access, no network, no I/O. Used by:
 *   - the server (createPost / createComment) to pull out mention targets for
 *     notification fan-out, and
 *   - the web client to render inline `@username` links inside post/comment
 *     bodies without having to duplicate the regex.
 *
 * Grammar matches `USERNAME_REGEX` from persona/validate.ts but with a
 * case-insensitive character class — users commonly type `@Alice` when they
 * mean `@alice`, and the persona table stores usernames lowercase, so we
 * lowercase at extraction time. The lookbehind prevents email addresses (the
 * `@` in `a@b.com`) from counting as a mention.
 *
 * Length constraint mirrors the persona grammar exactly: 3–32 chars, start
 * and end alphanumeric, hyphens allowed in the middle. Anything longer or
 * shorter silently doesn't match — an author who mis-types a handle just
 * gets no fan-out, which is the right failure mode.
 */

/**
 * Single source of truth for the mention pattern. Capture group 1 is the
 * bare username (no leading `@`). The lookbehind on `[a-zA-Z0-9]` keeps us
 * from matching inside email addresses, filenames, or anything where the
 * `@` is preceded by an alphanumeric character.
 *
 *   "hey @alice great post"         → ["alice"]
 *   "contact me at a@b.com"         → []
 *   "@alice. and @bob!"             → ["alice", "bob"]   (trailing punctuation not captured)
 *   "@Alice-B thoughts?"            → ["alice-b"]        (casing preserved in tokens; lowercase in extract)
 *   "@a"                            → []                 (below 3-char minimum)
 *   "@alice-"                       → ["alice"]          (trailing hyphen excluded; username must end alphanumeric)
 *   "double @@alice"                → ["alice"]          (first `@` fails because the next char isn't alphanumeric;
 *                                                         the second `@` succeeds because its lookbehind char is
 *                                                         `@` which is non-alphanumeric. Rare input; author almost
 *                                                         certainly meant to mention so matching is the right call.)
 *
 * The trailing `(?![a-zA-Z0-9])` lookahead prevents over-long handles from
 * matching a 32-char prefix: without it, `@` followed by 33 alphanumerics
 * would still match the first 32 and silently target a different persona
 * (a real collision risk if that 32-char handle happens to exist). A
 * trailing hyphen is tolerated — `@alice-` still extracts `alice`, since
 * `-` isn't alphanumeric and so doesn't trip the lookahead.
 *
 * Global flag is required for `matchAll`. Don't make this a module-level
 * reusable RegExp for `.test()` / `.exec()` — the lastIndex state would
 * leak across calls. `matchAll` reads the pattern fresh each invocation.
 */
const MENTION_REGEX = /(?<![a-zA-Z0-9])@([a-zA-Z0-9][a-zA-Z0-9-]{1,30}[a-zA-Z0-9])(?![a-zA-Z0-9])/g;

/**
 * Extract unique @username mentions from a piece of content, preserving the
 * order of first occurrence. All results are lowercased so callers can use
 * them directly as keys against `persona.username` (which is stored
 * lowercase by the username validator).
 *
 * Returns an empty array when the content has no mentions — callers can
 * early-return on `.length === 0` to skip fan-out work entirely.
 */
export function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of content.matchAll(MENTION_REGEX)) {
    const lower = match[1]!.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
    }
  }
  return out;
}

/**
 * Plain-text segment of content between (or outside) mentions. Preserved
 * verbatim — whitespace, punctuation, emoji, and unicode all pass through
 * untouched.
 */
export interface TextSegment {
  type: 'text';
  value: string;
}

/**
 * A mention occurrence with both the as-typed surface form (for display)
 * and the lowercased handle (the link target / persona lookup key).
 *
 *   raw      — exactly what the author typed, including the leading `@` and
 *              any original casing. Renderers can show this verbatim so
 *              "`@Alice`" doesn't get flattened to "`@alice`" in prose.
 *   username — the lowercased handle, safe to compare against persona rows.
 */
export interface MentionSegment {
  type: 'mention';
  /** The matched substring as it appears in the source, including the `@`. */
  raw: string;
  /** Lowercased handle, suitable for `persona.username` lookup and URL use. */
  username: string;
}

export type MentionToken = TextSegment | MentionSegment;

/**
 * Split content into an ordered list of text and mention segments so a
 * renderer can emit plain text as-is and wrap mentions in a link (or any
 * other element) without re-tokenizing.
 *
 * Empty input returns an empty array, not `[{type:'text', value:''}]`.
 * Content with no mentions returns exactly one text segment holding the
 * whole string.
 *
 * The token sequence is stable: consumers can `.map()` with an index-based
 * key without worrying about re-ordering between renders on the same input.
 */
export function tokenizeMentions(content: string): MentionToken[] {
  if (content.length === 0) return [];

  const tokens: MentionToken[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(MENTION_REGEX)) {
    const start = match.index!;
    if (start > lastIndex) {
      tokens.push({ type: 'text', value: content.slice(lastIndex, start) });
    }
    tokens.push({
      type: 'mention',
      raw: match[0],
      username: match[1]!.toLowerCase(),
    });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < content.length) {
    tokens.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return tokens;
}
