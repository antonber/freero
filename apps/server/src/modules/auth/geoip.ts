// Approximate location of a session's address from a GeoIP database the operator downloads
// (MaxMind GeoLite2/GeoIP2 City or Country, .mmdb — GEOIP_DB_PATH). Looked up locally in memory:
// addresses are never sent to a third party. Without a database, sessions show the masked network.
import maxmind, { type CityResponse, type Reader } from 'maxmind';
import { log } from '../../platform/log';

let reader: Reader<CityResponse> | null = null;

/** Loads the database (startup). Throws with a plain message when the file is not a usable .mmdb. */
export async function openGeoIp(path: string): Promise<void> {
  try {
    reader = await maxmind.open<CityResponse>(path, { watchForUpdates: false });
  } catch (e) {
    throw new Error(`GEOIP_DB_PATH: could not read ${path} as a MaxMind .mmdb database (${e instanceof Error ? e.message : String(e)})`);
  }
  const m = reader.metadata;
  log(`geoip: ${m.databaseType} database built ${m.buildEpoch.toISOString().slice(0, 10)} loaded for session locations`);
}

/** "City, Country", "Country", or null (no database, private/unknown address). */
export function locateIp(ip: string): string | null {
  if (!reader) return null;
  const addr = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (!maxmind.validate(addr)) return null;
  let r: CityResponse | null;
  try {
    r = reader.get(addr);
  } catch {
    return null;
  }
  const country = r?.country?.names?.en ?? r?.registered_country?.names?.en ?? null;
  const city = r?.city?.names?.en ?? null;
  if (city && country) return `${city}, ${country}`;
  return country ?? city;
}

/** "203.0.113.42" -> "203.0.113.x"; IPv6 keeps its first three groups. Never the full address. */
export function maskIp(ip: string): string {
  if (ip === '::1' || /^(::ffff:)?127\./.test(ip)) return 'This computer';
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/i.exec(ip);
  if (v4) return `${v4[1]}.x`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  return ip ? 'unknown network' : '';
}
