import { memo, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import { ExternalLink, Globe, Link as LinkIcon, Play } from 'lucide-react';
import type { EmbedElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { asLink, displayHost, safeImageSrc, videoEmbed } from './lib/providers';
import { CARD_H_IMAGE, CARD_H_TEXT, CARD_W, fillPreview, isFetching, subscribeFetching } from './lib/preview';
import './embed.css';

const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();

/**
 * A link card. Video links show a play button; clicking it swaps in the provider's player
 * (sandboxed iframe, allowlisted src) for this viewer only, so boards with many videos stay
 * fast and exports always draw the card — an export renders a fresh copy that never plays.
 */
const EmbedView = memo(function EmbedView({ element: el }: ElementRenderProps<EmbedElement>) {
  const [playing, setPlaying] = useState(false);
  const fetching = useSyncExternalStore(subscribeFetching, () => isFetching(el.id));
  const video = videoEmbed(el.url);
  const image = safeImageSrc(el.image);
  const host = el.siteName || displayHost(el.url);
  const loading = el.status === 'loading' && fetching;

  if (playing && video) {
    return (
      <div className="fr-embed fr-embed--playing" data-fr-interactive="">
        <iframe
          className="fr-embed__player"
          src={video.src}
          title={el.title ?? `${video.provider} video`}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
        <button type="button" className="fr-embed__close" data-fr-interactive="" onPointerDown={stop} onClick={() => setPlaying(false)} title="Stop video">
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className={`fr-embed${loading ? ' is-loading' : ''}${image || video ? '' : ' fr-embed--text'}`}>
      {(image || video) && (
        <div className={`fr-embed__media${video ? ' is-video' : ''}`}>
          {image && <img src={image} alt="" draggable={false} referrerPolicy="no-referrer" />}
          {video && (
            <button
              type="button"
              className="fr-embed__play"
              data-fr-interactive=""
              aria-label={`Play ${video.provider} video`}
              title={`Play ${video.provider} video`}
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                setPlaying(true);
              }}
            >
              <Play size={26} strokeWidth={2.2} fill="currentColor" />
            </button>
          )}
        </div>
      )}
      <div className="fr-embed__body">
        <div className="fr-embed__title">{loading ? 'Loading preview…' : (el.title ?? el.url)}</div>
        {el.description && !loading && <div className="fr-embed__desc">{el.description}</div>}
        <div className="fr-embed__host">
          <Globe size={12} strokeWidth={2} />
          <span>{video && video.provider.toLowerCase() !== host.toLowerCase() ? `${video.provider} · ${host}` : host}</span>
          <a
            className="fr-embed__open"
            href={el.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-fr-interactive=""
            title="Open link in a new tab"
            aria-label="Open link in a new tab"
            onPointerDown={stop}
          >
            <ExternalLink size={13} strokeWidth={2} />
          </a>
        </div>
      </div>
    </div>
  );
});

export default defineElement({
  type: 'embed',
  label: { one: 'Link', many: 'Links' },
  icon: LinkIcon,
  resize: 'free',
  minSize: { w: 200, h: 96 },
  defaults: (): Omit<NewElement<'embed'>, 'x' | 'y'> => ({
    type: 'embed',
    w: CARD_W,
    h: CARD_H_TEXT,
    url: '',
    title: null,
    description: null,
    siteName: null,
    image: null,
    status: 'ready',
  }),
  Component: EmbedView,
  toPlainText: (el) => [el.title, el.url].filter(Boolean).join('\n'),

  // A pasted link becomes a card right away; its title / text / picture arrive from the server.
  // Ahead of lists and text boxes (a URL is not prose), behind spreadsheet tables.
  importPriority: 10,
  importData(editor, data, at) {
    if (data.files.length) return false;
    const link = asLink(data.text);
    if (!link) return false;
    const url = link.toString();
    const h = videoEmbed(url) ? CARD_H_IMAGE : CARD_H_TEXT;
    const id = editor.create<'embed'>(
      {
        type: 'embed',
        url,
        title: null,
        description: null,
        siteName: null,
        image: null,
        status: 'loading',
        x: Math.round(at.x - CARD_W / 2),
        y: Math.round(at.y - h / 2),
        w: CARD_W,
        h,
      },
      { select: true },
    );
    if (id) void fillPreview(editor, id, url);
    return true;
  },
});

