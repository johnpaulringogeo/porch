/**
 * Mentions — pure extractors + audience-gated resolver.
 *
 * Two halves with deliberately different dependency footprints:
 *   - `extract.ts` is pure string work (regex + iteration). Safe to import
 *     anywhere, including the web client, since it pulls in zero runtime
 *     deps beyond the standard library.
 *   - `resolve.ts` is the server-side audience gate. It takes an already-
 *     extracted list of handles and decides who should actually receive a
 *     mention notification based on persona existence + post visibility.
 *
 * Fan-out writers (createPost / createComment) compose the two:
 *   extractMentions(content)
 *     → resolveVisibleMentions(db, usernames, { author, audienceMode, ... })
 *     → one `createNotification` per returned persona ID.
 */
export { extractMentions, tokenizeMentions } from './extract.js';
export type { TextSegment, MentionSegment, MentionToken } from './extract.js';
export { resolveVisibleMentions } from './resolve.js';
export type { MentionVisibilityContext } from './resolve.js';
