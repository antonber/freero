// A searchable emoji grid by category (the curated set in emojis.ts): pick one, `onPick` gets it.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from './fields';
import { EMOJI_CATEGORIES, searchEmojis, type EmojiEntry } from './emojis';
import { t } from './messages';
import './EmojiPicker.css';

export interface EmojiPickerProps {
  onPick(emoji: string): void;
  /** Shown first, above the categories (e.g. recently used). */
  recent?: string[];
  autoFocus?: boolean;
}

function Grid({ items, onPick, label }: { items: EmojiEntry[]; onPick(e: string): void; label: string }) {
  return (
    <div className="fr-emojipick__grid" role="group" aria-label={label} data-fr-scrollable="">
      {items.map((it) => (
        <button key={it.emoji} type="button" className="fr-emojipick__item" aria-label={it.words.split(' ')[0]} title={it.words.split(' ')[0]} onClick={() => onPick(it.emoji)}>
          {it.emoji}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ onPick, recent = [], autoFocus }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(EMOJI_CATEGORIES[0].id);
  const hits = useMemo(() => (query.trim() ? searchEmojis(query) : null), [query]);
  const category = EMOJI_CATEGORIES.find((c) => c.id === tab) ?? EMOJI_CATEGORIES[0];
  return (
    <div className="fr-emojipick">
      <Input
        size="sm"
        icon={Search}
        placeholder={t('searchEmoji')}
        aria-label={t('searchEmoji')}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits?.[0]) onPick(hits[0].emoji);
        }}
      />
      {hits ? (
        hits.length ? (
          <Grid items={hits} onPick={onPick} label={t('searchResults')} />
        ) : (
          <div className="fr-emojipick__empty">{t('nothingMatchesQuery', { query: query.trim() })}</div>
        )
      ) : (
        <>
          {recent.length > 0 && <Grid items={recent.map((emoji) => ({ emoji, words: emoji }))} onPick={onPick} label={t('recent')} />}
          <div className="fr-emojipick__tabs" role="tablist" aria-label={t('emojiCategories')}>
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                className="fr-emojipick__tab"
                aria-selected={c.id === category.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => setTab(c.id)}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <Grid items={category.items} onPick={onPick} label={category.label} />
        </>
      )}
    </div>
  );
}
