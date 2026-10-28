import { memo, type MouseEvent, type PointerEvent } from 'react';
import { ArrowUpRight, Folder, LayoutDashboard, LayoutTemplate, Link2, Lock, Users } from 'lucide-react';
import { parseObjectUri, type ObjectLinkElement, type ObjectRef, type ObjectSummary } from '@freero/shared';
import { defineElement, describeElementType, useEditor, useIsExporting, type Editor, type ElementRenderProps, type IconComponent, type NewElement } from '@engine';
import { pastedObject } from './lib/address';
import { useResolvedObject } from './lib/useResolved';
import './smartlink.css';

const CHIP_W = 300;
const CHIP_H = 64;

const TYPE_ICON: Record<string, IconComponent> = { board: LayoutDashboard, template: LayoutTemplate, workspace: Users, project: Folder };
const TYPE_NAME: Record<string, string> = { board: 'Board', element: 'Item', template: 'Template', workspace: 'Workspace', project: 'Project' };

const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();

/** Goes to the target: an item on this board glides into view; anything else opens its page. */
function open(editor: Editor, ref: ObjectRef | null, object: ObjectSummary | null): void {
  if (ref?.type === 'element' && ref.boardId === editor.host.board.id) {
    if (!editor.getElement(ref.id) || !editor.getBounds([ref.id])) return editor.host.notify('That item isn’t on this board any more, or is hidden.', 'info');
    editor.select([ref.id]);
    editor.zoomToFit([ref.id], { animate: true, maxZoom: 1, padding: 120 });
    return;
  }
  const path = object?.path ?? (ref?.type === 'board' ? `/board/${ref.id}` : ref?.type === 'element' ? `/board/${ref.boardId}?el=${ref.id}` : null);
  if (path) editor.host.navigate(path);
  else editor.host.notify('This kind of link has no page to open yet.', 'info');
}

/**
 * A live chip: the target's CURRENT title for this viewer, asked from the server on every view.
 * Nothing about the target is stored on the board, so someone who can't see it learns nothing.
 */
const ObjectLinkView = memo(function ObjectLinkView({ element: el }: ElementRenderProps<ObjectLinkElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const ref = parseObjectUri(el.uri);
  const res = useResolvedObject(editor, el.uri, !exporting && !!ref);
  const object = res.state === 'ok' ? res.object : null;

  let Icon: IconComponent = ref ? (TYPE_ICON[ref.type] ?? Link2) : Link2;
  let title: string;
  let meta: string;
  if (!ref) {
    title = 'Not a Freero link';
    meta = el.uri;
  } else if (exporting || res.state === 'offline') {
    title = `Freero ${TYPE_NAME[ref.type].toLowerCase()}`;
    meta = el.uri;
  } else if (res.state === 'loading') {
    title = 'Loading…';
    meta = TYPE_NAME[ref.type];
  } else if (res.state === 'unavailable') {
    Icon = Lock;
    title = 'No access';
    meta = 'Not shared with you, or deleted';
  } else {
    const o = res.object;
    if (o.type === 'element' && o.kind) {
      const kind = describeElementType(editor, o.kind);
      Icon = kind.icon;
      title = o.title || kind.one;
      meta = o.board ? `${kind.one} on ${o.board.title}` : kind.one;
    } else {
      title = o.title;
      meta = TYPE_NAME[o.type];
    }
  }
  const denied = res.state === 'unavailable';
  return (
    <div className={`fr-smartlink${denied ? ' is-denied' : ''}${res.state === 'loading' && !exporting ? ' is-loading' : ''}`}>
      <span className="fr-smartlink__icon" aria-hidden>
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className="fr-smartlink__text">
        <span className="fr-smartlink__title">{title}</span>
        <span className="fr-smartlink__meta">{meta}</span>
      </span>
      {ref && !exporting && (
        <button
          type="button"
          className="fr-smartlink__open"
          data-fr-interactive=""
          title={denied ? 'Open (you may be able to ask for access)' : 'Open'}
          aria-label={denied ? 'Open link' : `Open ${title}`}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            open(editor, ref, object);
          }}
        >
          <ArrowUpRight size={16} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
});

export default defineElement({
  type: 'objectlink',
  label: { one: 'Smart link', many: 'Smart links' },
  icon: Link2,
  resize: 'free',
  minSize: { w: 180, h: 48 },
  defaults: (): Omit<NewElement<'objectlink'>, 'x' | 'y'> => ({ type: 'objectlink', w: CHIP_W, h: CHIP_H, uri: '' }),
  Component: ObjectLinkView,
  // The address only: the title is the viewer's to resolve, never copied out with the board.
  toPlainText: (el) => el.uri,

  // A pasted Freero address (a board or item URL of this app, or freero://…) becomes a chip;
  // ahead of the link card (10), which would otherwise try to preview Freero's own page.
  importPriority: 11,
  importData(editor, data, at) {
    if (data.files.length) return false;
    const found = pastedObject(data.text, window.location.origin);
    if (!found) return false;
    editor.create<'objectlink'>(
      { type: 'objectlink', uri: found.uri, x: Math.round(at.x - CHIP_W / 2), y: Math.round(at.y - CHIP_H / 2), w: CHIP_W, h: CHIP_H },
      { select: true },
    );
    return true;
  },
});
