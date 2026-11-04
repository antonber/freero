// Public API of modules/mobile [S2] (#177; docs/mobile.md): Freero's phone and tablet apps — their
// devices' push registrations (push_devices, one per device and session) and push delivery through
// APNs and FCM, and the /.well-known files that let https links open the apps.
// modules/notifications calls `pushToUser` for each new notification, once committed.
export { pushToUser, pushStatus } from './service';
export type { PushMessage } from './transports';
