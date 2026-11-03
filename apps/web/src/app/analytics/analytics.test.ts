// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsEventParams, analyticsPage } from '@freero/shared';
import { reportPage, resetAppAnalytics, startAppAnalytics, track } from './bridge';
import { closeConsentBanner, CONSENT_KEY, saveChoice, startSite } from './runtime';

const googleScripts = () => [...document.querySelectorAll('script')].filter((s) => s.src.includes('googletagmanager.com'));
const banner = () => document.querySelector<HTMLElement>('.fr-consent');
const button = (label: string) => [...(banner()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label)!;
const setPrivacySignal = (on: boolean) => Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setPrivacySignal(false);
});
afterEach(() => {
  resetAppAnalytics();
  closeConsentBanner(false);
  for (const s of googleScripts()) s.remove();
  delete (window as { gtag?: unknown }).gtag;
  delete (window as { dataLayer?: unknown }).dataLayer;
  for (const c of document.cookie.split(';')) document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  vi.unstubAllGlobals();
});

describe('marketing pages (the runtime as /analytics.js)', () => {
  it('loads nothing from Google until the visitor accepts — not on arrival, not after Decline — and then only analytics, ads denied', () => {
    startSite('G-TEST123');
    expect(banner()).not.toBeNull();
    expect(googleScripts()).toHaveLength(0);
    expect((window as { dataLayer?: unknown[] }).dataLayer).toBeUndefined();

    button('Decline').click();
    expect(banner()).toBeNull();
    expect(googleScripts()).toHaveLength(0);

    saveChoice('granted');
    const [script] = googleScripts();
    expect(script?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
    const consent = ((window as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => [...a]).filter((a) => a[0] === 'consent');
    expect(consent).toEqual([
      ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }],
      ['consent', 'update', { analytics_storage: 'granted' }],
    ]);
  });

  it('treats Global Privacy Control as Decline, even over an earlier Accept: no banner asking, no script', () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: 'granted', at: Date.now() }));
    setPrivacySignal(true);
    startSite('G-TEST123');
    expect(banner()).toBeNull();
    expect(googleScripts()).toHaveLength(0);
  });

  it('declining after accepting deletes Google’s cookies and keeps the app’s own', () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_ga_TEST123=GS1.1.789; path=/';
    document.cookie = 'freero_device=keep; path=/';
    saveChoice('denied');
    expect(document.cookie).toBe('freero_device=keep');
  });
});

describe('the app (the bridge to the analytics frame)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, privacyUrl: '/privacy' }), { status: 200 })));
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[src="/analytics-frame"]');

  it('reports a board only as /board with a generic title, keeps its id, query and the earlier page out, and only once the visitor accepts', async () => {
    startAppAnalytics();
    reportPage('/board/b0ardIdSecret', '?token=s3cret&utm_source=newsletter');
    track({ name: 'board_created' });
    await settle();
    expect(frame()).toBeNull(); // asked, not measured

    button('Accept').click();
    const f = frame()!;
    const post = vi.spyOn(f.contentWindow!, 'postMessage');
    f.dispatchEvent(new Event('load'));
    const sent = post.mock.calls.map(([m]) => m as { kind: string; fields: Record<string, string> });
    expect(sent).toEqual([
      {
        freeroAnalytics: 1,
        kind: 'page',
        fields: { page_location: `${location.origin}/board?utm_source=newsletter`, page_title: 'Board', page_referrer: '' },
      },
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/b0ardIdSecret|s3cret/);
  });

  it('never measures nor asks in an embedded board (an assistant’s live view, another site’s embed and its sign-in pages), the operators’ console or the OAuth consent screen', async () => {
    startAppAnalytics();
    for (const p of ['/embed/board/abc', '/embed/b/abc', '/embed/connect/abc', '/embed/signed-in']) {
      reportPage(p, '');
      await settle();
      expect(banner(), p).toBeNull(); // no choice yet, and still not asked there
    }

    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: 'granted', at: Date.now() }));
    for (const p of ['/embed/b/abc', '/embed/connect/abc', '/operator', '/operator/boards/abc/preview', '/oauth/authorize']) {
      reportPage(p, '');
      track({ name: 'board_created' });
    }
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
