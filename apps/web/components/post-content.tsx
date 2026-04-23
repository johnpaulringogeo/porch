'use client';

/**
 * `<PostContent>` renders a post/comment body with inline `@username` mentions
 * turned into `<UsernameLink>` links, while preserving all surrounding text
 * (including newlines — callers pair it with `whitespace-pre-wrap`).
 *
 * The tokenizer is `@porch/core/mention/extract`, the same pure helper the
 * server uses to extract mention targets for notification fan-out. Sharing the
 * regex means a mention that fires a `MentionedInComment` notification is
 * guaranteed to also render as a link in the UI — we can't drift out of sync
 * by duplicating the grammar.
 *
 * We import `extract` directly rather than the package's `./mention` barrel.
 * Tsconfig paths resolve `@porch/core/mention` to `mention/index.ts`, which
 * re-exports `resolveVisibleMentions` — and that helper pulls in drizzle and
 * the DB schema. Tree-shaking would likely drop it at bundle time, but the
 * direct import makes the intent explicit and keeps the web bundle's module
 * graph narrow by construction.
 *
 * Pass the same `className` you'd have used on the surrounding `<p>`. The
 * wrapping element is still a `<p>` so layout (line-height, text sizing,
 * spacing) is unchanged when swapping a raw `{post.content}` render over to
 * this component.
 *
 * An empty `content` string renders as an empty paragraph, same as before.
 */

import { tokenizeMentions } from '@porch/core/mention/extract';
import { UsernameLink } from '@/components/username-link';

interface PostContentProps {
  content: string;
  className?: string;
}

export function PostContent({ content, className }: PostContentProps) {
  const tokens = tokenizeMentions(content);

  if (tokens.length === 0) {
    return <p className={className} />;
  }

  return (
    <p className={className}>
      {tokens.map((token, i) => {
        if (token.type === 'text') {
          // Index-based keys are safe: `tokenizeMentions` returns a stable
          // order for a given input, and React only re-renders this list
          // when `content` itself changes.
          return <span key={i}>{token.value}</span>;
        }
        // Inline mentions reuse the site-wide `<UsernameLink>` so the URL
        // shape and hover treatment match post headers, contact rows, and
        // everywhere else a handle is clickable. We render the author's
        // as-typed form (`raw`) so casing like `@Alice` is preserved in
        // prose even though the link target is the lowercased handle.
        return (
          <UsernameLink key={i} username={token.username}>
            {token.raw}
          </UsernameLink>
        );
      })}
    </p>
  );
}
