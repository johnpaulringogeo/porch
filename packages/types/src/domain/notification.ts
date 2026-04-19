export const NotificationType = {
  ContactRequestReceived: 'contact_request_received',
  ContactRequestAccepted: 'contact_request_accepted',
  ContactRequestDeclined: 'contact_request_declined',
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
