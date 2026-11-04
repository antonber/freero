import { customSrc, isCustom } from './custom';
import { stampOf } from './packs';
import { StampArt } from './stamps';

import { t } from '../messages';
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

/** Renders an emoji, a stamp or a team sticker so it fills its box at any size. */
export function Glyph({ value, label }: { value: string; label?: string }) {
  const stamp = stampOf(value);
  if (stamp) return <StampArt stamp={stamp} />;
  if (isCustom(value)) {
    const src = customSrc(value);
    return src ? <img className="fr-emoji__img" src={src} alt={label ?? t('sticker')} draggable={false} /> : null;
  }
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={value}>
      <text x="50" y="54" textAnchor="middle" dominantBaseline="central" fontSize="84" fontFamily={EMOJI_FONT}>
        {value}
      </text>
    </svg>
  );
}
