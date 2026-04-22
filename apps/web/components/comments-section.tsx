'use client';

/**
 * Comments section for the post detail page (`/p/[postId]`).
 *
 * Self-contained: loads the first page of comments on mount, maintains a
 * paginated list, and exposes a composer + per-comment delete affordance
 * for the author. Errors are rendered inline rather than bubbling up to the
 * page — the rest of the post should stay visible even if the comment list
 * hiccups.
 *
 * State model is deliberately simple:
 *   - `comments` is an append-only array in display order (newest first).
 *     Pagination appends older rows to the end; creates prepend to the top;
 *     deletes remove by id in place.
 *   - `summary` is the server-authoritative total. Every mutation response
 *     carries a fresh summary so the page-level count pill on the parent
 *     can stay coherent via `onSummaryChange`.
 *   - `nextCursor` drives the "Load more" footer. Null means we've reached
 *     the end.
 *
 * Optimism is intentionally skipped here. Comments are cheap to create and
 * the server round-trip is fast; a pessimistic create keeps the UI simple
 * (no rollback on failure, no temporary ids) and avoids a class of bugs
 * around duplicate-id reconciliation after the real row comes back. The
 * textarea is disabled during the request, and the create button label
 * flips to "Posting…" so the user knows something is happening.
 *
 * Author-only delete: if the viewer authored a comment, a small "Delete"
 * button appears inline. The server returns 404 for non-author deletes so
 * we also hide the button locally to avoid the confusing "appeared to
 * work, but didn't" round-trip.
 *
 * Author-only edit: same gating as delete. Edit swaps the body for an
 * inline textarea with Save/Cancel; saving calls PATCH and replaces the
 * row in place (server returns the hydrated Comment, including a fresh
 * `editedAt`). An "(edited)" indicator appears next to the timestamp once
 * a comment has ever been edited — the server stamps `editedAt` on every
 * successful PATCH, including no-op edits, so the indicator is a reliable
 * "this author came back to this" signal.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  CommentSummary,
  CreateCommentResponse,
  DeleteCommentResponse,
  ListCommentsResponse,
  UpdateCommentResponse,
} from '@porch/types/api';
import type { Comment } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { formatTimestamp } from '@/lib/format-time';
import { UsernameLink } from '@/components/username-link';

const COMMENT_CONTENT_MAX = 4000;

interface CommentsSectionProps {
  postId: string;
  /** Viewer's persona id — used to decide whether to show the delete button. */
  viewerPersonaId: string;
  /**
   * Seed summary from the post GET. The section takes over as the source of
   * truth once the first list page loads; this only matters for the very
   * first paint where the list hasn't resolved yet.
   */
  initialSummary: CommentSummary;
  accessToken: string | null;
  /**
   * Notify the parent page when the total count changes (create/delete).
   * The page displays the same number in its header stats, and also keeps
   * it in local state so a later re-render of this component can seed the
   * composer's "0 comments" hint without a refetch.
   */
  onSummaryChange?: (summary: CommentSummary) => void;
}

