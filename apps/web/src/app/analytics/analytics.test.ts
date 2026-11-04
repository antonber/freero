// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsEventParams, analyticsPage } from '@freero/shared';
import { reportPage, resetAppAnalytics, startAppAnalytics, track } from './bridge';
import { setOptedOut, startSite } from './runtime';

const googleScripts = () => [...document.querySelectorAll('script')].filter((s) => s.src.includes('googletagmanager.com'));
const dataLayer = () => ((window as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => [...a]);
const setPrivacySignal = (on: boolean) => Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setPrivacySignal(false);
});
afterEach(() => {
  resetAppAnalytics();
  for (const s of googleScripts()) s.remove();
  document.body.innerHTML = '';
  delete (window as { gtag?: unknown }).gtag;
  delete (window as { dataLayer?: unknown }).dataLayer;
  for (const c of document.cookie.split(';')) document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  vi.unstubAllGlobals();
});

describe('marketing pages (the runtime as /analytics.js)', () => {
  it('measures on the first visit with no banner, analytics storage only — the ad types stay denied and Google signals off', () => {
    startSite('G-TEST123');
    expect(document.querySelector('.fr-consent, [role="dialog"]')).toBeNull();
    expect(googleScripts().map((s) => s.src)).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-TEST123']);
    expect(dataLayer().filter((a) => a[0] === 'consent')).toEqual([
      ['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }],
    ]);
    expect(dataLayer().find((a) => a[0] === 'config')?.[2]).toMatchObject({ allow_google_signals: false, allow_ad_personalization_signals: false });
  });

  it('loads nothing for a browser that opted out (remembered) or sends Global Privacy Control, whose control can’t turn it back on', () => {
    setOptedOut(true);
    startSite('G-TEST123');
    expect(googleScripts()).toHaveLength(0);

    localStorage.clear();
    setPrivacySignal(true);
    document.body.innerHTML = '<footer><ul><li hidden><button data-freero-analytics-toggle>Turn off analytics</button></li></ul></footer>';
    startSite('G-TEST123');
    const control = document.querySelector<HTMLButtonElement>('[data-freero-analytics-toggle]')!;
    expect(control.textContent).toBe('Analytics off (browser privacy signal)');
    control.click();
    expect(googleScripts()).toHaveLength(0);
  });

  it('turning analytics off from the footer stops measuring, deletes Google’s cookies (not the app’s) and offers to turn it back on', () => {
    document.body.innerHTML = '<footer><ul><li hidden><button data-freero-analytics-toggle>Turn off analytics</button></li></ul></footer>';
    startSite('G-TEST123');
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_ga_TEST123=GS1.1.789; path=/';
    document.cookie = 'freero_device=keep; path=/';
    const control = document.querySelector<HTMLButtonElement>('[data-freero-analytics-toggle]')!;
    expect(control.closest('li')!.hidden).toBe(false);

    control.click();
    expect(document.cookie).toBe('freero_device=keep');
    expect(dataLayer().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(control.textContent).toBe('Turn on analytics');
  });
});

describe('the app (the bridge to the analytics frame)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true }), { status: 200 })));
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[src="/analytics-frame"]');

  it('reports a board only as /board with a generic title, never its id, query or the earlier page', async () => {
    startAppAnalytics();
    reportPage('/board/b0ardIdSecret', '?token=s3cret&utm_source=newsletter');
    await settle();
    const f = frame()!;
    const post = vi.spyOn(f.contentWindow!, 'postMessage');
    f.dispatchEvent(new Event('load'));
    const sent = post.mock.calls.map(([m]) => m);
    expect(sent).toEqual([
      {
        freeroAnalytics: 1,
        kind: 'page',
        fields: { page_location: `${location.origin}/board?utm_source=newsletter`, page_title: 'Board', page_referrer: '' },
      },
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/b0ardIdSecret|s3cret/);
  });

  it('measures nothing for a browser that opted out', async () => {
    setOptedOut(true);
    startAppAnalytics();
    reportPage('/app', '');
    track({ name: 'board_created' });
    await settle();
    expect(frame()).toBeNull();
  });

  it('never measures an embedded board (an assistant’s live view, another site’s or Teams’ embed and their sign-in pages), the operators’ console or the OAuth consent screen', async () => {
    startAppAnalytics();
    for (const p of ['/embed/board/abc', '/embed/b/abc', '/embed/connect/abc', '/embed/signed-in', '/teams/tab', '/operator', '/operator/boards/abc/preview', '/oauth/authorize']) {
      reportPage(p, '');
      track({ name: 'board_created' });
    }
    await settle();
    expect(frame()).toBeNull();
  });
});

it('no app route carries an id or token to Google, and no event carries text that could be content', () => {
  const secret = 'Zq9SecretId';
  for (const route of [`/board/${secret}`, `/doc/${secret}`, `/decision/${secret}`, `/invite/${secret}`, `/workspace-invite/${secret}`, `/admin/${secret}`, `/apps/community/${secret}`, `/apps/${secret}`, `/${secret}`, `/board/${secret}/extra`]) {
    const page = analyticsPage(route);
    expect(page, route).not.toBeNull();
    expect(JSON.stringify(page), route).not.toContain(secret);
  }
  expect(analyticsEventParams({ name: 'template_used', template: 'Q3 layoffs plan' })).toBeNull();
  expect(analyticsEventParams({ name: 'login', method: 'anton@example.com' })).toBeNull();
});
