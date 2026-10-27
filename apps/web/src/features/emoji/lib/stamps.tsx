// Freero's own stamps: simple vector badges drawn on a 100 × 100 grid.
import type { ReactNode } from 'react';

export interface StampDef {
  id: string; // stored as `stamp:<id>`
  label: string;
  words: string;
  art: ReactNode;
}

const FONT = "'Inter', system-ui, sans-serif";

/** Round badge with a lighter rim and a soft inner highlight. */
function Disc({ fill, rim }: { fill: string; rim: string }) {
  return (
    <>
      <circle cx="50" cy="52" r="44" fill="rgba(23,22,43,0.16)" />
      <circle cx="50" cy="50" r="44" fill={rim} />
      <circle cx="50" cy="50" r="37" fill={fill} />
      <path d="M20 42a31 31 0 0 1 60 0a40 26 0 0 0-60 0z" fill="#fff" opacity="0.16" />
    </>
  );
}

export const STAMPS: StampDef[] = [
  {
    id: 'check',
    label: 'Approved',
    words: 'check done yes approved ok tick',
    art: (
      <>
        <Disc fill="#1FA463" rim="#5FD08F" />
        <path d="M31 51l13 13 26-28" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: 'star',
    label: 'Star',
    words: 'star favorite best great',
    art: (
      <>
        <Disc fill="#F5A524" rim="#FFD27A" />
        <path
          d="M50 24l7.6 16.2 17.7 2.2-13 12.2 3.4 17.6L50 63.6l-15.7 8.6 3.4-17.6-13-12.2 17.7-2.2z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    id: 'plus1',
    label: '+1',
    words: 'plus one +1 agree vote yes like',
    art: (
      <>
        <rect x="8" y="22" width="84" height="60" rx="30" fill="rgba(23,22,43,0.16)" />
        <rect x="8" y="18" width="84" height="60" rx="30" fill="#7FB2FF" />
        <rect x="14" y="24" width="72" height="48" rx="24" fill="#2F80ED" />
        <text x="50" y="49" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily={FONT} fontWeight="700" fontSize="34">
          +1
        </text>
      </>
    ),
  },
  {
    id: 'question',
    label: 'Question',
    words: 'question ask unclear why help',
    art: (
      <>
        <Disc fill="#5B3FF0" rim="#A794FF" />
        <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily={FONT} fontWeight="700" fontSize="50">
          ?
        </text>
      </>
    ),
  },
  {
    id: 'love',
    label: 'Love it',
    words: 'love it heart like great awesome',
    art: (
      <g transform="rotate(-8 50 50)">
        <rect x="6" y="24" width="88" height="56" rx="12" fill="rgba(23,22,43,0.16)" />
        <rect x="6" y="20" width="88" height="56" rx="12" fill="#FF3D8B" />
        <rect x="10.5" y="24.5" width="79" height="47" rx="8" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="4 3" opacity="0.75" />
        <path
          d="M41.5 36.5c0-4 3.2-6.5 6.4-6.5 1.9 0 3.3 1 4.1 2.4.8-1.4 2.2-2.4 4.1-2.4 3.2 0 6.4 2.5 6.4 6.5 0 5.6-7.4 10.1-10.5 12.2-3.1-2.1-10.5-6.6-10.5-12.2z"
          transform="translate(-2 0)"
          fill="#fff"
        />
        <text x="50" y="61" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily={FONT} fontWeight="700" fontSize="17" letterSpacing="0.6">
          LOVE IT
        </text>
      </g>
    ),
  },
  {
    id: 'cross',
    label: 'Not this',
    words: 'cross no reject wrong x',
    art: (
      <>
        <Disc fill="#E5484D" rim="#FF8E91" />
        <path d="M36 36l28 28M64 36L36 64" stroke="#fff" strokeWidth="10" strokeLinecap="round" />
      </>
    ),
  },
];

export const STAMP_PREFIX = 'stamp:';
const BY_ID = new Map(STAMPS.map((s) => [s.id, s]));

export function stampOf(value: string): StampDef | null {
  return value.startsWith(STAMP_PREFIX) ? (BY_ID.get(value.slice(STAMP_PREFIX.length)) ?? null) : null;
}

export function StampArt({ stamp }: { stamp: StampDef }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={stamp.label}>
      {stamp.art}
    </svg>
  );
}
