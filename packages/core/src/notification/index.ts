import { notification, type Database } from '@porch/db';
import { NotificationType } from '@porch/types/domain';

export interface CreateNotificationInput {
  recipientPersonaId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<void> {
  await db.insert(notification).values({
    recipientPersonaId: input.recipientPersonaId,
    type: input.type,
    payload: input.payload as never,
  });
}

// Implementations TODO:
//   export async function listNotifications(db, personaId, opts): Promise<Notification[]>
//   export async function markRead(db, personaId, notificationIds): Promise<void>
//   export async function dismiss(db, personaId, notificationIds): Promise<void>

export {};
