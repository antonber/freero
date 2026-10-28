import { useMemo, useState } from 'react';
import { Search, Stamp } from 'lucide-react';
import { defineTool, useToolGhost, useCamera, useToolOptions, type Editor } from '@engine';
import { Input } from '@ui';
import { DEFAULT_CHOICE, MAX_RECENT, PLACE_SIZE, TOOL_ID, type EmojiToolOptions } from './lib/constants';
import { EMOJI_CATEGORIES, searchEmojis } from './lib/emojis';
import { Glyph } from './lib/Glyph';
import { STAMP_PREFIX, STAMPS, StampArt } from './lib/stamps';
import { stampTargetAt } from './lib/reactions';

/** World size that shows as PLACE_SIZE px on screen right now. */
function placeSize(zoom: number): number {
  return Math.round(Math.max(16, Math.min(1024, PLACE_SIZE / zoom)));
}

function choose(editor: Editor, value: string) {
  const recent = editor.getToolOptions<EmojiToolOptions>(TOOL_ID).recent ?? [];
  editor.setToolOptions(TOOL_ID, { current: value, recent: [value, ...recent.filter((r) => r !== value)].slice(0, MAX_RECENT) });
}

function Item({ value, label, active, onPick }: { value: string; label: string; active: boolean; onPick(): void }) {
  const stamp = value.startsWith(STAMP_PREFIX);
  return (
    <button type="button" className="fr-emoji-picker__item" aria-pressed={active} aria-label={label} title={label} onClick={onPick}>
      {stamp ? <Glyph value={value} /> : value}
    </button>
  );
}

function Picker({ editor }: { editor: Editor }) {
  const { current = DEFAULT_CHOICE, recent = [] } = useToolOptions<EmojiToolOptions>(TOOL_ID);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(EMOJI_CATEGORIES[0].id);
  const q = query.trim().toLowerCase();
  const stampHits = useMemo(
    () => (q ? STAMPS.filter((s) => q.split(/\s+/).every((t) => `${s.label.toLowerCase()} ${s.words}`.split(' ').some((w) => w.startsWith(t)))) : STAMPS),
    [q],
  );
  const emojiHits = useMemo(() => (q ? searchEmojis(q) : null), [q]);
  const category = EMOJI_CATEGORIES.find((c) => c.id === tab) ?? EMOJI_CATEGORIES[0];
  const pick = (v: string) => choose(editor, v);
  const recentEmojis = recent.filter((r) => !r.startsWith(STAMP_PREFIX));

  return (
    <div className="fr-emoji-picker">
      <Input
        size="sm"
        icon={Search}
        placeholder="Search emoji and stamps"
        aria-label="Search emoji and stamps"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const first = stampHits[0] ? `${STAMP_PREFIX}${stampHits[0].id}` : emojiHits?.[0]?.emoji;
            if (first) pick(first);
          }
        }}
      />
      {stampHits.length > 0 && (
        <>
          <div className="fr-emoji-picker__section">Stamps</div>
          <div className="fr-emoji-picker__stamps">
            {stampHits.map((s) => (
              <button
                key={s.id}
                type="button"
                className="fr-emoji-picker__item"
                aria-pressed={current === `${STAMP_PREFIX}${s.id}`}
                aria-label={s.label}
                title={s.label}
                onClick={() => pick(`${STAMP_PREFIX}${s.id}`)}
              >
                <StampArt stamp={s} />
              </button>
            ))}
          </div>
        </>
      )}
      {emojiHits ? (
        <>
          <div className="fr-emoji-picker__section">Emoji</div>
          {emojiHits.length ? (
            <div className="fr-emoji-picker__grid" data-fr-scrollable="">
              {emojiHits.map((it) => (
                <Item key={it.emoji} value={it.emoji} label={it.words.split(' ')[0]} active={current === it.emoji} onPick={() => pick(it.emoji)} />
              ))}
            </div>
          ) : (
            stampHits.length === 0 && <div className="fr-emoji-picker__empty">Nothing matches “{query.trim()}”</div>
          )}
        </>
      ) : (
        <>
          {recentEmojis.length > 0 && (
            <>
              <div className="fr-emoji-picker__section">Recent</div>
              <div className="fr-emoji-picker__grid">
                {recentEmojis.map((r) => (
                  <Item key={r} value={r} label={r} active={current === r} onPick={() => pick(r)} />
                ))}
              </div>
            </>
          )}
          <div className="fr-emoji-picker__tabs" role="tablist" aria-label="Emoji categories">
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                className="fr-emoji-picker__tab"
                aria-selected={c.id === category.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => setTab(c.id)}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <div className="fr-emoji-picker__grid" role="tabpanel" aria-label={category.label} data-fr-scrollable="">
            {category.items.map((it) => (
              <Item key={it.emoji} value={it.emoji} label={it.words.split(' ')[0]} active={current === it.emoji} onPick={() => pick(it.emoji)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Ghost() {
  const { zoom } = useCamera();
  const { current = DEFAULT_CHOICE } = useToolOptions<EmojiToolOptions>(TOOL_ID);
  const s = placeSize(zoom);
  const p = useToolGhost({ w: s, h: s });
  if (!p) return null;
  return (
    <div className="fr-emoji-ghost" style={{ width: s, height: s, transform: `translate(${p.x}px, ${p.y}px)` }}>
      <Glyph value={current} />
    </div>
  );
}

export default defineTool({
  id: TOOL_ID,
  label: 'Emoji & stamps',
  icon: Stamp,
  order: 60,
  placement: 'more',
  cursor: 'crosshair',

  // Stamping: each click places the current choice centered on the pointer; the tool stays
  // active so several stamps can be dropped in a row (Esc / V returns to select).
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const { current = DEFAULT_CHOICE } = editor.getToolOptions<EmojiToolOptions>(TOOL_ID);
    const s = placeSize(editor.getCamera().zoom);
    // Dropped on an item, the stamp rides on it (moves, duplicates and is deleted with it).
    const on = stampTargetAt(editor, point);
    editor.create<'emoji'>({
      type: 'emoji',
      emoji: current,
      x: Math.round(point.x - s / 2),
      y: Math.round(point.y - s / 2),
      w: s,
      h: s,
      attachedTo: on?.id ?? null,
    });
  },

  Options: Picker,
  Preview: Ghost,
});
