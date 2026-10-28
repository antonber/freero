// Which web origins are Freero's own, so `https://<origin>/board/<id>` reads as an object address.
import type { Request } from 'express';
import { getConfig } from '../../platform/config';

/**
 * PUBLIC_URL when set (production), plus the origin of the request when there is one (the app as
 * the reader reached it, e.g. a dev server). Without either, only `freero://` URIs and same-origin
 * paths count.
 */
export function appOrigins(req?: Request): string[] {
  const out = new Set<string>();
  const pub = getConfig().publicUrl;
  if (pub) out.add(pub);
  const origin = req?.get('origin');
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) out.add(origin);
  return [...out];
}
