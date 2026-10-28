// Domain verification over DNS: the workspace publishes a TXT record we gave it; we look it up.
// The resolver is injectable (tests) and configurable (SSO_DNS_SERVERS: which servers to ask),
// but there is no way to skip the lookup — a domain is verified only by a TXT answer.
import { Resolver } from 'node:dns/promises';
import { getConfig } from '../../platform/config';

/** Where the record lives and what it must say. */
export const TXT_PREFIX = '_freero-verification';
export const txtName = (domain: string) => `${TXT_PREFIX}.${domain}`;
export const txtValue = (token: string) => `freero-verification=${token}`;

/** Returns the TXT strings at `name` (each record's chunks joined); [] when there are none. */
export type TxtLookup = (name: string) => Promise<string[]>;

let override: TxtLookup | null = null;

/** Tests replace the lookup; null restores the real one. */
export function setTxtLookupForTests(fn: TxtLookup | null): void {
  override = fn;
}

const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ESERVFAIL']);

async function systemLookup(name: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const servers = getConfig().ssoDnsServers;
  if (servers.length) resolver.setServers(servers);
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch (e) {
    if (NO_RECORDS.has((e as { code?: string }).code ?? '')) return [];
    throw e;
  }
}

/** Whether `domain` publishes the verification record for `token`. */
export async function domainHasToken(domain: string, token: string): Promise<boolean> {
  const records = await (override ?? systemLookup)(txtName(domain));
  const want = txtValue(token);
  return records.some((r) => r.trim() === want);
}
