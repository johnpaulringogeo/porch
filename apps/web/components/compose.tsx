'use client';

/**
 * Home-mode post composer. v0 is deliberately bare:
 *   - one textarea, 4000-char limit (matches CreatePostRequest on the server)
 *   - always Home mode, always all_contacts audience
 *   - no drafts, no mentions, no media — those come with their own milestones
 *
 * Reports an ApiError inline rather than a toast. The dashboard owns re-
 * fetching the my-posts list via `onPosted` so we don't double-round-trip.
 */

import { useState } from 'react';
import type { Post } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const MAX_LENGTH = 4000;

interface ComposeProps {
  onPosted?: (post: Post) => void;
}

interface CreatePostResponse {
  post: Post;
}

export function Compose({ onPosted }: ComposeProps) {
  const { accessToken } = useAuth();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<CreatePostResponse>({
        method: 'POST',
        path: '/api/posts',
        body: {
          mode: 'home',
          content: trimmed,
          audienceMode: 'all_contacts',
        },
        accessToken,
      });
      setContent('');
      onPosted?.(res.post);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong while posting. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = MAX_LENGTH - content.length;
  const overLimit = remaining < 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="compose" className="sr-only">
        What&apos;s on your mind?
      </label>
      <textarea
        id="compose"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Share something with your contacts…"
        className="w-full resize-y rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-3 text-sm placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-mode-home/40"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--text-muted))]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mode-home-surface px-2 py-0.5 font-medium text-mode-home ring-1 ring-mode-home/25">
            <span className="h-1 w-1 rounded-full bg-mode-home" />
            Home · all contacts
          </span>
          <span className={overLimit ? 'text-red-600' : undefined}>
            {remaining} left
          </span>
        </div>
        <button
          type="submit"
          disabled={!canSubmit || overLimit}
          className="rounded-md bg-mode-home px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
