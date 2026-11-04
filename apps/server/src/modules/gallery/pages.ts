// The gallery's public pages (#162), as markup for the marketing site's slots: the hub's list
// (search, categories, cards) and one template's page. Everything a submitter wrote is plain text,
// escaped here; nothing they wrote becomes a link. Styles are the site's own (apps/site site.css:
// tpl-* cards, gal-*). No script.
import { GALLERY_CATEGORIES, GALLERY_LICENCES, type GalleryTemplate } from '@freero/shared';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const categoryLabel = (id: string) => GALLERY_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
const licenceOf = (id: string) => GALLERY_LICENCES.find((l) => l.id === id) ?? GALLERY_LICENCES[0];
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
/** "Use this template": sign up (or in) first, then the dashboard adds it (DashboardPage `?gallery=`). */
export const useHref = (id: string) => `/signup?next=${encodeURIComponent(`/app?gallery=${id}`)}`;

function card(t: GalleryTemplate): string {
  return `<li class="tpl-card"><span class="tpl-card__thumb"><img class="tpl-preview" src="${esc(t.previewUrl)}" alt="Preview of ${esc(t.title)}" loading="lazy" width="320" height="200"/></span><h3 class="tpl-card__title"><a href="${esc(t.url)}">${esc(t.title)}</a></h3><p>${esc(t.description.split('\n')[0].slice(0, 160))}</p><p class="gal-card__by">By ${esc(t.author)} · ${esc(licenceOf(t.licence).name)}</p></li>`;
}

/** The hub's list: the search form, category filters and the matching templates. */
export function hubBody(list: GalleryTemplate[], q: string, category: string | null): string {
  const cats = [{ id: '', label: 'All' }, ...GALLERY_CATEGORIES]
    .map((c) => {
      const href = c.id ? `/gallery?category=${c.id}` : '/gallery';
      return `<li><a href="${href}"${(category ?? '') === c.id ? ' aria-current="page"' : ''}>${esc(c.label)}</a></li>`;
    })
    .join('');
  const form = `<form class="gal-search" action="/gallery" method="get" role="search"><label class="visually-hidden" for="gal-q">Search community templates</label><input id="gal-q" type="search" name="q" value="${esc(q)}" maxlength="100" placeholder="Search community templates"/>${category ? `<input type="hidden" name="category" value="${esc(category)}"/>` : ''}<button class="btn btn--primary btn--sm" type="submit">Search</button></form>`;
  const empty = q || category ? 'No community template matches that yet.' : 'No community templates yet. Share one of your boards from its menu: Publish to the community gallery.';
  const results = list.length ? `<ul class="tpl-cards">${list.map(card).join('')}</ul>` : `<p class="gal-empty">${esc(empty)}</p>`;
  return `<section id="community" class="section section--plain" aria-labelledby="community-title"><div class="wrap"><h2 id="community-title">${q ? `Templates matching “${esc(q)}”` : category ? esc(categoryLabel(category)) : 'Newest templates'}</h2>${form}<nav aria-label="Categories"><ul class="tpl-cats">${cats}</ul></nav>${results}</div></section>`;
}

/** One template's page body. */
export function templateBody(t: GalleryTemplate): string {
  const l = licenceOf(t.licence);
  const licenceLine =
    t.licence === 'cc0-1.0'
      ? `Dedicated to the public domain under <a href="${l.url}" rel="license noopener">${l.name}</a>: use it for anything, no credit needed.`
      : `Shared under <a href="${l.url}" rel="license noopener">${l.name}</a>: use and adapt it for anything, crediting ${esc(t.author)}.`;
  return `<header class="hero"><div class="wrap"><div class="hero__grid"><div class="hero__text"><p class="kicker">Community template · ${esc(categoryLabel(t.category))}</p><h1>${esc(t.title)}</h1><p class="lead">By ${esc(t.author)}</p><div class="actions"><a class="btn btn--primary" href="${esc(useHref(t.id))}">Use this template</a><a class="btn btn--secondary" href="/gallery">More community templates</a></div></div></div></div></header><section class="section section--plain" aria-label="About this template"><div class="wrap"><figure class="tpl-hero gal-hero"><img class="tpl-preview" src="${esc(t.previewUrl)}" alt="Preview of the ${esc(t.title)} template" width="960" height="600"/></figure><div class="gal-about">${paragraphs(t.description)}<p class="gal-licence">${licenceLine}</p><p class="gal-meta">${t.items} items${t.publishedAt ? ` · published ${day(t.publishedAt)}` : ''}. Made by someone who uses Freero and reviewed before it was published; it isn’t made or endorsed by Freero.</p><p class="gal-meta"><a href="/app?gallery=${esc(t.id)}&amp;report=1" rel="nofollow">Report this template</a></p></div></div></section>`;
}

/** The meta description of a template's page (≤ 155 characters). */
export function templateDescription(t: GalleryTemplate): string {
  const base = `${t.description.replace(/\s+/g, ' ').trim()}`;
  const tail = ` A free community template by ${t.author}.`;
  const room = 155 - tail.length;
  return (base.length > room ? `${base.slice(0, Math.max(0, room - 1)).trimEnd()}…` : base) + tail;
}

/** The sitemap of public templates (robots.txt names it). */
export function sitemapXml(origin: string, list: GalleryTemplate[]): string {
  const urls = list.map((t) => `  <url><loc>${xmlEsc(`${origin}${t.url}`)}</loc>${t.publishedAt ? `<lastmod>${day(t.publishedAt)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}${urls ? '\n' : ''}</urlset>\n`;
}
