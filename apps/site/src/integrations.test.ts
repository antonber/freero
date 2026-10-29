// The integrations catalog (@freero/shared integrations.ts) promises a working connect step for
// every entry, in the app and on the site. These fail when a route, tab or settings section an
// entry links to is renamed or removed in the web app, when a docs file or heading it cites is
// gone, or when the embeds it lists drift from the providers boards actually frame.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_LINK_PREFIX, EMBED_PROVIDERS, INTEGRATIONS } from '@freero/shared';

const repo = path.resolve(__dirname, '../../..');
const web = (f: string) => fs.readFileSync(path.join(repo, 'apps/web/src', f), 'utf8');
const all = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);

/** The web app's routes, as react-router matches them (`:param` = one segment). */
const routes = all(web('app/App.tsx'), /<Route\s+path="([^"]+)"/g).filter((r) => r !== '*');
const matchesRoute = (p: string) => routes.some((r) => new RegExp(`^${r.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(p));

/** GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen. */
const anchorsOf = (md: string) =>
  all(md.replace(/```[\s\S]*?```/g, ''), /^#{1,6}\s+(.+)$/gm).map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-'),
  );

describe('every catalog entry’s connect step works', () => {
  it('each in-app link opens a page of the web app, and the tab or section it names exists there', () => {
    const connectTabs = all(web('app/pages/connect/clients.ts'), /\{ id: '([a-z-]+)', label:/g);
    const adminTabs = all(web('app/pages/admin/AdminConsolePage.tsx'), /\{ id: '([a-z-]+)', label:/g);
    const settingsSections = ['AccountSettingsPage.tsx', 'ApiSections.tsx', 'SecuritySections.tsx'].flatMap((f) => all(web(`app/pages/account/${f}`), /\bid="([a-z-]+)"/g));
    expect(connectTabs.length).toBeGreaterThan(3);
    expect(adminTabs.length).toBeGreaterThan(3);
    let checked = 0;
    for (const e of INTEGRATIONS) {
      // Every entry has its own page in Apps & agents, and its connect step.
      expect(matchesRoute(`/apps/${e.id}`), `/apps/${e.id}`).toBe(true);
      const link = e.connect.app;
      if (!link) continue;
      const [rest, hash] = link.path.replace(ADMIN_LINK_PREFIX, '/admin/some-team').split('#');
      const [route, search] = rest.split('?');
      expect(matchesRoute(route), `${e.id}: ${link.path} is not a route of the web app`).toBe(true);
      const tab = new URLSearchParams(search ?? '').get('tab');
      if (route.startsWith('/admin/')) expect(adminTabs, `${e.id}: the admin console has no tab ${tab}`).toContain(tab);
      if (route === '/settings/connect') expect(connectTabs, `${e.id}: the Connect page has no tab #${hash}`).toContain(hash);
      else if (route === '/settings' && hash) expect(settingsSections, `${e.id}: settings has no section #${hash}`).toContain(hash);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('each docs link names a file in the repository, and a heading that file has', () => {
    for (const e of INTEGRATIONS) {
      const d = e.connect.docs;
      expect(d, `${e.id} has neither docs nor a way to connect in the app`).toBeTruthy();
      if (!d) continue;
      const file = path.join(repo, d.file);
      expect(fs.existsSync(file), `${e.id}: ${d.file} is not in the repository`).toBe(true);
      if (d.anchor) expect(anchorsOf(fs.readFileSync(file, 'utf8')), `${e.id}: ${d.file} has no heading #${d.anchor}`).toContain(d.anchor);
    }
  });

  it('the embeds listed are exactly the providers boards frame live: none missing, none made up', () => {
    const listed = INTEGRATIONS.filter((e) => e.category === 'embeds').map((e) => e.embedProvider);
    expect([...listed].sort()).toEqual(EMBED_PROVIDERS.map((p) => p.id).sort());
  });
});
