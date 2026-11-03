// Running a live activity from the format toolbar (owners and editors): set it up, reveal sealed
// results, close / reopen answers, the link (and QR code) people answer through, show it full
// screen, start over.
import { Eye, EyeOff, Maximize2, MessageSquare, MessageSquareOff, QrCode, RotateCcw, Settings2 } from 'lucide-react';
import type { ActivityElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { IconButton } from '@ui';
import { LINK_DIALOG, SETTINGS_DIALOG, STAGE_DIALOG } from './lib/activity';

async function run(editor: Editor, fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    if (done) editor.host.notify(done, 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : 'Something went wrong', 'error');
  }
}

function Controls({ editor, a }: { editor: Editor; a: ActivityElement }) {
  const engage = editor.host.engage;
  return (
    <>
      <IconButton icon={Settings2} label="Set up activity" onClick={() => editor.openPanel(SETTINGS_DIALOG, { id: a.id })} />
      {engage && a.results === 'reveal' ? (
        <>
          <IconButton icon={Eye} label="Reveal results to everyone" onClick={() => void run(editor, () => engage.reveal(a.id, true), 'Results revealed')} />
          <IconButton icon={EyeOff} label="Hide results again" onClick={() => void run(editor, () => engage.reveal(a.id, false))} />
        </>
      ) : null}
      <IconButton
        icon={a.closed ? MessageSquare : MessageSquareOff}
        label={a.closed ? 'Reopen answers' : 'Close answers'}
        onClick={() => editor.update<ActivityElement>(a.id, { closed: !a.closed })}
      />
      <IconButton icon={QrCode} label="Answer link and QR code (phones)" onClick={() => editor.openPanel(LINK_DIALOG, { id: a.id })} />
      <IconButton icon={Maximize2} label="Show full screen" onClick={() => editor.openPanel(STAGE_DIALOG, { id: a.id })} />
      {engage ? (
        <IconButton
          icon={RotateCcw}
          label="Start over (delete every answer)"
          onClick={() => {
            if (window.confirm('Delete every answer to this activity? This can’t be undone.')) void run(editor, () => engage.clear(a.id), 'Answers cleared');
          }}
        />
      ) : null}
    </>
  );
}

export default defineFormat({
  id: 'engage.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'activity',
  Component: ({ editor, selection }) => <Controls editor={editor} a={selection[0] as ActivityElement} />,
});
