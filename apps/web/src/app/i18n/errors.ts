// Server errors in the interface's language (docs/design/i18n.md). The server keeps its English
// `error` text and adds a stable `code` (and `params`); the app shows `errors.<code>` from its
// catalogue when it has one, the server's English otherwise — so a code this version doesn't know
// yet, or a server that sends none, still reads.
import en from '../locales/en.json';
import { t } from '../messages';

export function serverErrorText(code: string | undefined, params: unknown, fallback: string): string {
  if (!code) return fallback;
  const key = `errors.${code}`;
  if (!(key in en)) return fallback;
  const vars: Record<string, string | number> = {};
  if (params && typeof params === 'object')
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') vars[k] = v;
  return t(`errors.${code}` as keyof typeof en, vars);
}
