import { StampArt, stampOf } from './stamps';

const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

/** Renders an emoji or a stamp so it fills its box at any size (vector, scales crisply). */
export function Glyph({ value }: { value: string }) {
  const stamp = stampOf(value);
  if (stamp) return <StampArt stamp={stamp} />;
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={value}>
      <text x="50" y="54" textAnchor="middle" dominantBaseline="central" fontSize="84" fontFamily={EMOJI_FONT}>
        {value}
      </text>
    </svg>
  );
}
