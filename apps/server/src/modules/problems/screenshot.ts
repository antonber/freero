import type { Readable } from 'node:stream';
import type { Response } from 'express';

/**
 * Sends a report's screenshot to an operator: its own image type (the bytes were checked when it
 * was stored), nosniff, a sandbox CSP, never cached anywhere and never offered to other origins.
 */
export function sendScreenshot(res: Response, file: { body: Readable; size: number | null; contentType: string }): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (file.size !== null) res.setHeader('Content-Length', String(file.size));
  file.body.on('error', () => res.destroy());
  file.body.pipe(res);
}
