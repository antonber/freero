// IndexNow (https://www.indexnow.org/documentation): tell the search engines that use it (Bing,
// Yandex, Seznam, Naver…) which of this host's URLs are new or changed. The URL list comes from the
// site's own sitemaps, so it is exactly the pages the site asks to have indexed. Pure functions;
// scripts/indexnow.mjs does the network calls.

/** IndexNow takes at most 10,000 URLs per request. */
export const INDEXNOW_BATCH = 10_000;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The `<url>` (or `<sitemap>`) entries of a sitemap: their loc and lastmod. */
export function sitemapEntries(xml) {
  return [...xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    kind: m[1],
    loc: unescapeXml(/<loc>([^<]+)<\/loc>/.exec(m[2])?.[1].trim() ?? ''),
    lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(m[2])?.[1].trim() ?? null,
  }));
}

/**
 * Every page URL reachable from a sitemap (an index is followed into its sitemaps), with its
 * lastmod. `since` (YYYY-MM-DD) keeps only pages changed on or after that day. `read(url)` returns
 * a sitemap's XML.
 */
export async function sitemapUrls(read, sitemapUrl, { since = null } = {}) {
  const pages = new Map();
  const seen = new Set();
  const queue = [sitemapUrl];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    for (const e of sitemapEntries(await read(url))) {
      if (!e.loc) continue;
      if (e.kind === 'sitemap') queue.push(e.loc);
      else pages.set(e.loc, e.lastmod);
    }
  }
  return [...pages]
    .filter(([, lastmod]) => !since || !lastmod || lastmod.slice(0, 10) >= since)
    .map(([loc]) => loc)
    .sort();
}

/**
 * The request bodies to POST to IndexNow for `urls` on `site` (an origin), with the key file at
 * `<site>/<key>.txt`. A URL on another host would make IndexNow refuse the whole batch (422), so
 * those are returned in `skipped` instead.
 */
export function indexNowRequests(site, key, urls) {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('an IndexNow key is 8 to 128 characters of letters, digits and dashes');
  const origin = new URL(site).origin;
  const host = new URL(origin).host;
  const own = urls.filter((u) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  });
  const skipped = urls.filter((u) => !own.includes(u));
  const bodies = [];
  for (let i = 0; i < own.length; i += INDEXNOW_BATCH) bodies.push({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: own.slice(i, i + INDEXNOW_BATCH) });
  return { bodies, skipped };
}
