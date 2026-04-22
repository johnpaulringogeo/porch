export const NotificationType = {
  ContactRequestReceived: 'contact_request_received',
  ContactRequestAccepted: 'contact_request_accepted',
  ContactRequestDeclined: 'contact_request_declined',
  /**
   * The recipient was hand-picked into the audience of a `selected`-mode post.
   * Payload: { postId, byPersonaId }. The notification fans out at post-create
   * time — one row per audience member. Not fired for `all_contacts` posts;
   * those land in the home feed and don't warrant a per-recipient ping.
   */
  PostSelectedAudience: 'post_selected_audience',
  /**
   * Someone liked one of the recipient's posts. Payload: { postId, byPersonaId }.
   * Fires only on the like edge (not unlike) so a quick double-tap that toggles
   * back to off doesn't leave a stale notification. Self-likes are blocked at
   * the API layer — no fan-out here for them.
   *
   * Coalescing: v0 sends one row per like event. If the same persona likes,
   * unlikes, then likes again you get two rows. That's noisy in theory but in
   * practice rare enough that we'd rather have an audit trail than dedupe.
   */
  PostLiked: 'post_liked',
  /**
   * Someone commented on one of the recipient's posts.
   * Payload: { postId, commentId, byPersonaId }. Only fires when the
   * commenter is *not* the post's author — self-comments are a valid "I
   * forgot to add…" follow-up and notifying yourself would be noise.
   *
   * One row per comment; no deduping across rapid successive comments.
   * Delete-then-recomment currently leaves the original notification row in
   * place pointing at the deleted comment — the UI copes because the link
   * resolves to the post (not the comment) and the deleted comment simply
   * isn't in the thread. If this becomes a complaint we'll dismiss the
   * notification alongside the soft delete.
   */
  CommentCreated: 'comment_created',
  PostModerated: 'post_moderated',
  AccountModerated: 'account_moderated',
  System: 'system',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface Notification {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}
