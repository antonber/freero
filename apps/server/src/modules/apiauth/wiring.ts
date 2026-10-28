// Credentials end with the account's sessions when it is signed out everywhere (a reset, "this
// wasn't me", recovery, suspension, deletion, a directory deprovisioning it). Connected from init.ts
// (server) AND admin.ts (the operator CLI: an operator's two-step reset signs the account out there).
import { onSignedOutEverywhere } from '../auth/index';
import { revokeEverything } from './credentials';

export function connectRevocation(): () => void {
  return onSignedOutEverywhere((userId) => revokeEverything(userId, null, 'signed_out_everywhere').then(() => undefined));
}
