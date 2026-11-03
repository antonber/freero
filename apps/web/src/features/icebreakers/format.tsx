// Setting up an icebreaker (#150): its title, the names (one per line, or the people on the board),
// how many dice. Spinning itself is on the widget, for whoever runs the session.
import { useRef, useState } from 'react';
import { ListPlus, Users } from 'lucide-react';
import { ICEBREAKER_MAX_ENTRIES, type IcebreakerElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { Button, Input, Popover, SegmentedControl, TextArea, ToolbarButton } from '@ui';

/** Everyone with access, and whoever is here now (guests too), by name, once each. */
async function peopleNames(editor: Editor): Promise<string[]> {
  const here = editor.getPeers().map((p) => p.user?.name ?? '');
  const members = await editor.host.listMembers().then(
    (m) => m.map((u) => u.name),
    () => [] as string[],
  );
  const seen = new Set<string>();
  return [editor.user.name, ...members, ...here]
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, ICEBREAKER_MAX_ENTRIES);
}

function EntriesControl({ editor, el }: { editor: Editor; el: IcebreakerElement }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<IcebreakerElement>) => editor.update<IcebreakerElement>(el.id, patch);
  return (
    <>
      <ToolbarButton ref={ref} label={el.kind === 'wheel' ? 'Names on the wheel' : 'People to put in order'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ListPlus size={16} />
        Names
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Names">
        <div className="fr-icebreaker-names">
          <Input aria-label="Title" value={el.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          <TextArea
            aria-label="Names, one per line"
            rows={8}
            value={el.entries.join('\n')}
            onChange={(e) => set({ entries: e.target.value.split('\n').slice(0, ICEBREAKER_MAX_ENTRIES) })}
          />
          <Button size="sm" variant="ghost" icon={Users} onClick={() => void peopleNames(editor).then((entries) => set({ entries }))}>
            Use the people on the board
          </Button>
        </div>
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'icebreakers.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'icebreaker',
  Component: ({ editor, selection }) => {
    const el = selection[0] as IcebreakerElement;
    if (el.kind === 'dice')
      return (
        <SegmentedControl<'1' | '2' | '3'>
          aria-label="How many dice"
          size="sm"
          options={[
            { value: '1', label: '1 die' },
            { value: '2', label: '2 dice' },
            { value: '3', label: '3 dice' },
          ]}
          value={String(Math.min(3, Math.max(1, el.dice ?? 1))) as '1' | '2' | '3'}
          onChange={(v) => editor.update<IcebreakerElement>(el.id, { dice: Number(v) })}
        />
      );
    return <EntriesControl editor={editor} el={el} />;
  },
});
