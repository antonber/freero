// The whole HTML document of a page: <head> (title, description, canonical, robots, Open Graph,
// Twitter card, icons, inlined CSS, JSON-LD) and the shared header, breadcrumbs, FAQ, closing call
// to action and footer around the page's body.
import { abs, APP } from '../lib/site';
import type { PageDef } from '../lib/define';
import { LOGO_MARK_PATHS } from '../lib/brand';
import { DraftBanner } from '../lib/legal';
import { ClosingCta, Container, Faq } from './ui';

export interface DocumentAssets {
  css: string;
  ogImage: string;
  favicon: string;
  appleIcon: string;
  preloadFonts: string[];
}

export interface Crumb {
  name: string;
  path: string;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: '/claude', label: 'Claude' },
  { href: '/chatgpt', label: 'ChatGPT' },
  { href: '/agents', label: 'For builders' },
  { href: '/security', label: 'Security' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
];

const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

function Mark({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: LOGO_MARK_PATHS }} />;
}

function NavLinks({ current }: { current: string }) {
  return (
    <ul>
      {NAV.map((n) => (
        <li key={n.href}>
          <a href={n.href} aria-current={current === n.href ? 'page' : undefined}>
            {n.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function SiteHeader({ current }: { current: string }) {
  return (
    <header className="topbar">
      <Container>
        <div className="topbar__row">
          <a className="brand" href="/" aria-label="Freero home">
            <Mark size={30} />
            <span className="brand__word" aria-hidden="true">
              freero
            </span>
          </a>
          <nav className="nav nav--wide" aria-label="Main">
            <NavLinks current={current} />
          </nav>
          <div className="topbar__actions">
            <a className="topbar__login" href={APP.login}>
              Log in
            </a>
            <a className="btn btn--primary btn--sm" href={APP.signup}>
              Start free
            </a>
          </div>
          <details className="menu">
            <summary>
              <span className="visually-hidden">Open the </span>Menu
            </summary>
            <nav className="nav nav--menu" aria-label="Main">
              <NavLinks current={current} />
              <a className="menu__login" href={APP.login}>
                Log in
              </a>
            </nav>
          </details>
        </div>
      </Container>
    </header>
  );
}

function SiteFooter() {
  const cols: Array<{ title: string; links: Array<[string, string]> }> = [
    {
      title: 'Product',
      links: [
        ['/', 'Overview'],
        ['/pricing', 'Pricing'],
        ['/security', 'Security'],
        ['/open-source', 'Open source'],
        ['/vs', 'Compare'],
      ],
    },
    {
      title: 'Agents',
      links: [
        ['/claude', 'Freero for Claude'],
        ['/chatgpt', 'Freero for ChatGPT'],
        ['/agents', 'Build with agents'],
        ['/docs', 'Documentation'],
      ],
    },
    {
      title: 'Your account',
      links: [
        [APP.signup, 'Start free'],
        [APP.login, 'Log in'],
        ['/support', 'Help and support'],
      ],
    },
    {
      title: 'Legal',
      links: [
        ['/privacy', 'Privacy policy'],
        ['/terms', 'Terms of service'],
        ['/acceptable-use', 'Acceptable use'],
      ],
    },
  ];
  return (
    <footer className="footer">
      <Container>
        <div className="footer__grid">
          <div className="footer__brand">
            <a className="brand brand--light" href="/" aria-label="Freero home">
              <Mark size={28} />
              <span className="brand__word" aria-hidden="true">
                freero
              </span>
            </a>
            <p>The whiteboard for teams of people and AI agents. Free, MIT licensed, and yours to host.</p>
          </div>
          {cols.map((c) => (
            <nav key={c.title} className="footer__col" aria-label={c.title}>
              <h2 className="footer__title">{c.title}</h2>
              <ul>
                {c.links.map(([href, label]) => (
                  <li key={href}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="footer__legal">
          Claude is a trademark of Anthropic. ChatGPT is a trademark of OpenAI. Jira, Linear, GitHub, Cursor, VS Code and other product names are
          trademarks of their respective owners. Freero is an independent open-source project, not affiliated with or endorsed by them.
        </p>
      </Container>
    </footer>
  );
}

function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Container>
        <ol>
          {items.map((c, i) =>
            i === items.length - 1 ? (
              <li key={c.path} aria-current="page">
                {c.name}
              </li>
            ) : (
              <li key={c.path}>
                <a href={c.path}>{c.name}</a>
              </li>
            ),
          )}
        </ol>
      </Container>
    </nav>
  );
}

export function Document({ page, pages, assets, crumbs, jsonLd }: { page: PageDef; pages: PageDef[]; assets: DocumentAssets; crumbs: Crumb[]; jsonLd: Record<string, unknown> }) {
  const url = abs(page.path);
  // A legal page is built as a draft; the server makes it indexable once it is in effect.
  const indexable = page.index !== false && !page.legal;
  const ogAlt = `${page.ogTitle ?? page.name}: Freero`;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{page.title}</title>
        <meta name="description" content={page.description} />
        <link rel="canonical" href={url} />
        <meta name="robots" content={indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'} />
        <meta name="theme-color" content="#5b3ff0" />
        <link rel="icon" type="image/svg+xml" href={assets.favicon} />
        <link rel="apple-touch-icon" href={assets.appleIcon} />
        {assets.preloadFonts.map((f) => (
          <link key={f} rel="preload" href={f} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Freero" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:title" content={page.title} />
        <meta property="og:description" content={page.description} />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={abs(assets.ogImage)} />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={ogAlt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={page.title} />
        <meta name="twitter:description" content={page.description} />
        <meta name="twitter:image" content={abs(assets.ogImage)} />
        <meta name="twitter:image:alt" content={ogAlt} />
        <style dangerouslySetInnerHTML={{ __html: assets.css }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader current={page.path} />
        <main id="main" tabIndex={-1}>
          {crumbs.length > 1 ? <Breadcrumbs items={crumbs} /> : null}
          {page.legal ? (
            <Container>
              <DraftBanner />
            </Container>
          ) : null}
          <page.body pages={pages} />
          {page.faq?.length ? <Faq items={page.faq} /> : null}
          {page.closingCta === false ? null : <ClosingCta />}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
