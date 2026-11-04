// Public API of modules/keys [S2]: workspace encryption keys (#159; docs/design/compliance.md §3).
// realtime seals and opens board content through these; workspaces' `blocked` rule asks which
// workspaces' keys can't be used; boards keeps no thumbnail for a keyed workspace.
export {
  currentSealRef,
  hasKey,
  KEY_UNAVAILABLE,
  KeyUnavailableError,
  openSealed,
  openerFor,
  sealerFor,
  unusableKeysAmong,
  keysInUse,
  type BlobSealer,
} from './service';
// The console's actions (routes.ts) and the jobs (init.ts), for the operator CLI and other modules' tests.
export { checkKeys, createKey, destroyKey, keyStatus, resumeKey, rotateKey, sealPendingContent, suspendKey } from './service';
// A just-started instance (nothing cached): what other instances see after a state change.
export { forgetAllCachedKeys } from './service';
