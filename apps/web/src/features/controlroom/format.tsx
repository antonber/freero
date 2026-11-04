import { Pause, Play } from 'lucide-react';
import { AGENT_PAUSES_COLLECTION, laneAgentOf, type AgentPauseRecord, type KanbanElement } from '@freero/shared';
import { defineFormat, richTextToPlain, useCanEdit, useCollection, type Editor } from '@engine';
import { ToolbarButton } from '@ui';
import { t } from './messages';
import './controlroom.css';

/** The agent a selected kanban is the lane of ("Tasks · Builder"), or null. */
export const agentOfLane = (k: KanbanElement): string | null => laneAgentOf(richTextToPlain(k.title ?? ''));

function setPaused(editor: Editor, kanbanId: string, paused: boolean): void {
  const pauses = editor.collection<AgentPauseRecord>(AGENT_PAUSES_COLLECTION);
  if (paused) pauses.set(kanbanId, { by: editor.user.id, byName: editor.user.name, at: editor.host.serverNow() });
  else pauses.delete(kanbanId);
}

function PauseControl({ editor, lane }: { editor: Editor; lane: KanbanElement }) {
  const pauses = useCollection<AgentPauseRecord>(AGENT_PAUSES_COLLECTION);
  const canEdit = useCanEdit();
  const agent = agentOfLane(lane);
  if (!agent || !canEdit) return null;
  const paused = pauses.some(([id]) => id === lane.id);
  return (
    <ToolbarButton
      wide
      className="fr-controlroom-fmt-btn"
      label={paused ? t('letAgentChangeThisBoard', { agent }) : t('stopAgentChangingThisBoard', { agent })}
      aria-pressed={paused}
      onClick={() => {
        setPaused(editor, lane.id, !paused);
        editor.host.notify(paused ? t('agentCanWorkOnThis', { agent }) : t('agentIsPausedItsNext', { agent }), 'info');
      }}
    >
      {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
      {paused ? t('resumeAgent') : t('pauseAgent')}
    </ToolbarButton>
  );
}

/** One agent lane selected: pause or resume its agent. */
export default defineFormat({
  id: 'controlroom.format',
  order: 55,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'kanban' && agentOfLane(selection[0] as KanbanElement) !== null,
  Component: ({ editor, selection }) => <PauseControl editor={editor} lane={selection[0] as KanbanElement} />,
});
