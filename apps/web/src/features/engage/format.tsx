// Running a live activity from the format toolbar (owners and editors): set it up, reveal sealed
// results, close / reopen answers, copy the link people answer through, start over.
import { Eye, EyeOff, MessageSquare, MessageSquareOff, RotateCcw, Settings2, Smartphone } from 'lucide-react';
import type { ActivityElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { IconButton } from '@ui';
import { SETTINGS_DIALOG, answerLink } from './lib/activity';

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
      <IconButton
        icon={Smartphone}
        label="Copy the answer link (for phones)"
        onClick={() =>
          void run(
            editor,
            () => navigator.clipboard.writeText(answerLink(a.id)),
            'Answer link copied — anyone who can open the board answers there',
          )
        }
      />
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