export function CommentsSection({
  postId,
  viewerPersonaId,
  initialSummary,
  accessToken,
  onSummaryChange,
}: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [summary, setSummary] = useState<CommentSummary>(initialSummary);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Composer state. Trimmed length drives the submit-enabled check so a
  // textarea full of whitespace can't hit the server.
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Per-comment deletion state — keyed by id so multiple in-flight deletes
  // stay independent (unlikely in practice but cheap to support).
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Per-comment edit state. Three maps keyed by comment id:
  //   editDrafts — the textarea contents while the row is in edit mode.
  //                Presence of a key means "this row is currently editing".
  //   savingIds  — which rows have a PATCH in flight (disables Save/Cancel,
  //                flips the button label).
  //   editErrors — per-row inline error for the last failed save; cleared
  //                on the next keystroke or on Cancel.
  // Kept as separate maps/sets rather than one "edit state" object so each
  // React state update touches the smallest possible slice and doesn't
  // blow away sibling edits.
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const updateSummary = useCallback(
    (next: CommentSummary) => {
      setSummary(next);
      onSummaryChange?.(next);
    },
    [onSummaryChange],
  );

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      if (!accessToken) return;
      setLoadingInitial(true);
      setLoadError(null);
      try {
        const res = await api<ListCommentsResponse>({
          path: `/api/posts/${encodeURIComponent(postId)}/comments`,
          accessToken,
          signal,
        });
        setComments(res.comments);
        setNextCursor(res.nextCursor);
        updateSummary(res.commentSummary);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(
          err instanceof ApiError ? err.message : 'Could not load comments.',
        );
      } finally {
        setLoadingInitial(false);
      }
    },
    [accessToken, postId, updateSummary],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadFirstPage(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await api<ListCommentsResponse>({
        path: `/api/posts/${encodeURIComponent(postId)}/comments?cursor=${encodeURIComponent(nextCursor)}`,
        accessToken,
      });
      // Dedupe by id — a comment created between pages would otherwise
      // appear in both the first page's new-rows and the next page's older
      // rows. The cursor codec is (createdAt, id)-based so the server keeps
      // its page boundary stable, but belt-and-braces is cheap here.
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...res.comments.filter((c) => !seen.has(c.id))];
      });
      setNextCursor(res.nextCursor);
      updateSummary(res.commentSummary);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Could not load more comments.',
      );
    } finally {
      setLoadingMore(false);
    }
  }, [accessToken, loadingMore, nextCursor, postId, updateSummary]);

  const trimmedDraft = draft.trim();
  const tooLong = trimmedDraft.length > COMMENT_CONTENT_MAX;
  const submitDisabled =
    posting || trimmedDraft.length === 0 || tooLong || !accessToken;

  const submit = useCallback(async () => {
    if (submitDisabled) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await api<CreateCommentResponse>({
        method: 'POST',
        path: `/api/posts/${encodeURIComponent(postId)}/comments`,
        accessToken,
        body: { content: trimmedDraft },
      });
      // Prepend — list is newest-first and this comment just became the
      // newest. Using the server's exact row (not our optimistic copy) so
      // timestamps and author shape stay consistent with the rest of the
      // list.
      setComments((prev) => [res.comment, ...prev]);
      updateSummary(res.commentSummary);
      setDraft('');
    } catch (err) {
      setPostError(
        err instanceof ApiError ? err.message : 'Could not post your comment.',
      );
    } finally {
      setPosting(false);
    }
  }, [accessToken, postId, submitDisabled, trimmedDraft, updateSummary]);

  const remove = useCallback(
    async (commentId: string) => {
      if (deletingIds.has(commentId)) return;
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.add(commentId);
        return next;
      });
      try {
        const res = await api<DeleteCommentResponse>({
          method: 'DELETE',
          path: `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
          accessToken,
        });
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        updateSummary(res.commentSummary);
      } catch (err) {
        // Mark just this comment as failed — inline, not top-level. A retry
        // (re-clicking Delete) should just work after a transient blip.
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Could not delete that comment.',
        );
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(commentId);
          return next;
        });
      }
    },
    [accessToken, deletingIds, postId, updateSummary],
  );

  const startEdit = useCallback((commentId: string, currentContent: string) => {
    // Seed the draft with the current content so the author edits from the
    // existing text rather than starting from a blank textarea.
    setEditDrafts((prev) => ({ ...prev, [commentId]: currentContent }));
    setEditErrors((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
  }, []);

  const cancelEdit = useCallback((commentId: string) => {
    setEditDrafts((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
    setEditErrors((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
  }, []);

  const changeEditDraft = useCallback((commentId: string, value: string) => {
    setEditDrafts((prev) => ({ ...prev, [commentId]: value }));
    // Clear the inline error on the next keystroke — the user is trying
    // again, let the next submit surface a fresh result.
    setEditErrors((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
  }, []);

  const saveEdit = useCallback(
    async (commentId: string) => {
      const draftValue = editDrafts[commentId];
      if (draftValue === undefined) return;
      const trimmed = draftValue.trim();
      if (trimmed.length === 0) {
        setEditErrors((prev) => ({
          ...prev,
          [commentId]: 'Comment cannot be empty.',
        }));
        return;
      }
      if (trimmed.length > COMMENT_CONTENT_MAX) {
        setEditErrors((prev) => ({
          ...prev,
          [commentId]: `Comment is too long (max ${COMMENT_CONTENT_MAX}).`,
        }));
        return;
      }
      if (savingIds.has(commentId)) return;
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.add(commentId);
        return next;
      });
      try {
        const res = await api<UpdateCommentResponse>({
          method: 'PATCH',
          path: `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
          accessToken,
          body: { content: trimmed },
        });
        // Replace by id — the server returns the authoritative row with a
        // fresh `editedAt` stamp. Keep list order stable.
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? res.comment : c)),
        );
        // Exit edit mode on success.
        setEditDrafts((prev) => {
          if (!(commentId in prev)) return prev;
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
        setEditErrors((prev) => {
          if (!(commentId in prev)) return prev;
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
      } catch (err) {
        setEditErrors((prev) => ({
          ...prev,
          [commentId]:
            err instanceof ApiError
              ? err.message
              : 'Could not save that edit.',
        }));
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(commentId);
          return next;
        });
      }
    },
    [accessToken, editDrafts, postId, savingIds],
  );

  return (
    <section
      id="comments"
      aria-label="Comments"
      className="space-y-4 border-t border-[hsl(var(--border-default))] pt-4"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {summary.totalComments}{' '}
          {summary.totalComments === 1 ? 'comment' : 'comments'}
        </h2>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={COMMENT_CONTENT_MAX}
          disabled={posting}
          placeholder="Write a comment…"
          aria-label="Write a comment"
          className="w-full resize-y rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[hsl(var(--text-default))] disabled:opacity-60"
        />
        <div className="flex items-center justify-between text-xs text-[hsl(var(--text-muted))]">
          <span>
            {draft.length}/{COMMENT_CONTENT_MAX}
          </span>
          <div className="flex items-center gap-2">
            {postError ? (
              <span role="alert" className="text-red-600">
                {postError}
              </span>
            ) : null}
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex items-center rounded-md bg-mode-home px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      </form>

      {loadingInitial ? (
        <p className="text-xs text-[hsl(var(--text-muted))]">Loading comments…</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="text-xs text-red-600">
          {loadError}
        </p>
      ) : null}

      {!loadingInitial && comments.length === 0 && !loadError ? (
        <p className="text-xs text-[hsl(var(--text-muted))]">
          No comments yet. Be the first.
        </p>
      ) : null}

      {comments.length > 0 ? (
        <ul className="space-y-3">
          {comments.map((comment) => {
            const isOwn = comment.author.id === viewerPersonaId;
            const canDelete = isOwn;
            const canEdit = isOwn;
            const isDeleting = deletingIds.has(comment.id);
            const isEditing = comment.id in editDrafts;
            const isSaving = savingIds.has(comment.id);
            const editDraftValue = editDrafts[comment.id] ?? '';
            const editTrimmed = editDraftValue.trim();
            const editTooLong = editTrimmed.length > COMMENT_CONTENT_MAX;
            const editSaveDisabled =
              isSaving ||
              editTrimmed.length === 0 ||
              editTooLong ||
              !accessToken;
            const editError = editErrors[comment.id];
            return (
              <li
                key={comment.id}
                className="space-y-1 rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <UsernameLink
                    username={comment.author.username}
                    className="text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    {comment.author.displayName}
                  </UsernameLink>
                  <UsernameLink
                    username={comment.author.username}
                    className="text-[10px] text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
                  />
                  <time
                    dateTime={comment.createdAt}
                    className="text-[10px] text-[hsl(var(--text-muted))]"
                  >
                    {formatTimestamp(comment.createdAt)}
                  </time>
                  {comment.editedAt ? (
                    <span
                      title={`Edited ${formatTimestamp(comment.editedAt)}`}
                      className="text-[10px] italic text-[hsl(var(--text-muted))]"
                    >
                      (edited)
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <div className="space-y-1 pt-1">
                    <textarea
                      value={editDraftValue}
                      onChange={(event) =>
                        changeEditDraft(comment.id, event.target.value)
                      }
                      rows={3}
                      maxLength={COMMENT_CONTENT_MAX}
                      disabled={isSaving}
                      aria-label="Edit comment"
                      className="w-full resize-y rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[hsl(var(--text-default))] disabled:opacity-60"
                    />
                    <div className="flex items-center justify-between text-[10px] text-[hsl(var(--text-muted))]">
                      <span>
                        {editDraftValue.length}/{COMMENT_CONTENT_MAX}
                      </span>
                      <div className="flex items-center gap-2">
                        {editError ? (
                          <span role="alert" className="text-red-600">
                            {editError}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => cancelEdit(comment.id)}
                          disabled={isSaving}
                          className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2 py-0.5 text-[10px] font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit(comment.id)}
                          disabled={editSaveDisabled}
                          className="inline-flex items-center rounded-md bg-mode-home px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {comment.content}
                  </p>
                )}
                {!isEditing && (canEdit || canDelete) ? (
                  <div className="flex items-center gap-2 pt-1">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => startEdit(comment.id, comment.content)}
                        disabled={isDeleting}
                        className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2 py-0.5 text-[10px] font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
                      >
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void remove(comment.id)}
                        disabled={isDeleting}
                        className="inline-flex items-center rounded-md border border-red-200 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {nextCursor ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 text-xs font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more comments'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
