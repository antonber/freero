// A linked view on the canvas (step 3c): a kanban elsewhere on the board drawn as a table, list,
// calendar or timeline in a box of its own — the same bodies a kanban's own tabs draw
// (ProjectionTab.tsx), from the same live cards, so edits made here are edits of the real cards
// (card.setValues: live for everyone, one undo step each). Its title band names the view and the
// kanban it shows (a click there takes you to it). The view holds only the kanban's id and its own
// settings, so when the kanban isn't on the board for this person it shows a state of its own and
// nothing else: removed (owners and editors, who see every hidden frame: the kanban was deleted,
// and undo brings it back), or not visible (anyone else: it was deleted, or sits somewhere they
// can't see — the two are told apart for nobody, as smart links do).
import { memo, useMemo } from 'react';
import { EyeOff, Lock, Maximize2, Trash2, Unlink } from 'lucide-react';
import { LINKED_VIEW_HEAD_H, LINKED_VIEW_KEY, linkedView, withProjectionOverride, type KanbanViewElement } from '@freero/shared';
import { richTextToPlain, useCanEdit, useEditor, useIsExporting, usePhoneLayout, useWorldViewport, type Editor, type ElementRenderProps, type Rect } from '@engine';
import { FOCUS_PANEL } from './constants';
import { useKanban, useMine } from './hooks';
import { linkedCardsEditable } from './linked';
import { ProjectionBody, clipOf } from './ProjectionTab';
import { LAYOUT_ICONS } from './TabStrip';

import { t } from '../messages';
/** Below this zoom text is unreadable: draw only the view's name. */
const LOD_ZOOM = 0.15;
const PAD = 6;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export const LinkedViewElement = memo(function LinkedViewElement({ element: lv, selected, zoom }: ElementRenderProps<KanbanViewElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const exporting = useIsExporting();
  const phone = usePhoneLayout();
  const vp = useWorldViewport();
  return <LinkedViewBody editor={editor} lv={lv} selected={selected && !exporting} canEdit={canEdit} viewport={vp} lod={zoom < LOD_ZOOM} phone={!!phone} />;
});

export interface LinkedViewBodyProps {
  editor: Editor;
  lv: KanbanViewElement;
  /** Selected (and not being exported): its body takes pointer, wheel and keys. */
  selected: boolean;
  /** This person may change the board (owner, editor). */
  canEdit: boolean;
  /** The part of the world on screen (useWorldViewport): rows outside it aren't drawn. */
  viewport: Rect;
  lod?: boolean;
  phone?: boolean;
}

/** The linked view's drawing, from what it is handed (the canvas, and tests, hand it the same). */
export function LinkedViewBody({ editor, lv, selected, canEdit, viewport, lod, phone }: LinkedViewBodyProps) {
  const k = useKanban(editor, lv.sourceId);
  const mine = useMine(editor, lv.id, LINKED_VIEW_KEY);
  const saved = linkedView(lv);
  const view = useMemo(() => withProjectionOverride(saved, mine), [saved, mine]);
  const Icon = LAYOUT_ICONS[view.layout];
  const title = k ? richTextToPlain(k.title).trim() || 'Kanban' : '';
  const editable = !!k && linkedCardsEditable(canEdit, k, lv);
  const top = LINKED_VIEW_HEAD_H;
  const box = { top, left: PAD, right: PAD, height: Math.max(0, lv.h - top - PAD) };
  return (
    <div className={`fr-kanban fr-kanban-linked${k ? '' : ' is-missing'}`} data-linked-view={lv.id}>
      <div className="fr-kanban-linked__head" style={{ height: top }}>
        <Icon size={15} aria-hidden />
        <span className="fr-kanban-linked__name">{view.name}</span>
        {k && !lod && (
          <button
            type="button"
            className="fr-kanban-linked__source"
            data-fr-interactive=""
            title={t('linkedToTheKanbanTitle', { title })}
            onPointerDown={stop}
            onClick={() => {
              editor.select([k.id]);
              editor.zoomToFit([k.id], { animate: true, padding: 48 });
            }}
          >{t('of')}{' '}<strong>{title}</strong>
          </button>
        )}
        {k && !lod && editable === false && canEdit && (
          <span className="fr-kanban-linked__chip" title={k.locked ? t('theKanbanIsLockedIts') : t('thisViewIsLockedIts')}>
            <Lock size={12} aria-hidden />{t('readOnly')}</span>
        )}
        <span className="fr-kanban-linked__spacer" />
        {k && !lod && (selected || phone) && (
          <button
            type="button"
            className="fr-kanban__focus"
            data-fr-interactive=""
            title={t('openTheKanbanInFocus')}
            aria-label={t('openInFocusMode')}
            onPointerDown={stop}
            onClick={() => editor.openPanel(FOCUS_PANEL, { id: k.id })}
          >
            <Maximize2 size={14} aria-hidden />
          </button>
        )}
      </div>
      {lod ? (
        <div className="fr-kanban__table-lod" style={{ top }} aria-hidden>
          {view.name}
        </div>
      ) : !k ? (
        <Missing editor={editor} lv={lv} canEdit={canEdit} selected={selected} />
      ) : (
        <ProjectionBody editor={editor} k={k} view={view} name={view.name} of={title} noun="view" canEdit={editable} interactive={selected} box={box} clip={clipOf(viewport, lv.y + top)} />
      )}
    </div>
  );
}

/** The kanban isn't on the board for me: removed (owners and editors see everything there is), else not visible. */
function Missing({ editor, lv, canEdit, selected }: { editor: Editor; lv: KanbanViewElement; canEdit: boolean; selected: boolean }) {
  return (
    <div className="fr-kanban-linked__missing" role="status" style={{ top: LINKED_VIEW_HEAD_H }}>
      {canEdit ? (
        <>
          <Unlink size={28} strokeWidth={1.5} aria-hidden />
          <strong>{t('theKanbanThisViewShowed')}</strong>
          <span>{t('undoBringsItBackAnd')}</span>
          {selected && !lv.locked && (
            <button type="button" className="fr-kanban-linked__remove" data-fr-interactive="" onPointerDown={stop} onClick={() => editor.remove([lv.id])}>
              <Trash2 size={14} aria-hidden />{t('deleteThisView')}</button>
          )}
        </>
      ) : (
        <>
          <EyeOff size={28} strokeWidth={1.5} aria-hidden />
          <strong>{t('notVisibleToYou')}</strong>
          <span>{t('theKanbanThisViewShows')}</span>
        </>
      )}
    </div>
  );
}
