'use client';

/**
 * Post detail / permalink — `/p/[postId]`.
 *
 * The first dedicated single-post view. Until now posts only existed inside
 * lists (home feed, profile, dashboard); a permalink unblocks two things
 * that lists can't:
 *
 *   - Sharing or returning to a specific post via URL.
 *   - Per-post author actions that don't fit in a list row (inline edit +
 *     delete-with-confirm live here; a 4000-char textarea has no business
 *     in a feed row).
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
 *
 * Author-action state (editing, delete-confirming, in-flight saves) lives
 * inside <PostCard> rather than bubbling up here. The page only cares about
 * the raw post + two terminal events — "edited to this" (update state) and
 * "deleted" (route away). Keeps the prop list for PostCard sane and keeps
 * state transitions local to the one component that uses them.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  CommentSummary,
  EditPostResponse,
  GetPostResponse,
  LikePostResponse,
  LikeSummary,
} from '@porch/types/api';
import type { Post, PublicPersona } from '@porch/types/domain';
import { ErrorCode } from '@porch/types';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTimestamp } from '@/lib/format-time';
import { UsernameLink } from '@/components/username-link';
import { CommentsSection } from '@/components/comments-section';

const POST_CONTENT_MAX = 4000;

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      post: Post;
      audiencePersonas: PublicPersona[] | null;
      likeSummary: LikeSummary;
      commentSummary: CommentSummary;
    }
  | { kind: 'not-found' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'error'; message: string };

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;
  const { session, accessToken } = useAuth();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

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
        setState({
          kind: 'ready',
          post: res.post,
          audiencePersonas: res.audiencePersonas,
          likeSummary: res.likeSummary,
          commentSummary: res.commentSummary,
        });
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

  const onEdited = useCallback((post: Post) => {
    // Audience can't change via PATCH (the route is content-only), so reuse
    // whatever we already loaded rather than re-fetching the full GET. Same
    // for likeSummary — likes are independent of edits and the LikeButton
    // owns its own post-mount state, so the seed value here only matters
    // until the next click. commentSummary is likewise unaffected by edits
    // (editing a post doesn't change the comment count) so preserve it.
    setState((prev) =>
      prev.kind === 'ready'
        ? {
            kind: 'ready',
            post,
            audiencePersonas: prev.audiencePersonas,
            likeSummary: prev.likeSummary,
            commentSummary: prev.commentSummary,
          }
        : {
            kind: 'ready',
            post,
            audiencePersonas: null,
            likeSummary: { liked: false, totalLikes: 0 },
            commentSummary: { totalComments: 0 },
          },
    );
  }, []);

  const onCommentSummaryChange = useCallback((next: CommentSummary) => {
    setState((prev) =>
      prev.kind === 'ready' ? { ...prev, commentSummary: next } : prev,
    );
  }, []);

  const onDeleted = useCallback(() => {
    // The post is gone — bouncing back to the dashboard is the closest thing
    // to an "undo nothing happened" recovery. router.refresh so my-posts
    // re-fetches without the deleted row.
    router.replace('/dashboard');
    router.refresh();
  }, [router]);

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader />
      {renderBody(
        state,
        session.persona.id,
        accessToken,
        onEdited,
        onDeleted,
        onCommentSummaryChange,
      )}
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

function renderBody(
  state: LoadState,
  viewerPersonaId: string,
  accessToken: string | null,
  onEdited: (post: Post) => void,
  onDeleted: () => void,
  onCommentSummaryChange: (summary: CommentSummary) => void,
): React.ReactNode {
  switch (state.kind) {
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
          {state.message}
        </Panel>
      );
    case 'error':
      return (
        <Panel tone="error" title="Something went wrong">
          {state.message}
        </Panel>
      );
    case 'ready':
      return (
        <>
          <PostCard
            post={state.post}
            audiencePersonas={state.audiencePersonas}
            likeSummary={state.likeSummary}
            isAuthor={state.post.author.id === viewerPersonaId}
            accessToken={accessToken}
            onEdited={onEdited}
            onDeleted={onDeleted}
          />
          <CommentsSection
            postId={state.post.id}
            viewerPersonaId={viewerPersonaId}
            initialSummary={state.commentSummary}
            accessToken={accessToken}
            onSummaryChange={onCommentSummaryChange}
          />
        </>
      );
  }
}

// ── PostCard ──────────────────────────────────────────────────────────────

interface PostCardProps {
  post: Post;
  /**
   * Personas in the selected audience. Only populated by the API when the
   * viewer is the post's author and audienceMode === 'selected'; null in
   * every other case. Empty array is possible (and notable) when every
   * person who was originally in the audience has since been removed as a
   * contact.
   */
  audiencePersonas: PublicPersona[] | null;
  /**
   * Initial like state for this (post, viewer) pair. The LikeButton owns
   * subsequent state — it's seeded once at mount and never re-synced from
   * this prop, so a parent re-render won't clobber an in-flight toggle.
   */
  likeSummary: LikeSummary;
  isAuthor: boolean;
  accessToken: string | null;
  onEdited: (post: Post) => void;
  onDeleted: () => void;
}

