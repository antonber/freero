import { describe, expect, it } from 'vitest';
import { checkUrl, isBlockedAddress, safeFetch } from './fetch';
import { parseMeta } from './meta';

describe('link previews never reach internal addresses (SSRF)', () => {
  it('refuses private, loopback, link-local, CGNAT and mapped-IPv6 forms of them, allows public ones', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe', // 169.254.169.254, hex-mapped
      '64:ff9b::a00:1',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '172.32.0.1', '100.128.0.1'])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('rejects non-http schemes, credentials, odd ports and literal private IPs before any request', () => {
    expect(() => checkUrl('file:///etc/passwd')).toThrow();
    expect(() => checkUrl('ftp://example.com/x')).toThrow();
    expect(() => checkUrl('http://user:pw@example.com/')).toThrow();
    expect(() => checkUrl('http://example.com:6379/')).toThrow();
    expect(() => checkUrl('http://[::1]/')).toThrow();
    expect(() => checkUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(checkUrl('https://example.com/a?b=1').hostname).toBe('example.com');
  });

  it('refuses a host NAME that resolves to loopback at connect time (what a rebinding redirect would hit)', async () => {
    await expect(safeFetch('http://localhost/', { maxBytes: 1000, timeoutMs: 3000, accept: '*/*' })).rejects.toThrow(/not reachable/);
  });
});

describe('reading a page preview', () => {
  const page = `<!doctype html><html><head>
    <title>Fallback &amp; title</title>
    <meta property="og:title" content="Roadmap &#8211; Q3 &quot;draft&quot;">
    <meta name="description" content="  A <b>short</b>   description  ">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content='Example'>
  </head><body><meta property="og:title" content="not this one"></body></html>`;

  it('prefers Open Graph data, decodes entities to plain text and resolves the image against the page URL', () => {
    expect(parseMeta(page, 'https://example.com/docs/roadmap')).toEqual({
      title: 'Roadmap – Q3 "draft"',
      description: 'A short description',
      siteName: 'Example',
      image: 'https://example.com/img/cover.png',
    });
  });

  it('never returns a script URL as the preview image', () => {
    const meta = parseMeta('<head><meta property="og:image" content="javascript:alert(1)"></head>', 'https://example.com/');
    expect(meta.image).toBeNull();
  });
});
