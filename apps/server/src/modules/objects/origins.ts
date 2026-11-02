// Which web origins are Freero's own, so `https://<origin>/board/<id>` reads as an object address.
import type { Request } from 'express';
import { getConfig } from '../../platform/config';

/**
 * PUBLIC_URL when set (production) and the addresses it moved from (PREVIOUS_PUBLIC_URLS), plus the
 * origin of the request when there is one (the app as the reader reached it, e.g. a dev server).
 * Without any, only `freero://` URIs and same-origin paths count.
 */
export function appOrigins(req?: Request): string[] {
  const out = new Set<string>();
  const { publicUrl: pub, previousPublicUrls } = getConfig();
  if (pub) out.add(pub);
  for (const o of previousPublicUrls) out.add(o);
  const origin = req?.get('origin');
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) out.add(origin);
  return [...out];
}
