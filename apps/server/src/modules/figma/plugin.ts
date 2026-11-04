// The Figma plugin's sign-in to Freero (#172; integrations/figma). A Figma plugin can't receive an
// OAuth redirect, so it signs in through Freero's own OAuth (authorization code + PKCE, a client it
// registered for itself) with this page as its redirect: the page keeps the code under the hash of
// the plugin's state, and the plugin picks it up with that state (single use, five minutes) and
// redeems it at /api/oauth/token with its PKCE verifier. Whoever sees the code or the state on the
// way (the browser's history) can't redeem it: only the plugin holds the verifier.
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { acceptLanguages, isRtlLocale, negotiateLocale } from '@freero/shared';
import { seal, unseal } from '../../platform/secrets';
import { t } from './messages';
import * as repo from './repo';

const PURPOSE = 'figma-plugin-code-v1';
const KEEP_MS = 5 * 60_000;
export const FIGMA_PLUGIN_CALLBACK_PATH = '/api/integrations/figma/plugin/callback';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** The plugin's state: at least 32 random characters it made itself. */
const goodState = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(v);

/** GET …/plugin/callback: Freero's consent sends the browser here; the page says to go back to Figma. */
export async function pluginCallback(req: Request, res: Response): Promise<void> {
  const state = req.query.state;
  const code = typeof req.query.code === 'string' && req.query.code.length <= 512 ? req.query.code : '';
  const ok = goodState(state) && !!code;
  if (ok) await repo.keepPluginCode(sha256(state), seal(PURPOSE, code), Date.now() + KEEP_MS);
  const locale = negotiateLocale(acceptLanguages(req.headers['accept-language'])) ?? 'en';
  const title = ok ? t(locale, 'plugin.signedIn.title') : t(locale, 'plugin.failed.title');
  const body = ok ? t(locale, 'plugin.signedIn.body') : t(locale, 'plugin.failed.body');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  res.setHeader('Cache-Control', 'no-store');
  res
    .status(ok ? 200 : 400)
    .type('html')
    .send(
      `<!doctype html><html lang="${locale}" dir="${isRtlLocale(locale) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#17162b"><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(body)}</p></body></html>`,
    );
}

/** POST …/plugin/pickup { state }: the code kept for that state, once; `null` while the person hasn't finished. */
export async function pluginPickup(body: unknown): Promise<{ code: string | null }> {
  const state = (body as { state?: unknown } | null)?.state;
  if (!goodState(state)) return { code: null };
  const sealed = await repo.takePluginCode(sha256(state));
  return { code: sealed ? (unseal(PURPOSE, sealed)?.value ?? null) : null };
}
