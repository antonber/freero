// Public API of modules/notifications [S2]. Another module that wants to notify someone (e.g.
// workspace invites) adds its type in types.ts and calls `notify`.
export { notify, type NewNotification } from './service';
import * as repo from './repo';

/** For a person's data export: every notification they have (newest first) and their email settings. */
export async function notificationsExportOf(userId: string): Promise<{ notifications: unknown[]; emailSettings: Record<string, boolean> }> {
  const rows = await repo.list(userId, 100_000, null);
  return {
    notifications: rows.map((n) => ({
      type: n.type,
      actorId: n.actorId,
      boardId: n.boardId,
      data: n.data,
      createdAt: new Date(n.createdAt).toISOString(),
      readAt: n.readAt === null ? null : new Date(n.readAt).toISOString(),
    })),
    emailSettings: Object.fromEntries(await repo.prefs(userId)),
  };
}
export type { NotificationData } from './types';
