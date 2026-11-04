// The diagram's layers panel (#118, dock) and the focus bar (#117, while focusing on a diagram).
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { diagramLayers, memberLayerId, type DiagramElement, type DiagramLayer } from '@freero/shared';
import { DockHeader, definePanel, richTextToPlain, useCanEdit, useElement, useElements, useFocus, usePersonalView, useSelection, type Editor, type PanelProps } from '@engine';
import { Button, IconButton } from '@ui';
import { activeLayer, addLayer, diagramOfSelection, moveLayer, moveToLayer, patchLayer, removeLayer, selectedMembers, setActiveLayer } from './lib/actions';
import { FOCUS_BAR, LAYERS_PANEL } from './lib/ids';

import { t } from './messages';
/** The diagram the panel is about: the focused one, else the one the selection is in. */
function useDiagram(editor: Editor): DiagramElement | null {
  const focus = useFocus();
  const selection = useSelection();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const d = focus ? editor.getElement(focus) : diagramOfSelection(editor);
    if (d?.type === 'diagram') setId(d.id);
  }, [editor, focus, selection]);
  const d = useElement<DiagramElement>(id);
  return d?.type === 'diagram' ? d : null;
}

function LayerRow({ editor, d, layer, index, count, active, members, canEdit }: { editor: Editor; d: DiagramElement; layer: DiagramLayer; index: number; count: number; active: boolean; members: number; canEdit: boolean }) {
  const [name, setName] = useState(layer.name);
  useEffect(() => setName(layer.name), [layer.name]);
  const commit = () => {
    const next = name.trim().slice(0, 80);
    if (next && next !== layer.name) patchLayer(editor, d, layer.id, { name: next });
    else setName(layer.name);
  };
  return (
    <div className={`fr-diagram-layers__row${active ? ' is-active' : ''}${layer.hidden ? ' is-hidden' : ''}`}>
      <input
        type="radio"
        className="fr-diagram-layers__pick"
        name={`fr-diagram-layer-${d.id}`}
        checked={active}
        aria-label={t('addNewItemsToName', { name: layer.name })}
        title={t('newItemsGoToThis')}
        onChange={() => setActiveLayer(editor, d, layer.id)}
      />
      <input
        className="fr-diagram-layers__name"
        value={name}
        disabled={!canEdit}
        aria-label={t('layerName')}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setName(layer.name);
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />
      <span className="fr-diagram-layers__count" title={t('membersItems', { members })}>
        {members}
      </span>
      <IconButton
        icon={layer.hidden ? EyeOff : Eye}
        label={layer.hidden ? t('showThisLayerForEveryone') : t('hideThisLayerForEveryone')}
        size={32}
        active={!!layer.hidden}
        disabled={!canEdit}
        onClick={() => patchLayer(editor, d, layer.id, { hidden: layer.hidden ? null : true })}
      />
      <IconButton
        icon={layer.locked ? Lock : LockOpen}
        label={layer.locked ? t('unlockThisLayer') : t('lockThisLayerItsItems')}
        size={32}
        active={!!layer.locked}
        disabled={!canEdit}
        onClick={() => patchLayer(editor, d, layer.id, { locked: layer.locked ? null : true })}
      />
      <IconButton icon={ArrowUp} label={t('moveUpDrawnAbove')} size={32} disabled={!canEdit || index === count - 1} onClick={() => moveLayer(editor, d, layer.id, 1)} />
      <IconButton icon={ArrowDown} label={t('moveDownDrawnBelow')} size={32} disabled={!canEdit || index === 0} onClick={() => moveLayer(editor, d, layer.id, -1)} />
      <IconButton icon={Trash2} label={t('deleteLayerItsItemsMove')} size={32} disabled={!canEdit || count < 2} onClick={() => removeLayer(editor, d, layer.id)} />
    </div>
  );
}

function LayersPanel({ editor }: PanelProps) {
  const d = useDiagram(editor);
  const canEdit = useCanEdit();
  const all = useElements();
  usePersonalView(d?.id, '_layer');
  useSelection();
  if (!d) {
    return (
      <div className="fr-diagram-layers">
        <DockHeader className="fr-diagram-layers__dockhead">
          <h2 className="fr-diagram-layers__title">{t('diagramLayers2')}</h2>
        </DockHeader>
        <p className="fr-diagram-layers__hint">{t('selectADiagramOrSomething2')}</p>
      </div>
    );
  }
  const layers = diagramLayers(d);
  const counts = new Map<string, number>();
  for (const el of all) if (el.frameId === d.id) counts.set(memberLayerId(d, el), (counts.get(memberLayerId(d, el)) ?? 0) + 1);
  const mine = activeLayer(editor, d);
  const picked = selectedMembers(editor, d);
  const editable = canEdit && !d.locked;
  return (
    <div className="fr-diagram-layers">
      <DockHeader className="fr-diagram-layers__dockhead">
        <h2 className="fr-diagram-layers__title">{t('layers2')}{' '}{richTextToPlain(d.title) || t('diagram')}</h2>
      </DockHeader>
      <p className="fr-diagram-layers__hint">Top of the list is drawn on top. Hiding or locking a layer does it for everyone; the layer you pick is where your new items go.</p>
      {[...layers].reverse().map((layer) => {
        const index = layers.indexOf(layer);
        return <LayerRow key={layer.id} editor={editor} d={d} layer={layer} index={index} count={layers.length} active={layer.id === mine} members={counts.get(layer.id) ?? 0} canEdit={editable} />;
      })}
      {editable && (
        <div className="fr-diagram-layers__actions">
          <Button size="sm" icon={Plus} onClick={() => addLayer(editor, d)}>{t('addLayer')}</Button>
          <Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => moveToLayer(editor, d, picked.map((el) => el.id), mine)}>{t('moveSelectionTo')}{' '}{layers.find((l) => l.id === mine)?.name ?? 'layer'}
          </Button>
        </div>
      )}
    </div>
  );
}

function FocusBar({ editor }: PanelProps) {
  const focus = useFocus();
  const d = useElement<DiagramElement>(focus);
  if (!d || d.type !== 'diagram') return null;
  return (
    <div className="fr-diagram-focusbar" role="status">
      <span>{t('focusingOn')}{' '}<strong>{richTextToPlain(d.title) || t('diagram')}</strong>
      </span>
      <span className="fr-diagram-focusbar__hint">{t('escToLeave')}</span>
      <Button size="sm" variant="ghost" onClick={() => editor.openDock(LAYERS_PANEL)}>{t('layers')}</Button>
      <Button size="sm" variant="primary" onClick={() => editor.setFocus(null)}>{t('exitFocus')}</Button>
    </div>
  );
}

export default [
  definePanel({ id: LAYERS_PANEL, slot: 'dock-right', order: 64, minRole: 'viewer', Component: LayersPanel }),
  definePanel({ id: FOCUS_BAR, slot: 'top-center', order: 30, minRole: 'viewer', Component: FocusBar }),
];
