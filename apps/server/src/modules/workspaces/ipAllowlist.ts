// IP allowlists (#156): which client addresses may open a workspace's boards. Pure: parsing the
// admins' CIDR ranges and matching an address (TRUST_PROXY already applied by the platform).
import { BlockList, isIP } from 'node:net';

export const MAX_RANGES = 100;

/** "203.0.113.0/24", "2001:db8::/32" or a single address; null when it isn't one. Canonical text. */
export function parseRange(v: string): string | null {
  const s = v.trim();
  const [addr, bits, extra] = s.split('/');
  if (extra !== undefined || !addr) return null;
  const family = isIP(addr);
  if (!family) return null;
  const max = family === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return `${addr.toLowerCase()}/${prefix}`;
}

/** An IPv4 address carried as IPv6 ("::ffff:198.51.100.7") is the IPv4 address. */
function normalise(ip: string): { ip: string; type: 'ipv4' | 'ipv6' } | null {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const a = v4 ? v4[1] : ip;
  const family = isIP(a);
  return family ? { ip: a, type: family === 4 ? 'ipv4' : 'ipv6' } : null;
}

/** Is `ip` inside one of `ranges` (canonical, from parseRange)? An empty list allows everyone. */
export function ipAllowed(ranges: readonly string[], ip: string): boolean {
  if (!ranges.length) return true;
  const n = normalise(ip);
  if (!n) return false;
  const list = new BlockList();
  for (const r of ranges) {
    const [addr, bits] = r.split('/');
    const type = isIP(addr) === 4 ? 'ipv4' : 'ipv6';
    list.addSubnet(addr, Number(bits), type);
  }
  return list.check(n.ip, n.type);
}
