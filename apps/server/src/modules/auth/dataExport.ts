// The personal data modules/auth keeps about a person, for their data export (modules/privacy).
// Never secrets: no password hash, authenticator secret, recovery codes or token hashes.
import { maskIp } from './geoip';
import { providerLabel } from './providers';
import * as repo from './repo';

export interface AccountDataExport {
  profile: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    color: string;
    avatarUrl: string | null;
    createdAt: string;
    deletionScheduledFor: string | null;
  };
  signIn: {
    hasPassword: boolean;
    twoStepVerification: boolean;
    connectedSignInMethods: Array<{ provider: string; email: string | null; connectedAt: string; lastUsedAt: string }>;
  };
  sessions: Array<{ signedInAt: string; lastSeenAt: string; userAgent: string; network: string; method: string; twoStep: boolean }>;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function exportAccountData(userId: string): Promise<AccountDataExport | null> {
  const user = await repo.findUserById(userId);
  if (!user) return null;
  const [identities, sessions, twoFactor] = await Promise.all([
    repo.listIdentities(userId),
    repo.listSessions(userId, Date.now()),
    repo.twoFactorEnabled(userId),
  ]);
  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      color: user.color,
      avatarUrl: user.avatarUrl,
      createdAt: iso(user.createdAt),
      deletionScheduledFor: user.deletionScheduledFor === null ? null : iso(user.deletionScheduledFor),
    },
    signIn: {
      hasPassword: user.passwordHash !== null,
      twoStepVerification: twoFactor,
      connectedSignInMethods: identities.map((i) => ({
        provider: providerLabel(i.provider),
        email: i.email,
        connectedAt: iso(i.createdAt),
        lastUsedAt: iso(i.lastUsedAt),
      })),
    },
    sessions: sessions.map((s) => ({
      signedInAt: iso(s.createdAt),
      lastSeenAt: iso(s.lastSeenAt),
      userAgent: s.userAgent,
      network: maskIp(s.ip),
      method: s.method === 'password' || s.method === 'email_link' ? s.method : providerLabel(s.method),
      twoStep: s.twoFactor,
    })),
  };
}
