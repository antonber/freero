import { describe, expect, it } from 'vitest';
import { asLink, safeImageSrc, videoEmbed } from './lib/providers';

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
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.provider).toBe('YouTube');
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
