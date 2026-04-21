'use client';

/**
 * Post detail / permalink — `/p/[postId]`.
 *
 * The first dedicated single-post view. Until now posts only existed inside
 * lists (home feed, profile, dashboard); a permalink unblocks two things
 * that lists can't:
 *
 *   - Sharing or returning to a specific post via URL.
 *   - Per-post author actions that don't fit in a list row (delete with a
 *     confirm step today; edit will live here too once we ship that UI).
 *
 * The page is a client component so the same fetch / 404 / 403 / 410 path
 * that powers /u/[username] applies here verbatim. Server-rendering this
 * would mean piping the access token through cookies and rebuilding the
 * api() helper for the server runtime — not worth the round-trip win for
 * a v0 surface that's almost always opened from a logged-in session.
 *
 * Status handling:
 *   404 → post never existed, was deleted, or the viewer's persona has been
 *         scoped out of its audience (the API maps audience-blocked reads
 *         to 404 to avoid confirming existence).
 *   403 → moderation-blocked even for the author (e.g., removed) — the API
 *         does still surface this for authors so they can see *why* their
 *         post is gone; non-authors get 404 in that case.
 *   401 → access token expired mid-load. AuthProvider's refresh loop will
 *         handle it on the next render; we just render the loading state
 *         and let the next fetch succeed.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { GetPostResponse } from '@porch/types/api';
import type { Post } from '@porch/types/domain';
import { ErrorCode } from '@porch/types';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTimestamp } from '@/lib/format-time';
import { UsernameLink } from '@/components/username-link';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; post: Post }
  | { kind: 'not-found' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'error'; message: string };

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;
  const { session, accessToken } = useAuth();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!postId || !accessToken) return;
      setState({ kind: 'loading' });
      try {
        const res = await api<GetPostResponse>({
          path: `/api/posts/${encodeURIComponent(postId)}`,
          accessToken,
          signal,
        });
        setState({ kind: 'ready', post: res.post });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          if (err.code === ErrorCode.NotFound) {
            setState({ kind: 'not-found' });
            return;
          }
          if (err.code === ErrorCode.Forbidden) {
            setState({ kind: 'forbidden', message: err.message });
            return;
          }
          // 401 surfaces here while an access-token refresh is in flight; the
          // surrounding AuthProvider will rotate the token and a re-render
          // will retry. Treat it as a transient loading state to avoid
          // flashing an error banner the user can't act on.
          if (err.status === 401) {
            setState({ kind: 'loading' });
            return;
          }
          setState({ kind: 'error', message: err.message });
          return;
        }
        setState({ kind: 'error', message: 'Could not load that post.' });
      }
    },
    [accessToken, postId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const onDelete = useCallback(async () => {
    if (state.kind !== 'ready' || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api<void>({
        method: 'DELETE',
        path: `/api/posts/${encodeURIComponent(state.post.id)}`,
        accessToken,
      });
      // The post is gone — bouncing back to the dashboard is the closest
      // thing to an "undo nothing happened" recovery. router.refresh on the
      // way out so my-posts re-fetches without the deleted row.
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'Could not delete that post.',
      );
      setDeleting(false);
    }
  }, [accessToken, deleting, router, state]);

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader />
      {renderBody({
        state,
        viewerPersonaId: session.persona.id,
        confirmingDelete,
        deleting,
        deleteError,
        onStartConfirmDelete: () => {
          setConfirmingDelete(true);
          setDeleteError(null);
        },
        onCancelConfirmDelete: () => setConfirmingDelete(false),
        onConfirmDelete: () => void onDelete(),
      })}
    </div>
  );
}

function PageHeader() {
  return (
    <div className="text-xs text-[hsl(var(--text-muted))]">
      <Link href="/feed" className="underline-offset-2 hover:underline">
        Feed
      </Link>
      <span aria-hidden="true"> › </span>
      <span>Post</span>
    </div>
  );
}

interface BodyProps {
  state: LoadState;
  viewerPersonaId: string;
  confirmingDelete: boolean;
  deleting: boolean;
  deleteError: string | null;
  onStartConfirmDelete: () => void;
  onCancelConfirmDelete: () => void;
  onConfirmDelete: () => void;
}

function renderBody(props: BodyProps): React.ReactNode {
  switch (props.state.kind) {
    case 'loading':
      return (
        <p className="text-sm text-[hsl(var(--text-muted))]">Loading post…</p>
      );
    case 'not-found':
      return (
        <Panel tone="muted" title="Post not found">
          This post may have been deleted, or you might not have access to it.
        </Panel>
      );
    case 'forbidden':
      return (
        <Panel tone="warning" title="Not visible">
          {props.state.message}
        </Panel>
      );
    case 'error':
      return (
        <Panel tone="error" title="Something went wrong">
          {props.state.message}
        </Panel>
      );
    case 'ready':
      return (
        <PostCard
          post={props.state.post}
          isAuthor={props.state.post.author.id === props.viewerPersonaId}
          confirmingDelete={props.confirmingDelete}
          deleting={props.deleting}
          deleteError={props.deleteError}
          onStartConfirmDelete={props.onStartConfirmDelete}
          onCancelConfirmDelete={props.onCancelConfirmDelete}
          onConfirmDelete={props.onConfirmDelete}
        />
      );
  }
}

interface PostCardProps {
  post: Post;
  isAuthor: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  deleteError: string | null;
  onStartConfirmDelete: () => void;
  onCancelConfirmDelete: () => void;
  onConfirmDelete: () => void;
}

function PostCard({
  post,
  isAuthor,
  confirmingDelete,
  deleting,
  deleteError,
  onStartConfirmDelete,
  onCancelConfirmDelete,
  onConfirmDelete,
}: PostCardProps) {
  return (
    <article className="space-y-4 rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-5">
      <header className="flex items-baseline gap-2">
        <UsernameLink
          username={post.author.username}
          className="text-sm font-semibold underline-offset-2 hover:underline"
        >
          {post.author.displayName}
        </UsernameLink>
        <UsernameLink
          username={post.author.username}
          className="text-xs text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
        />
      </header>

      <p className="whitespace-pre-wrap text-base leading-relaxed">
        {post.content}
      </p>

      <footer className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
        <time dateTime={post.createdAt}>{formatTimestamp(post.createdAt)}</time>
        {post.editedAt ? (
          <span title={`Last edited ${post.editedAt}`}>· edited</span>
        ) : null}
        <span aria-hidden="true">·</span>
        <ModeBadge mode={post.mode} />
        {post.audienceMode === 'selected' ? (
          <span className="rounded-full bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            selected audience
          </span>
        ) : null}
        {post.moderationState !== 'ok' ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
            {post.moderationState.replace('_', ' ')}
          </span>
        ) : null}
      </footer>

      {post.moderationReason ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {post.moderationReason}
        </p>
      ) : null}

      {isAuthor ? (
        <div className="border-t border-[hsl(var(--border-default))] pt-4">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[hsl(var(--text-muted))]">
                Delete this post? This can&apos;t be undone.
              </span>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={onCancelConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              {deleteError ? (
                <span role="alert" className="basis-full text-red-600">
                  {deleteError}
                </span>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={onStartConfirmDelete}
              className="inline-flex items-center rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete post
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: Post['mode'] }) {
  return (
    <span className="inline-flex items-center rounded-full bg-mode-home-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-mode-home">
      {mode}
    </span>
  );
}

interface PanelProps {
  tone: 'muted' | 'warning' | 'error';
  title: string;
  children: React.ReactNode;
}

function Panel({ tone, title, children }: PanelProps) {
  const toneClass =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] text-[hsl(var(--text-default))]';
  return (
    <div className={`space-y-1 rounded-lg border px-4 py-3 text-sm ${toneClass}`} role="status">
      <p className="font-medium">{title}</p>
      <p className="text-xs opacity-80">{children}</p>
    </div>
  );
}
