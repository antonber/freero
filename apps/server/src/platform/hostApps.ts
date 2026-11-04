// What the modules of the apps on other platforms share (modules/atlassian, zoom, meet; the
// Microsoft one in modules/teams predates it): the instance's https address a package points the
// platform at, sending a generated package, and serving the web app's page for their routes the
// way main.ts's SPA fallback does.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import type { Config } from './config';
import { HttpError } from './http';

/** The https origin a package points `platform` at; 409 naming what to set when there is none. */
export function packageOrigin(publicUrl: string | null, platform: string): string {
  if (!publicUrl) throw new HttpError(409, `Set PUBLIC_URL to the https address people open Freero at: the ${platform} app points there`);
  const u = new URL(publicUrl);
  if (u.protocol !== 'https:') throw new HttpError(409, `${platform} loads apps over https only: PUBLIC_URL must be an https address`);
  return u.origin;
}

/** A generated package as a download. */
export function sendPackage(res: Response, filename: string, body: Uint8Array | string, type = 'application/zip'): void {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(typeof body === 'string' ? body : Buffer.from(body));
}

/** Reads the built web app's page (null in development, where Vite serves it). */
export function appPageReader(config: Config): () => Promise<string | null> {
  const file = path.join(config.webDist, 'index.html');
  return () => fs.readFile(file, 'utf8').catch(() => null);
}

/** The app page as main.ts's SPA fallback sends it. */
export function sendAppPage(res: Response, html: string): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}
