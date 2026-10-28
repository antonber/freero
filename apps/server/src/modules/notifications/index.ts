// Public API of modules/notifications [S2]. Another module that wants to notify someone (e.g.
// workspace invites) adds its type in types.ts and calls `notify`.
export { notify, type NewNotification } from './service';
export type { NotificationData } from './types';
