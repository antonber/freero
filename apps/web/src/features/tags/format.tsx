import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { nanoid } from 'nanoid';
import { ArrowLeft, Check, Minus, Plus, Search, Settings2, Tag as TagIcon, Trash2 } from 'lucide-react';
import type { Tag } from '@freero/shared';
import { defineFormat, useCollection, type Editor } from '@engine';
import { Button, ColorSwatches, IconButton, Input, Popover } from '@ui';
import { TAG_COLORS, isTaggable, nextColor, normName, search, stripPatches, tagState, togglePatches, type Taggable } from './lib/tags';
import './tags.css';

function Picker({ editor, els, tags, onManage }: { editor: Editor; els: Taggable[]; tags: Tag[]; onManage(): void }) {
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The popover is invisible for its first frame (positioning), so autoFocus can't land.
  useEffect(() => {
    const raf = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);
  const list = search(tags, query);
  const name = normName(query);
  const exact = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const newColor = color ?? nextColor(tags);

  const toggle = (id: string) => editor.updateMany(togglePatches(els, id));
  const create = () => {
    if (!name || exact) return;
    const tag: Tag = { id: nanoid(10), name, color: newColor };
    editor.transact(() => {
      editor.collection<Tag>('tags').set(tag.id, tag);
      editor.updateMany(togglePatches(els, tag.id));
    });
    setQuery('');
    setColor(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter picks the exact or first match; it only creates when nothing matches.
    const pick = exact ?? (name ? list[0] : list.length === 1 ? list[0] : undefined);
    if (pick) {
      toggle(pick.id);
      setQuery('');
    } else if (name) create();
  };

  return (
    <div className="fr-tags-pop">
      <Input
        size="sm"
        ref={input}
        icon={Search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={tags.length ? 'Search or create a tag' : 'Name your first tag'}
        aria-label="Search or create a tag"
        maxLength={40}
      />
      {list.length > 0 && (
        <ul className="fr-tags-list" role="group" aria-label="Tags">
          {list.map((t) => {
            const state = tagState(els, t.id);
            return (
              <li key={t.id}>
                <button type="button" role="menuitemcheckbox" aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false} onClick={() => toggle(t.id)}>
                  <span className={`fr-tags-check is-${state}`}>
                    {state === 'all' ? <Check size={12} strokeWidth={3} /> : state === 'some' ? <Minus size={12} strokeWidth={3} /> : null}
                  </span>
                  <span className="fr-tags-chip" style={{ ['--tag' as string]: t.color }}>
                    {t.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!list.length && !name && <div className="fr-tags-empty">Tags group stickies and cards by topic, owner or priority.</div>}
      {name && !exact && (
        <div className="fr-tags-create">
          <Button size="sm" variant="secondary" icon={Plus} onClick={create}>
            Create “{name}”
          </Button>
          <ColorSwatches colors={TAG_COLORS} value={newColor} onChange={setColor} size={18} aria-label="New tag color" />
        </div>
      )}
      <div className="fr-tags-footer">
        <Button size="sm" variant="ghost" icon={Settings2} onClick={onManage} disabled={!tags.length}>
          Manage tags
        </Button>
      </div>
    </div>
  );
}

function ManageRow({ editor, tag, uses }: { editor: Editor; tag: Tag; uses: number }) {
  const [name, setName] = useState(tag.name);
  const [recolor, setRecolor] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const coll = editor.collection<Tag>('tags');
  const rename = () => {
    const n = normName(name);
    if (!n) return setName(tag.name);
    if (n !== tag.name) coll.set(tag.id, { ...tag, name: n });
  };
  const remove = () => {
    if (!confirm && uses > 0) return setConfirm(true);
    // One network update: the tag and every reference to it go together.
    editor.transact(() => {
      coll.delete(tag.id);
      editor.updateMany(stripPatches(editor.getElements(), tag.id));
    });
  };
  return (
    <li className="fr-tags-manage__row">
      <div className="fr-tags-manage__line">
        <button
          type="button"
          className="fr-tags-dot"
          style={{ background: tag.color }}
          aria-label={`Color of ${tag.name}`}
          aria-expanded={recolor}
          onClick={() => setRecolor((r) => !r)}
        />
        <Input
          size="sm"
          value={name}
          maxLength={40}
          aria-label={`Rename ${tag.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              rename();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') setName(tag.name);
          }}
        />
        {confirm ? (
          <Button size="sm" variant="danger" onClick={remove} onBlur={() => setConfirm(false)} autoFocus>
            Delete ({uses})
          </Button>
        ) : (
          <IconButton icon={Trash2} label={uses ? `Delete tag (used on ${uses})` : 'Delete tag'} size={32} onClick={remove} />
        )}
      </div>
      {recolor && (
        <ColorSwatches
          colors={TAG_COLORS}
          value={tag.color}
          allowCustom
          size={20}
          onChange={(c) => {
            coll.set(tag.id, { ...tag, color: c });
            setRecolor(false);
          }}
          aria-label={`Color of ${tag.name}`}
        />
      )}
    </li>
  );
}

function Manager({ editor, tags, onBack }: { editor: Editor; tags: Tag[]; onBack(): void }) {
  const uses = new Map<string, number>();
  for (const el of editor.getElements()) if (isTaggable(el)) for (const t of el.tags ?? []) uses.set(t, (uses.get(t) ?? 0) + 1);
  return (
    <div className="fr-tags-pop">
      <div className="fr-tags-manage__head">
        <IconButton icon={ArrowLeft} label="Back to tags" size={32} onClick={onBack} />
        <span>Manage tags</span>
      </div>
      <ul className="fr-tags-manage">
        {search(tags, '').map((t) => (
          <ManageRow key={t.id} editor={editor} tag={t} uses={uses.get(t.id) ?? 0} />
        ))}
      </ul>
    </div>
  );
}

function TagsControl({ editor, els }: { editor: Editor; els: Taggable[] }) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tags = useCollection<Tag>('tags').map(([, t]) => t);
  const known = new Set(tags.map((t) => t.id));
  const count = new Set(els.flatMap((el) => (el.tags ?? []).filter((t) => known.has(t)))).size;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-tags-btn"
        aria-label="Tags"
        title="Tags"
        aria-expanded={open}
        onClick={() => {
          setManage(false);
          setOpen((o) => !o);
        }}
      >
        <TagIcon size={16} />
        {count > 0 && <span className="fr-tags-btn__count">{count}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={300} aria-label="Tags">
        {manage ? (
          <Manager editor={editor} tags={tags} onBack={() => setManage(false)} />
        ) : (
          <Picker editor={editor} els={els} tags={tags} onManage={() => setManage(true)} />
        )}
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'tags.format',
  order: 60,
  appliesTo: (selection) => selection.length > 0 && selection.every(isTaggable),
  Component: ({ editor, selection }) => <TagsControl editor={editor} els={selection as Taggable[]} />,
});
