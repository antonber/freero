import { describe, expect, it } from 'vitest';
import { EMBED_FRAME_ORIGINS } from '@freero/shared';
import type { Editor } from '@engine';
import { asLink, liveEmbed, safeImageSrc, videoEmbed } from './lib/providers';
import { embedFor } from './element';

describe('which pasted text is a link card', () => {
  it('claims exactly one http(s) URL, never text around it or other schemes', () => {
    expect(asLink('  https://example.com/a?b=1  ')?.toString()).toBe('https://example.com/a?b=1');
    expect(asLink('see https://example.com')).toBeNull();
    expect(asLink('javascript:alert(1)')).toBeNull();
    expect(asLink('file:///etc/passwd')).toBeNull();
    expect(asLink('http://localhost')).toBeNull();
  });
});

describe('inline video players', () => {
  it('plays YouTube, Vimeo and Loom links from their own player hosts, keeping a start time', () => {
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90');
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.label).toBe('YouTube');
    expect(videoEmbed('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
    expect(videoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.src).toBe(
      'https://www.loom.com/embed/0123456789abcdef0123456789abcdef?autoplay=1',
    );
  });

  it('never frames anything else: look-alike hosts and ids that could smuggle a path or query stay cards', () => {
    expect(videoEmbed('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbed('https://www.youtube.com/watch?v=abc/../../x')).toBeNull();
    expect(videoEmbed('https://vimeo.com/76979871x')).toBeNull();
    expect(videoEmbed('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('only shows card pictures from safe sources', () => {
    expect(safeImageSrc('/uploads/ab.jpg')).toBe('/uploads/ab.jpg');
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
  });
});

describe('live embeds of documents (KAI-127)', () => {
  const docs = {
    figma: 'https://www.figma.com/design/AbCdEfGhIjKlMnOp/Roadmap?node-id=12-34&t=xyz',
    doc: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing',
    sheet: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0',
    slides: 'https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz012345/pub?start=false',
    form: 'https://docs.google.com/forms/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz012345/viewform',
    pen: 'https://codepen.io/someone/pen/AbCdEf',
    sandbox: 'https://codesandbox.io/s/react-new-abc12',
  };

  it('opens each allow-listed provider through its own embed view, on an origin the CSP frames', () => {
    const live = Object.fromEntries(Object.entries(docs).map(([k, url]) => [k, liveEmbed(url)]));
    expect(live.figma?.src).toBe(`https://www.figma.com/embed?embed_host=freero&url=${encodeURIComponent('https://www.figma.com/design/AbCdEfGhIjKlMnOp?node-id=12-34')}`);
    expect(live.doc?.src).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/preview');
    expect(live.sheet?.label).toBe('Google Sheets');
    expect(live.slides?.src).toBe('https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz012345/embed');
    expect(live.form?.src).toContain('/viewform?embedded=true');
    expect(live.pen?.src).toBe('https://codepen.io/someone/embed/AbCdEf?default-tab=result');
    expect(live.sandbox?.src).toBe('https://codesandbox.io/embed/react-new-abc12?view=preview');
    for (const e of Object.values(live)) {
      expect(EMBED_FRAME_ORIGINS).toContain(new URL(e!.src).origin);
      // Every frame is sandboxed, and never with top navigation.
      expect(e!.sandbox).toMatch(/allow-scripts/);
      expect(e!.sandbox).not.toMatch(/allow-top-navigation/);
    }
  });

  it('keeps every other link a preview card, including look-alikes and URLs that smuggle a target', () => {
    for (const url of [
      'https://example.com/design/AbCdEfGhIjKlMnOp',
      'https://www.figma.com.evil.example/design/AbCdEfGhIjKlMnOp',
      'https://evil.example/?u=https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com/document/d/..%2F..%2Fsomething-else-entirely-here/edit',
      'https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://codepen.io/someone/pen/Ab"onload=x',
      'https://miro.com/app/board/uXjVabc=/',
    ])
      expect(liveEmbed(url)).toBeNull();
  });

  it('frames an operator’s extra origin only over https and only that exact origin', () => {
    const extra = ['https://wiki.example.com'];
    expect(liveEmbed('https://wiki.example.com/embed/page-1', extra)?.src).toBe('https://wiki.example.com/embed/page-1');
    expect(liveEmbed('http://wiki.example.com/embed/page-1', extra)).toBeNull();
    expect(liveEmbed('https://wiki.example.com.evil.example/x', extra)).toBeNull();
    expect(liveEmbed('https://other.example.com/x', extra)).toBeNull();
    expect(liveEmbed('https://wiki.example.com/embed/page-1')).toBeNull();
  });
});

describe('the workspace switch', () => {
  const on = (embeds?: { enabled: boolean; extraOrigins: string[] }) => ({ host: { board: { embeds } } }) as unknown as Editor;

  it('turned off, every link stays a preview card — videos and the operator’s origins too', () => {
    const off = on({ enabled: false, extraOrigins: ['https://wiki.example.com'] });
    expect(embedFor(off, 'https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(embedFor(off, 'https://wiki.example.com/embed/1')).toBeNull();
    expect(embedFor(on({ enabled: true, extraOrigins: ['https://wiki.example.com'] }), 'https://wiki.example.com/embed/1')).not.toBeNull();
    // Hosts that don't say (the offline sandbox): the built-in providers only.
    expect(embedFor(on(), 'https://youtu.be/dQw4w9WgXcQ')).not.toBeNull();
  });
});
