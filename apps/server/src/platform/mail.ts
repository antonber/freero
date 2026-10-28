// Outgoing email. SMTP (nodemailer) when SMTP_URL is set; otherwise the development outbox: every
// message is written as JSON to <data>/outbox/ and logged, so dev and `npm run verify` can follow
// links without a mail server.
//
//   await sendMail({ to, ...renderMail({ title, intro, action: { label, url }, outro }) })
//
// Modules compose messages with renderMail (escapes everything it is given) and link to the app
// with appUrl(req, path). Never log message bodies: they carry single-use tokens.
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from './config';
import { newId } from './ids';
import { log, logError } from './log';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (renderMail sets List-Unsubscribe for messages with an unsubscribe link). */
  headers?: Record<string, string>;
}

let transport: Transporter | null = null;

function smtp(url: string): Transporter {
  return (transport ??= nodemailer.createTransport(url));
}

/** The development outbox directory (only used without SMTP_URL). */
export function outboxDir(): string {
  return path.join(getConfig().dataDir, 'outbox');
}

/** Sends one message. Rejects when SMTP refuses it; callers that must not leak timing don't await. */
export async function sendMail(mail: Mail): Promise<void> {
  const config = getConfig();
  if (config.smtpUrl) {
    await smtp(config.smtpUrl).sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, headers: mail.headers });
    log(`mail: sent "${mail.subject}"`);
    return;
  }
  const dir = outboxDir();
  // Written next to the outbox and renamed into it, so whoever reads the outbox (verify, tests)
  // never sees a half-written message.
  const staging = path.join(config.dataDir, 'outbox-staging');
  await Promise.all([fs.promises.mkdir(dir, { recursive: true }), fs.promises.mkdir(staging, { recursive: true })]);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${newId(6)}.json`;
  const file = path.join(dir, name);
  await fs.promises.writeFile(path.join(staging, name), JSON.stringify({ from: config.mailFrom, ...mail, sentAt: Date.now() }, null, 2));
  await fs.promises.rename(path.join(staging, name), file);
  log(`mail (dev outbox): "${mail.subject}" to ${mail.to} -> ${file}`);
}

/** Fire-and-forget send: failures are logged, never thrown (e.g. answers that must not depend on it). */
export function sendMailLater(mail: Mail): void {
  sendMail(mail).catch((e) => logError(`mail: could not send "${mail.subject}"`, e));
}

/**
 * Absolute URL of an app page for links in emails: PUBLIC_URL in production; in development the
 * origin the request came through (the Vite dev server proxies with the browser's Host).
 */
export function appUrl(req: Request | null, pathname: string): string {
  const config = getConfig();
  const origin = config.publicUrl ?? (req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${config.port}`);
  return origin + pathname;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A plain, branded message: a title, paragraphs, optional items (a heading, a quoted excerpt and a
 * link each — a digest), an optional button and a closing note. Every string is user-visible text
 * (escaped here), never HTML. `unsubscribe` adds a footer link and the List-Unsubscribe headers
 * (RFC 8058 one-click: `oneClickUrl` must accept a POST without a session).
 */
export function renderMail(m: {
  subject: string;
  title: string;
  paragraphs: string[];
  items?: Array<{ heading: string; quote?: string; link: { label: string; url: string } }>;
  action?: { label: string; url: string };
  outro?: string;
  unsubscribe?: { label: string; url: string; oneClickUrl: string };
}): Omit<Mail, 'to'> {
  const items = m.items ?? [];
  const text = [
    m.title,
    '',
    ...m.paragraphs.flatMap((p) => [p, '']),
    ...items.flatMap((i) => [i.heading, ...(i.quote ? [`  “${i.quote}”`] : []), `  ${i.link.label}: ${i.link.url}`, '']),
    ...(m.action ? [`${m.action.label}: ${m.action.url}`, ''] : []),
    ...(m.outro ? [m.outro, ''] : []),
    '— Freero',
    ...(m.unsubscribe ? ['', `${m.unsubscribe.label}: ${m.unsubscribe.url}`] : []),
  ].join('\n');
  const p = (s: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#2b2b33">${escapeHtml(s)}</p>`;
  const item = (i: (typeof items)[number]) => `<div style="margin:0 0 16px;padding:14px 16px;border:1px solid #e6e6ec;border-radius:10px">
<div style="font-size:15px;line-height:22px;color:#17171c;font-weight:600">${escapeHtml(i.heading)}</div>
${i.quote ? `<div style="margin:6px 0 0;padding-left:10px;border-left:3px solid #d9d4fb;font-size:14px;line-height:20px;color:#4a4a55">${escapeHtml(i.quote)}</div>` : ''}
<a href="${escapeHtml(i.link.url)}" style="display:inline-block;margin-top:8px;font-size:14px;color:#5b3ff0;font-weight:600;text-decoration:none">${escapeHtml(i.link.label)}</a>
</div>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<div style="font-weight:700;font-size:18px;color:#5b3ff0;margin-bottom:24px">Freero</div>
<h1 style="margin:0 0 16px;font-size:20px;color:#17171c">${escapeHtml(m.title)}</h1>
${m.paragraphs.map(p).join('\n')}
${items.map(item).join('\n')}
${
  m.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(m.action.url)}" style="display:inline-block;background:#5b3ff0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(m.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b6b76">Or paste this link into your browser: ${escapeHtml(m.action.url)}</p>`
    : ''
}
${m.outro ? `<p style="margin:16px 0 0;font-size:13px;color:#6b6b76">${escapeHtml(m.outro)}</p>` : ''}
</div>
${
  m.unsubscribe
    ? `<p style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:#8a8a95"><a href="${escapeHtml(m.unsubscribe.url)}" style="color:#8a8a95">${escapeHtml(m.unsubscribe.label)}</a></p>`
    : ''
}
</body></html>`;
  if (!m.unsubscribe) return { subject: m.subject, text, html };
  const headers = { 'List-Unsubscribe': `<${m.unsubscribe.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  return { subject: m.subject, text, html, headers };
}