function PostCard({
  post,
  audiencePersonas,
  likeSummary,
  isAuthor,
  accessToken,
  onEdited,
  onDeleted,
}: PostCardProps) {
  // Edit state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete state
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setEditing(true);
    setDraft(post.content);
    setSaveError(null);
    // An open delete confirm would be wildly confusing next to an edit
    // textarea — close it.
    setConfirmingDelete(false);
    setDeleteError(null);
  }, [post.content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(post.content);
    setSaveError(null);
  }, [post.content]);

  const trimmedDraft = draft.trim();
  const unchanged = trimmedDraft === post.content.trim();
  const tooLong = trimmedDraft.length > POST_CONTENT_MAX;
  const saveDisabled = saving || unchanged || trimmedDraft.length === 0 || tooLong;

  const save = useCallback(async () => {
    if (saveDisabled) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api<EditPostResponse>({
        method: 'PATCH',
        path: `/api/posts/${encodeURIComponent(post.id)}`,
        accessToken,
        body: { content: trimmedDraft },
      });
      setEditing(false);
      onEdited(res.post);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : 'Could not save your changes.',
      );
    } finally {
      setSaving(false);
    }
  }, [accessToken, onEdited, post.id, saveDisabled, trimmedDraft]);

  const startConfirmDelete = useCallback(() => {
    setConfirmingDelete(true);
    setDeleteError(null);
  }, []);
  const cancelConfirmDelete = useCallback(() => {
    setConfirmingDelete(false);
  }, []);
  const confirmDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api<void>({
        method: 'DELETE',
        path: `/api/posts/${encodeURIComponent(post.id)}`,
        accessToken,
      });
      onDeleted();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'Could not delete that post.',
      );
      setDeleting(false);
    }
  }, [accessToken, deleting, onDeleted, post.id]);

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

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            maxLength={POST_CONTENT_MAX}
            disabled={saving}
            aria-label="Edit post content"
            className="w-full resize-y rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[hsl(var(--text-default))] disabled:opacity-60"
          />
          <div className="flex items-center justify-between text-xs text-[hsl(var(--text-muted))]">
            <span>
              {draft.length}/{POST_CONTENT_MAX}
            </span>
            {unchanged ? <span>No changes to save.</span> : null}
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-base leading-relaxed">
          {post.content}
        </p>
      )}

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

      {audiencePersonas ? <AudienceList personas={audiencePersonas} /> : null}

      <LikeBar
        postId={post.id}
        initial={likeSummary}
        isAuthor={isAuthor}
        accessToken={accessToken}
      />

      {post.moderationReason ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {post.moderationReason}
        </p>
      ) : null}

      {isAuthor ? (
        <div className="border-t border-[hsl(var(--border-default))] pt-4">
          {editing ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saveDisabled}
                className="inline-flex items-center rounded-md bg-mode-home px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              {saveError ? (
                <span role="alert" className="basis-full text-red-600">
                  {saveError}
                </span>
              ) : null}
            </div>
          ) : confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[hsl(var(--text-muted))]">
                Delete this post? This can&apos;t be undone.
              </span>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={cancelConfirmDelete}
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
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 font-medium hover:bg-[hsl(var(--surface-muted))]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={startConfirmDelete}
                className="inline-flex items-center rounded-md border border-red-200 px-2.5 py-1 font-medium text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────

