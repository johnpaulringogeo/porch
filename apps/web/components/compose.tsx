'use client';

/**
 * Home-mode post composer. v0 covers the two audience shapes the server
 * accepts (all_contacts | selected); the audience picker lives in its own
 * component and we just translate its state into the request body. Drafts,
 * mentions, and media still wait on their own milestones.
 *
 * Reports an ApiError inline rather than a toast. The dashboard owns re-
 * fetching the my-posts list via `onPosted` so we don't double-round-trip.
 * After a successful post we reset both the textarea and the audience back
 * to the All Contacts default — by-default each fresh post is a broadcast.
 */

import { useState } from 'react';
import type { Post } from '@porch/types/domain';
import { PostAudienceMode } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  AudiencePicker,
  type AudienceSelection,
} from '@/components/audience-picker';

const MAX_LENGTH = 4000;

interface ComposeProps {
  onPosted?: (post: Post) => void;
}

interface CreatePostResponse {
  post: Post;
}

const DEFAULT_AUDIENCE: AudienceSelection = {
  mode: PostAudienceMode.AllContacts,
  selectedIds: [],
};

export function Compose({ onPosted }: ComposeProps) {
  const { accessToken } = useAuth();
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState<AudienceSelection>(DEFAULT_AUDIENCE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = content.trim();
  // Mirrors CreatePostRequest's refine: selected mode requires ≥1 persona.
  const audienceValid =
    audience.mode === PostAudienceMode.AllContacts ||
    audience.selectedIds.length > 0;
  const canSubmit =
    trimmed.length > 0 &&
    trimmed.length <= MAX_LENGTH &&
    audienceValid &&
    !submitting;

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
          audienceMode: audience.mode,
          // Only include the array when it's actually used — keeps the
          // payload tidy and matches the schema's optional+refined shape.
          ...(audience.mode === PostAudienceMode.Selected
            ? { audiencePersonaIds: audience.selectedIds }
            : {}),
        },
        accessToken,
      });
      setContent('');
      setAudience(DEFAULT_AUDIENCE);
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

      <AudiencePicker
        value={audience}
        onChange={setAudience}
        disabled={submitting}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--text-muted))]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mode-home-surface px-2 py-0.5 font-medium text-mode-home ring-1 ring-mode-home/25">
            <span className="h-1 w-1 rounded-full bg-mode-home" />
            Home
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
