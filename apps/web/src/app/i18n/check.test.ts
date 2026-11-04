// The i18n check (scripts/i18n-check.mjs, in `npm run check`) on a small tree laid out like the
// repo: what it must refuse, and that a correct catalogue passes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SCRIPT = path.join(REPO, 'scripts/i18n-check.mjs');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A tree with one feature `demo`; returns the check's exit status and output. */
function check(files: Record<string, string>): { ok: boolean; out: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-i18n-'));
  dirs.push(root);
  const base = {
    'apps/web/src/features/demo/messages.ts': "import { defineMessages } from '@ui';\nimport en from './locales/en.json';\nexport const t = defineMessages('features/demo', en);\n",
    'apps/web/src/features/demo/locales/en.json': JSON.stringify({ save: 'Save', votes: '{count, plural, one {# vote} other {# votes}}', hello: 'Hello {name}' }),
    'apps/web/src/features/demo/panel.tsx': "import { t } from './messages';\nexport const P = () => <p title={t('save')}>{t('votes', { count: 2 })} {t('hello', { name: 'A' })}</p>;\n",
  };
  for (const [f, text] of Object.entries({ ...base, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, '--root', root], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('check:i18n', () => {
  it('passes a feature whose code and catalogues agree, with a translation still missing keys', () => {
    expect(check({ 'apps/web/src/features/demo/locales/de.json': JSON.stringify({ save: 'Speichern' }) }).ok).toBe(true);
  }, 30_000);

  it('fails on a key the code uses that English lacks, and on an English key nothing uses', () => {
    const r = check({
      'apps/web/src/features/demo/panel.tsx': "import { t } from './messages';\nexport const P = () => <p>{t('save')} {t('saveAll')} {t('votes', { count: 1 })}</p>;\n",
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain("uses 'saveAll'");
    expect(r.out).toContain("'hello' is not used");
  }, 30_000);

  it('fails on a translation that renames an argument (it would print nothing) or isn’t valid ICU', () => {
    const r = check({ 'apps/web/src/features/demo/locales/fr.json': JSON.stringify({ hello: 'Bonjour {nom}', votes: '{count, plural, one {# vote}' }) });
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/'hello' uses \{nom\} but English uses \{name\}/);
    expect(r.out).toMatch(/'votes' is not valid ICU/);
  }, 30_000);

  it('fails on new hard-coded interface text in a feature', () => {
    const r = check({
      'apps/web/src/features/demo/toolbar.tsx': "export const B = () => <button aria-label=\"Close panel\">Close</button>;\n",
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('features/demo/toolbar.tsx  has 2 hard-coded interface string(s)');
  }, 30_000);
});