/**
 * Author-only summary of who can see a `selected`-audience post. Renders
 * @username links so the author can jump straight to a recipient's profile
 * (e.g. to verify they meant to include them). The empty array case is
 * worth surfacing on its own — it means everyone the author originally
 * targeted has since been removed as a contact, so nobody can see this post
 * but them.
 */
function AudienceList({ personas }: { personas: PublicPersona[] }) {
  if (personas.length === 0) {
    return (
      <p className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] px-3 py-2 text-xs text-[hsl(var(--text-muted))]">
        Visible to: no current contacts. Everyone in the original audience has
        since been removed.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] px-3 py-2 text-xs text-[hsl(var(--text-muted))]">
      <span className="font-medium text-[hsl(var(--text-default))]">
        Visible to:
      </span>
      {personas.map((p, i) => (
        <span key={p.id} className="inline-flex items-baseline">
          <UsernameLink username={p.username} />
          {i < personas.length - 1 ? <span aria-hidden="true">,</span> : null}
        </span>
      ))}
    </p>
  );
}

/**
 * Like button + count for a post, with optimistic toggle.
 *
 * Owns its own state independent of the parent — `initial` is the seed value
 * from the page load, and after that the server response is the authority.
 * Optimistic flow:
 *   1) flip `liked` and adjust `totalLikes` ±1 immediately
 *   2) POST /api/posts/:id/like
 *   3) on success: replace state with the server's summary
 *   4) on failure: revert the optimistic change and surface an inline error
 *
 * Authors don't get a button (you can't like your own post — the API rejects
 * it). They still see the count, since "people liked this" is the whole
 * reason the bar exists for them.
 *
 * The button is disabled while a request is in flight to keep the
 * server-state and the displayed-state in lockstep — back-to-back clicks
 * during a slow network would race each other and the second response would
 * silently overwrite the first.
 */
interface LikeBarProps {
  postId: string;
  initial: LikeSummary;
  isAuthor: boolean;
  accessToken: string | null;
}

function LikeBar({ postId, initial, isAuthor, accessToken }: LikeBarProps) {
  const [summary, setSummary] = useState<LikeSummary>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (pending) return;
    const previous = summary;
    const optimistic: LikeSummary = {
      liked: !previous.liked,
      totalLikes: previous.totalLikes + (previous.liked ? -1 : 1),
    };
    setSummary(optimistic);
    setPending(true);
    setError(null);
    try {
      const res = await api<LikePostResponse>({
        method: 'POST',
        path: `/api/posts/${encodeURIComponent(postId)}/like`,
        accessToken,
      });
      setSummary(res.likeSummary);
    } catch (err) {
      setSummary(previous);
      setError(
        err instanceof ApiError ? err.message : 'Could not update your like.',
      );
    } finally {
      setPending(false);
    }
  }, [accessToken, pending, postId, summary]);

  const countLabel = `${summary.totalLikes} ${summary.totalLikes === 1 ? 'like' : 'likes'}`;

  if (isAuthor) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">{countLabel}</p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={summary.liked}
        aria-label={summary.liked ? 'Unlike this post' : 'Like this post'}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          summary.liked
            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-[hsl(var(--border-default))] bg-white text-[hsl(var(--text-default))] hover:bg-[hsl(var(--surface-muted))]'
        }`}
      >
        <span aria-hidden="true">{summary.liked ? '♥' : '♡'}</span>
        <span>{summary.liked ? 'Liked' : 'Like'}</span>
      </button>
      <span className="text-[hsl(var(--text-muted))]">{countLabel}</span>
      {error ? (
        <span role="alert" className="basis-full text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

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
