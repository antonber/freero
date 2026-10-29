import { memo, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import { ExternalLink, Globe, Link as LinkIcon, Maximize2, MousePointerClick, Play, X } from 'lucide-react';
import type { EmbedElement } from '@freero/shared';
import { defineElement, useEditor, useIsExporting, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { asLink, displayHost, liveEmbed, safeImageSrc, type LiveEmbed } from './lib/providers';
import { CARD_H_TEXT, CARD_W, fillPreview, isFetching, sizeFor, subscribeFetching } from './lib/preview';
import './embed.css';

const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();

/** The live frame this board may show for a link: allow-listed, and not turned off by the workspace. */
export function embedFor(editor: Editor, url: string): LiveEmbed | null {
  const policy = editor.host.board.embeds;
  if (policy && !policy.enabled) return null;
  return liveEmbed(url, policy?.extraOrigins ?? []);
}

/**
 * The live frame, mounted only after a click, for this viewer only. It takes pointer input only
 * while the item is selected: otherwise the board pans and zooms over it as over any item. The
 * strip above it (always board-owned) is where the item is grabbed, and holds full screen / close.
 */
function LiveFrame({ el, live, selected, onClose }: { el: EmbedElement; live: LiveEmbed; selected: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className={`fr-embed fr-embed--live${live.kind === 'video' ? ' is-video' : ''}`}>
      <div className="fr-embed__strip">
        <Globe size={12} strokeWidth={2} aria-hidden />
        <span className="fr-embed__strip-title">{el.title ?? live.label}</span>
        <span className="fr-embed__strip-host">{live.label}</span>
        <button
          type="button"
          className="fr-embed__strip-btn"
          data-fr-interactive=""
          title="Full screen"
          aria-label="Full screen"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            void box.current?.requestFullscreen?.().catch(() => undefined);
          }}
        >
          <Maximize2 size={13} strokeWidth={2} />
        </button>
        <a
          className="fr-embed__strip-btn"
          href={el.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-fr-interactive=""
          title="Open in a new tab"
          aria-label="Open in a new tab"
          onPointerDown={stop}
        >
          <ExternalLink size={13} strokeWidth={2} />
        </a>
        <button
          type="button"
          className="fr-embed__strip-btn"
          data-fr-interactive=""
          title="Close (show the preview again)"
          aria-label="Close live view"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
      <div className="fr-embed__frame" {...(selected ? { 'data-fr-interactive': '' } : {})}>
        <iframe
          className="fr-embed__player"
          src={live.src}
          title={el.title ?? live.label}
          sandbox={live.sandbox}
          allow={live.allow}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        />
      </div>
    </div>
  );
}

/**
 * A link card. Links to allow-listed providers (videos, design files, docs, code playgrounds) show
 * a button that swaps in the provider's live frame (sandboxed, allow-listed src) for this viewer
 * only, so boards with many embeds stay fast. Exports and thumbnails always draw the card with its
 * poster: they render a fresh copy that is never live.
 */
const EmbedView = memo(function EmbedView({ element: el, selected }: ElementRenderProps<EmbedElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const [active, setActive] = useState(false);
  const fetching = useSyncExternalStore(subscribeFetching, () => isFetching(el.id));
  const live = embedFor(editor, el.url);
  const image = safeImageSrc(el.image);
  const host = el.siteName || displayHost(el.url);
  const loading = el.status === 'loading' && fetching;
  const video = live?.kind === 'video';

  // A re-pointed link or a workspace that turned embeds off ends the live view.
  const src = live?.src ?? null;
  useEffect(() => setActive(false), [src]);

  if (active && live && !exporting) return <LiveFrame el={el} live={live} selected={selected} onClose={() => setActive(false)} />;

  // Opening it selects it, so the frame takes input right away.
  const activate = (e: MouseEvent) => {
    e.stopPropagation();
    setActive(true);
    editor.select([el.id]);
  };
  return (
    <div className={`fr-embed${loading ? ' is-loading' : ''}${image || live ? '' : ' fr-embed--text'}`}>
      {(image || live) && (
        <div className={`fr-embed__media${video ? ' is-video' : live ? ' is-doc' : ''}`}>
          {image && <img src={image} alt="" draggable={false} referrerPolicy="no-referrer" />}
          {live && !image && !video && (
            <div className="fr-embed__poster" aria-hidden>
              <span>{live.label}</span>
            </div>
          )}
          {live && !exporting && (
            <button
              type="button"
              className={video ? 'fr-embed__play' : 'fr-embed__activate'}
              data-fr-interactive=""
              aria-label={video ? `Play ${live.label} video` : `Open live ${live.label} view`}
              title={video ? `Play ${live.label} video` : `Open live view (${live.label})`}
              onPointerDown={stop}
              onClick={activate}
            >
              {video ? (
                <Play size={26} strokeWidth={2.2} fill="currentColor" />
              ) : (
                <>
                  <MousePointerClick size={16} strokeWidth={2.2} />
                  <span>Open live</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
      <div className="fr-embed__body">
        <div className="fr-embed__title">{loading ? 'Loading preview…' : (el.title ?? el.url)}</div>
        {el.description && !loading && <div className="fr-embed__desc">{el.description}</div>}
        <div className="fr-embed__host">
          <Globe size={12} strokeWidth={2} />
          <span>{live && live.label.toLowerCase() !== host.toLowerCase() ? `${live.label} · ${host}` : host}</span>
          {!exporting && (
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
          )}
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
    const { w, h } = sizeFor(liveEmbed(url, editor.host.board.embeds?.extraOrigins ?? []), false);
    const id = editor.create<'embed'>(
      {
        type: 'embed',
        url,
        title: null,
        description: null,
        siteName: null,
        image: null,
        status: 'loading',
        x: Math.round(at.x - w / 2),
        y: Math.round(at.y - h / 2),
        w,
        h,
      },
      { select: true },
    );
    if (id) void fillPreview(editor, id, url);
    return true;
  },
});
