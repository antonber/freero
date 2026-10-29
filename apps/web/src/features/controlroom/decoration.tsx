import { memo } from 'react';
import { Pause } from 'lucide-react';
import { AGENT_PAUSES_COLLECTION, type AgentPauseRecord, type BoardElement, type KanbanElement } from '@freero/shared';
import { defineDecoration, useCollection } from '@engine';
import { agentOfLane } from './format';
import './controlroom.css';

/** Below this zoom the tag is an unreadable speck. */
const MIN_ZOOM = 0.3;

/** "Paused by Maria" on a paused agent lane's top edge, for everyone who sees the board. */
const PausedTag = memo(function PausedTag({ element, zoom }: { element: BoardElement; zoom: number }) {
  const pauses = useCollection<AgentPauseRecord>(AGENT_PAUSES_COLLECTION);
  const hit = pauses.find(([id]) => id === element.id);
  if (!hit || zoom < MIN_ZOOM) return null;
  const by = typeof hit[1]?.byName === 'string' && hit[1].byName ? hit[1].byName : null;
  return (
    <div className="fr-controlroom-tag-wrap">
      <span className="fr-controlroom-tag" role="status" data-fr-keep-clear="">
        <Pause size={11} aria-hidden />
        {by ? `Agent paused by ${by}` : 'Agent paused'}
      </span>
    </div>
  );
});

export default defineDecoration({
  id: 'controlroom.pausedTag',
  order: 30,
  appliesTo: (el) => el.type === 'kanban' && agentOfLane(el as KanbanElement) !== null,
  Component: PausedTag,
});
