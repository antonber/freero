import { useMemo, useState } from 'react';
import { Search, Stamp } from 'lucide-react';
import { defineTool, useToolGhost, useCamera, useToolOptions, type Editor } from '@engine';
import { DEFAULT_CHOICE, MAX_RECENT, PLACE_SIZE, TOOL_ID, type EmojiToolOptions } from './lib/constants';
import { EmojiPicker, Input, SegmentedControl, searchEmojis } from '@ui';
import { Glyph } from './lib/Glyph';
import { PACKS } from './lib/packs';
import { STAMP_PREFIX, StampArt, type StampDef } from './lib/stamps';
import { isCustom } from './lib/custom';
import { stampTargetAt } from './lib/reactions';
import { TeamStickers, useTeamStickers } from './lib/TeamStickers';

/** World size that shows as PLACE_SIZE px on screen right now. */
function placeSize(zoom: number): number {
  return Math.round(Math.max(16, Math.min(1024, PLACE_SIZE / zoom)));
}

function choose(editor: Editor, value: string, name?: string) {
  const recent = editor.getToolOptions<EmojiToolOptions>(TOOL_ID).recent ?? [];
  editor.setToolOptions(TOOL_ID, {
    current: value,
    currentName: name,
    recent: isCustom(value) ? recent : [value, ...recent.filter((r) => r !== value)].slice(0, MAX_RECENT),
  });
}

function Item({ value, label, active, onPick }: { value: string; label: string; active: boolean; onPick(): void }) {
  const stamp = value.startsWith(STAMP_PREFIX);
  return (
    <button type="button" className="fr-emoji-picker__item" aria-pressed={active} aria-label={label} title={label} onClick={onPick}>
      {stamp ? <Glyph value={value} /> : value}
    </button>
  );
}

/** A stamp or pack sticker matches when every word typed starts one of its words. */
const matches = (s: StampDef, q: string) => q.split(/\s+/).every((t) => `${s.label.toLowerCase()} ${s.words}`.split(' ').some((w) => w.startsWith(t)));

function StickerGrid({ stickers, current, onPick }: { stickers: StampDef[]; current: string; onPick(value: string): void }) {
  return (
    <div className="fr-emoji-picker__stamps">
      {stickers.map((s) => (
        <button
          key={s.id}
          type="button"
          className="fr-emoji-picker__item"
          aria-pressed={current === `${STAMP_PREFIX}${s.id}`}
          aria-label={s.label}
          title={s.label}
          onClick={() => onPick(`${STAMP_PREFIX}${s.id}`)}
        >
          <StampArt stamp={s} />
        </button>
      ))}
    </div>
  );
}

function Picker({ editor }: { editor: Editor }) {
  const { current = DEFAULT_CHOICE, recent = [] } = useToolOptions<EmojiToolOptions>(TOOL_ID);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'stickers' | 'emoji'>('stickers');
  const team = useTeamStickers(editor);
  const q = query.trim().toLowerCase();
  const packHits = useMemo(() => PACKS.map((p) => ({ ...p, stickers: q ? p.stickers.filter((s) => matches(s, q)) : p.stickers })).filter((p) => p.stickers.length), [q]);
  const emojiHits = useMemo(() => (q ? searchEmojis(q) : null), [q]);
  const teamHits = useMemo(() => (q ? (team.data?.sets ?? []).flatMap((s) => s.stickers).filter((s) => s.name.toLowerCase().includes(q)) : []), [q, team.data]);
  const pick = (v: string, name?: string) => choose(editor, v, name);
  const recentEmojis = recent.filter((r) => !r.startsWith(STAMP_PREFIX) && !isCustom(r));
  const firstSticker = packHits[0]?.stickers[0];

  return (
    <div className="fr-emoji-picker">
      <SegmentedControl
        size="sm"
        aria-label="Stickers or emoji"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'stickers', label: 'Stickers' },
          { value: 'emoji', label: 'Emoji' },
        ]}
      />
      {mode === 'emoji' ? (
        // The shared emoji catalogue and picker (@ui).
        <EmojiPicker onPick={(e) => pick(e)} recent={recentEmojis} />
      ) : (
        <>
          <Input
            size="sm"
            icon={Search}
            placeholder="Search stickers and emoji"
            aria-label="Search stickers and emoji"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (firstSticker) pick(`${STAMP_PREFIX}${firstSticker.id}`);
                else if (teamHits[0]) pick(`img:${teamHits[0].url}`, teamHits[0].name);
                else if (emojiHits?.[0]) pick(emojiHits[0].emoji);
              }
            }}
          />
          <div className="fr-emoji-picker__scroll" data-fr-scrollable="">
            {packHits.map((p) => (
              <section key={p.id} aria-label={p.label}>
                <div className="fr-emoji-picker__section">{p.label}</div>
                <StickerGrid stickers={p.stickers} current={current} onPick={pick} />
              </section>
            ))}
            {q ? (
              <>
                {teamHits.length > 0 && (
                  <section aria-label="Team stickers">
                    <div className="fr-emoji-picker__section">Team stickers</div>
                    <TeamStickers.Grid stickers={teamHits} current={current} onPick={pick} />
                  </section>
                )}
                {emojiHits && emojiHits.length > 0 && (
                  <section aria-label="Emoji">
                    <div className="fr-emoji-picker__section">Emoji</div>
                    <div className="fr-emoji-picker__grid">
                      {emojiHits.map((it) => (
                        <Item key={it.emoji} value={it.emoji} label={it.words.split(' ')[0]} active={current === it.emoji} onPick={() => pick(it.emoji)} />
                      ))}
                    </div>
                  </section>
                )}
                {!packHits.length && !teamHits.length && !emojiHits?.length && <div className="fr-emoji-picker__empty">Nothing matches “{query.trim()}”</div>}
              </>
            ) : (
              <TeamStickers editor={editor} team={team} current={current} onPick={pick} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Ghost() {
  const { zoom } = useCamera();
  const { current = DEFAULT_CHOICE, currentName } = useToolOptions<EmojiToolOptions>(TOOL_ID);
  const s = placeSize(zoom);
  const p = useToolGhost({ w: s, h: s });
  if (!p) return null;
  return (
    <div className="fr-emoji-ghost" style={{ width: s, height: s, transform: `translate(${p.x}px, ${p.y}px)` }}>
      <Glyph value={current} label={currentName} />
    </div>
  );
}

export default defineTool({
  id: TOOL_ID,
  label: 'Stickers & emoji',
  icon: Stamp,
  order: 60,
  placement: 'more',
  cursor: 'crosshair',

  // Stamping: each click places the current choice centered on the pointer; the tool stays
  // active so several stamps can be dropped in a row (Esc / V returns to select).
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const { current = DEFAULT_CHOICE, currentName } = editor.getToolOptions<EmojiToolOptions>(TOOL_ID);
    const s = placeSize(editor.getCamera().zoom);
    // Dropped on an item, the stamp rides on it (moves, duplicates and is deleted with it).
    const on = stampTargetAt(editor, point);
    editor.create<'emoji'>({
      type: 'emoji',
      emoji: current,
      ...(isCustom(current) && currentName ? { name: currentName } : {}),
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
