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
