import { memo, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { Download, Film, Music, Paperclip, Pause, Play } from 'lucide-react';
import type { FileElement, MediaElement } from '@freero/shared';
import { defineElement, useEditor, useIsExporting, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { insertFiles } from './lib/insert';
import { downloadBlockedReason, downloadItem } from './lib/download';
import { FAMILY_ICON, extensionOf, familyOf, formatBytes, formatTime, typeLabel } from './lib/kinds';
import { CARD_H, CARD_W, VIDEO_W } from './lib/layout';
import { Controls, togglePlayback, usePlayback } from './lib/Player';
import { registerPlayer, togglePlayer } from './lib/players';
import './media.css';

const stop = (e: PointerEvent) => e.stopPropagation();

/**
 * The player of one item: mounted on the first play only (a board full of videos loads nothing
 * until someone presses play), registered for the Space key, and never in exports (they render a
 * fresh copy, which shows the poster).
 */
function usePlayer(el: MediaElement) {
  const exporting = useIsExporting();
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLMediaElement | null>(null);
  const state = usePlayback(ref, active, el.duration);
  const toggle = useCallback(() => togglePlayback(ref.current, () => setActive(true)), []);
  useEffect(() => (exporting ? undefined : registerPlayer(el.id, toggle)), [el.id, toggle, exporting]);
  // Another file (an undo, a collaborator's replace): start over.
  useEffect(() => setActive(false), [el.src]);
  return { exporting, active: active && !exporting, ref, state, toggle };
}

/** Video: the poster with a play button; once played, the video with its controls. */
function VideoView({ element: el }: { element: MediaElement }) {
  const { exporting, active, ref, state, toggle } = usePlayer(el);
  const scale = Math.max(0.6, Math.min(2.5, el.w / VIDEO_W));
  return (
    <div className={`fr-media${active ? ' is-active' : ''}`} style={{ fontSize: 13 * scale }}>
      {active ? (
        <video
          ref={ref as RefObject<HTMLVideoElement>}
          className="fr-media__video"
          src={el.src}
          poster={el.poster ?? undefined}
          autoPlay
          playsInline
          preload="auto"
        />
      ) : el.poster ? (
        <img className="fr-media__poster" src={el.poster} alt="" draggable={false} />
      ) : (
        <div className="fr-media__blank">
          <Film size="2.6em" strokeWidth={1.4} aria-hidden />
        </div>
      )}
      {!active && (
        <>
          {exporting ? (
            <span className="fr-media__bigplay" aria-hidden>
              <Play size="1.9em" fill="currentColor" strokeWidth={0} />
            </span>
          ) : (
            <button
              type="button"
              className="fr-media__bigplay"
              data-fr-interactive=""
              aria-label={`Play ${el.name}`}
              title="Play"
              onPointerDown={stop}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={toggle}
            >
              <Play size="1.9em" fill="currentColor" strokeWidth={0} />
            </button>
          )}
          <div className="fr-media__caption">
            <span className="fr-media__name">{el.name}</span>
            {el.duration > 0 && <span className="fr-media__duration">{formatTime(el.duration)}</span>}
          </div>
        </>
      )}
      {active && <Controls variant="video" state={state} media={ref.current} onToggle={toggle} />}
    </div>
  );
}

/** A card drawn at CARD_W × CARD_H and scaled with its box (resize keeps the aspect). */
function Card({ el, className, children }: { el: { w: number }; className: string; children: ReactNode }) {
  return (
    <div className="fr-media-card-box">
      <div className={`fr-media-card ${className}`} style={{ width: CARD_W, height: CARD_H, transform: `scale(${el.w / CARD_W})` }}>
        {children}
      </div>
    </div>
  );
}

/** Audio: a compact player card. */
function AudioView({ element: el }: { element: MediaElement }) {
  const { exporting, active, ref, state, toggle } = usePlayer(el);
  return (
    <Card el={el} className="fr-media-card--audio">
      {exporting ? (
        <span className="fr-media-card__playbtn" aria-hidden>
          <Music size={22} />
        </span>
      ) : (
        <button
          type="button"
          className="fr-media-card__playbtn"
          data-fr-interactive=""
          aria-label={state.playing ? `Pause ${el.name}` : `Play ${el.name}`}
          title={state.playing ? 'Pause' : 'Play'}
          onPointerDown={stop}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={toggle}
        >
          {state.playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
        </button>
      )}
      <div className="fr-media-card__body">
        <div className="fr-media-card__name fr-media-card__name--one" title={el.name}>
          {el.name}
        </div>
        {exporting ? (
          <div className="fr-media-card__meta">
            Audio{el.duration > 0 ? ` · ${formatTime(el.duration)}` : ''}
            {el.size ? ` · ${formatBytes(el.size)}` : ''}
          </div>
        ) : (
          <Controls variant="audio" state={state} media={active ? ref.current : null} onToggle={toggle} />
        )}
      </div>
      {active && <audio ref={ref as RefObject<HTMLAudioElement>} src={el.src} autoPlay preload="auto" />}
    </Card>
  );
}

const MediaView = memo(function MediaView({ element }: ElementRenderProps<MediaElement>) {
  return element.kind === 'audio' ? <AudioView element={element} /> : <VideoView element={element} />;
});

/** Any other file: name, type and size, and a download button. */
const FileView = memo(function FileView({ element: el }: ElementRenderProps<FileElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const family = familyOf(el.name);
  const Icon = FAMILY_ICON[family];
  const ext = extensionOf(el.name);
  const blocked = downloadBlockedReason(editor);
  return (
    <Card el={el} className={`fr-file fr-file--${family}`}>
      <div className="fr-file__tile" aria-hidden>
        <Icon size={22} strokeWidth={1.8} />
        {ext && <span className="fr-file__ext">{ext.length > 4 ? ext.slice(0, 4) : ext}</span>}
      </div>
      <div className="fr-media-card__body">
        <div className="fr-media-card__name" title={el.name}>
          {el.name}
        </div>
        <div className="fr-media-card__meta">
          {typeLabel(el.name)}
          {el.size ? ` · ${formatBytes(el.size)}` : ''}
        </div>
      </div>
      {!exporting && (
        <button
          type="button"
          className="fr-file__download"
          data-fr-interactive=""
          aria-label={`Download ${el.name}`}
          title={blocked ?? 'Download'}
          disabled={!!blocked}
          onPointerDown={stop}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => void downloadItem(editor, el)}
        >
          <Download size={18} />
        </button>
      )}
    </Card>
  );
});

/** Real files from a drop or a paste (not the stand-ins a clipboard makes up for text it carries). */
function droppedFiles(data: { files: File[]; text: string | null; html: string | null }): File[] {
  const hasText = !!(data.text || data.html);
  return data.files.filter((f) => !/^pasted\./.test(f.name) && !(hasText && f.type.startsWith('text/')));
}

function playPauseKey(e: KeyboardEvent, { selection }: { editor: Editor; selection: Array<{ id: string; type: string }> }) {
  if (selection.length !== 1 || selection[0].type !== 'media' || e.key !== ' ') return false;
  return togglePlayer(selection[0].id);
}

export default [
  defineElement({
    type: 'media',
    label: { one: 'Video or audio', many: 'Videos and audio' },
    icon: Film,
    resize: 'aspect',
    minSize: { w: 120, h: 32 },
    defaults: (): Omit<NewElement<'media'>, 'x' | 'y'> => ({
      type: 'media',
      w: VIDEO_W,
      h: Math.round((VIDEO_W * 9) / 16),
      kind: 'video',
      src: '',
      poster: null,
      name: 'Video',
      size: 0,
      duration: 0,
      naturalW: 0,
      naturalH: 0,
    }),
    Component: MediaView,
    toPlainText: (el) => el.name,
    keys: [{ shortcuts: ['space'], label: 'Play or pause the selected video or audio', minRole: 'viewer' }],
    onKeyDown: playPauseKey,
    // Below images (100) and PDFs (15): every other dropped or pasted file lands here — video and
    // audio this browser plays as players, anything else as a file card. Above link / text (≤ 10).
    importPriority: 12,
    importData(editor, data, at) {
      const files = droppedFiles(data);
      if (!files.length) return false;
      void insertFiles(editor, files, data.alongside ? null : at, at);
      return files;
    },
  }),
  defineElement({
    type: 'file',
    label: { one: 'File', many: 'Files' },
    icon: Paperclip,
    resize: 'aspect',
    minSize: { w: 120, h: 32 },
    defaults: (): Omit<NewElement<'file'>, 'x' | 'y'> => ({
      type: 'file',
      w: CARD_W,
      h: CARD_H,
      src: '',
      name: 'File',
      size: 0,
      mime: '',
    }),
    Component: FileView,
    toPlainText: (el) => el.name,
  }),
];
