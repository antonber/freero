// Freero's sticker packs (#138): original die-cut stickers drawn for Freero on the same 100 × 100
// grid as the stamps, in the brand palette (ui/tokens.css). Stored like stamps (`stamp:<id>`), so
// they place, scale, react, export and read in the outline the same way.
import type { ReactNode } from 'react';
import { STAMP_PREFIX, STAMPS, type StampDef } from './stamps';

import { t } from '../messages';
export interface StickerPack {
  id: string;
  label: string;
  stickers: StampDef[];
}

const SHADOW = 'rgba(23,22,43,0.16)';
const INK = '#3A2A12';
const FONT = "'Inter', system-ui, sans-serif";

/** A round die-cut: white border, soft shadow, then `fill`. */
function Round({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <circle cx="50" cy="53" r="46" fill={SHADOW} />
      <circle cx="50" cy="50" r="46" fill="#fff" />
      <circle cx="50" cy="50" r="40" fill={fill} />
      {children}
    </>
  );
}

/** A rounded-square die-cut. */
function Tile({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <rect x="4" y="7" width="92" height="92" rx="24" fill={SHADOW} />
      <rect x="4" y="4" width="92" height="92" rx="24" fill="#fff" />
      <rect x="10" y="10" width="80" height="80" rx="19" fill={fill} />
      {children}
    </>
  );
}

const face = '#FFC93C';
const eyes = (
  <>
    <ellipse cx="37" cy="43" rx="4.5" ry="6" fill={INK} />
    <ellipse cx="63" cy="43" rx="4.5" ry="6" fill={INK} />
  </>
);
const cheeks = (
  <>
    <circle cx="28" cy="58" r="5.5" fill="#FF8A7A" opacity="0.55" />
    <circle cx="72" cy="58" r="5.5" fill="#FF8A7A" opacity="0.55" />
  </>
);
const stroke = { fill: 'none', stroke: INK, strokeWidth: 4.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const heart = (x: number, y: number) =>
  `M${x} ${y + 8}c-7-5-9.5-9-9.5-12.5 0-3 2.3-5 4.8-5 2 0 3.6 1.2 4.7 3 1.1-1.8 2.7-3 4.7-3 2.5 0 4.8 2 4.8 5 0 3.5-2.5 7.5-9.5 12.5z`;

/** A cloud resting on y = `base`, about `w` wide, centred on `cx` (its line keeps `strokeWidth`). */
function Cloud({ cx, base, w, fill, stroke, strokeWidth }: { cx: number; base: number; w: number; fill: string; stroke: string; strokeWidth: number }) {
  const k = w / 56;
  return (
    <path
      d="M-19 0H19a10 10 0 0 0 1-19.9a15 15 0 0 0-27.5-7.4a11.5 11.5 0 0 0-17.8 8.6A9.6 9.6 0 0 0-19 0z"
      transform={`translate(${cx} ${base}) scale(${k})`}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth / k}
      strokeLinejoin="round"
    />
  );
}

function rays(cx: number, cy: number, r0: number, r1: number, color: string, width: number) {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * r0}
        y1={cy + Math.sin(a) * r0}
        x2={cx + Math.cos(a) * r1}
        y2={cy + Math.sin(a) * r1}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  });
}

const WORKSHOP: StampDef[] = [
  {
    id: 'idea',
    label: t('greatIdea'),
    words: 'idea lightbulb bulb insight eureka bright',
    art: (
      <Tile fill="#FFF5E2">
        {rays(50, 40, 25, 31, '#F5A524', 4).filter((_, i) => i >= 4 || i === 0)}
        <path d="M50 21c-11 0-19 8-19 18.5 0 7 3.8 11.5 7.5 15 2 2 2.9 4.2 2.9 6.5h17.2c0-2.3.9-4.5 2.9-6.5 3.7-3.5 7.5-8 7.5-15C69 29 61 21 50 21z" fill="#FFC93C" />
        <path d="M44 38c1.5-4 4-6 8-6.5" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity="0.8" />
        <rect x="41.5" y="64" width="17" height="7" rx="2.5" fill="#8A89A3" />
        <rect x="43.5" y="73" width="13" height="6" rx="3" fill="#6B6A85" />
      </Tile>
    ),
  },
  {
    id: 'blocker',
    label: t('blocker'),
    words: 'blocker blocked stop risk impediment halt',
    art: (
      <>
        <path d="M33 9h34l24 24v34L67 91H33L9 67V33z" transform="translate(0 3)" fill={SHADOW} />
        <path d="M33 9h34l24 24v34L67 91H33L9 67V33z" fill="#fff" />
        <path d="M35.5 15h29L85 35.5v29L64.5 85h-29L15 64.5v-29z" fill="#E5484D" />
        <rect x="27" y="44" width="46" height="12" rx="4" fill="#fff" />
      </>
    ),
  },
  {
    id: 'ship-it',
    label: t('shipIt'),
    words: 'ship it launch rocket release go live deploy',
    art: (
      <Round fill="#EAF3FF">
        <g transform="rotate(38 50 50)">
          <path d="M44 66q6 20 12 0z" fill="#F5A524" />
          <path d="M47 66q3 11 6 0z" fill="#FFE3B0" />
          <path d="M42 52 31 66l11-3zM58 52l11 14-11-3z" fill="#FF3D8B" />
          <path d="M50 16c9 8 12 22 9 38l-1.5 12h-15L41 54c-3-16 0-30 9-38z" fill="#fff" stroke="#5B3FF0" strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="50" cy="39" r="6.5" fill="#5B3FF0" />
          <circle cx="50" cy="39" r="2.8" fill="#A794FF" />
        </g>
      </Round>
    ),
  },
  {
    id: 'needs-data',
    label: t('needsData'),
    words: 'needs data evidence numbers chart metrics research',
    art: (
      <Tile fill="#F1EEFF">
        <rect x="27" y="52" width="11" height="20" rx="3" fill="#A794FF" />
        <rect x="44.5" y="40" width="11" height="32" rx="3" fill="#7B61FF" />
        <rect x="62" y="27" width="11" height="45" rx="3" fill="#5B3FF0" />
        <path d="M24 76h52" stroke="#5B3FF0" strokeWidth="4" strokeLinecap="round" />
      </Tile>
    ),
  },
  {
    id: 'parking-lot',
    label: t('parkingLot'),
    words: 'parking lot later park it off topic come back',
    art: (
      <Tile fill="#2F80ED">
        <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily={FONT} fontWeight="800" fontSize="54">
          P
        </text>
      </Tile>
    ),
  },
  {
    id: 'hot-topic',
    label: t('hotTopic'),
    words: 'hot topic fire flame trending urgent burning',
    art: (
      <Round fill="#FFEFED">
        <path d="M50 16c7 12 21 20 21 39 0 14-9.5 24-21 24S29 69 29 55c0-9.5 5-15.5 9-21.5 1.5 7.5 5 11.5 9.5 12.5-2-9.5-1-20 2.5-30z" fill="#F0645A" />
        <path d="M50 47c5 7 11 11 11 19 0 7.5-5 12-11 12s-11-4.5-11-12c0-7 6-11 11-19z" fill="#F5A524" />
      </Round>
    ),
  },
];

const MOODS: StampDef[] = [
  {
    id: 'mood-happy',
    label: t('happy'),
    words: 'happy smile glad good pleased face mood',
    art: (
      <Round fill={face}>
        {eyes}
        {cheeks}
        <path d="M34 59q16 16 32 0" {...stroke} />
      </Round>
    ),
  },
  {
    id: 'mood-love',
    label: t('adoreIt'),
    words: 'love adore heart eyes crush face mood',
    art: (
      <Round fill={face}>
        <path d={heart(37, 36)} fill="#FF3D8B" />
        <path d={heart(63, 36)} fill="#FF3D8B" />
        {cheeks}
        <path d="M33 58q17 18 34 0z" fill={INK} />
        <path d="M40 66q10 6 20 0" fill="none" stroke="#FF8A7A" strokeWidth="4" strokeLinecap="round" />
      </Round>
    ),
  },
  {
    id: 'mood-wow',
    label: t('wow'),
    words: 'wow surprised amazed shocked omg face mood',
    art: (
      <Round fill={face}>
        <path d="M29 30q7-6 15-1M56 29q8-5 15 1" {...stroke} strokeWidth={4} />
        <circle cx="37" cy="44" r="5.5" fill={INK} />
        <circle cx="63" cy="44" r="5.5" fill={INK} />
        <ellipse cx="50" cy="65" rx="7.5" ry="9.5" fill={INK} />
      </Round>
    ),
  },
  {
    id: 'mood-thinking',
    label: t('hmm'),
    words: 'thinking hmm unsure considering doubt face mood',
    art: (
      <Round fill={face}>
        <path d="M29 34l14-2M56 30q7-6 15-1" {...stroke} strokeWidth={4} />
        {eyes}
        <path d="M39 64l22-4" {...stroke} />
        <circle cx="76" cy="20" r="3" fill="#8A89A3" />
        <circle cx="84" cy="12" r="2" fill="#8A89A3" />
      </Round>
    ),
  },
  {
    id: 'mood-sad',
    label: t('sad'),
    words: 'sad unhappy down disappointed tear cry face mood',
    art: (
      <Round fill={face}>
        <path d="M30 35l12-4M70 35l-12-4" {...stroke} strokeWidth={4} />
        {eyes}
        <path d="M36 68q14-12 28 0" {...stroke} />
        <path d="M67 50c-4 6-4.5 9-4.5 10.5a4.5 4.5 0 0 0 9 0c0-1.5-.5-4.5-4.5-10.5z" fill="#4FA9FF" />
      </Round>
    ),
  },
  {
    id: 'mood-sleepy',
    label: t('sleepy'),
    words: 'sleepy tired bored zzz sleep low energy face mood',
    art: (
      <Round fill={face}>
        <path d="M30 45q7 6 14 0M56 45q7 6 14 0" {...stroke} />
        <circle cx="50" cy="65" r="4.5" fill={INK} />
        <text x="72" y="26" fill="#5B3FF0" fontFamily={FONT} fontWeight="800" fontSize="16">z</text>
        <text x="81" y="15" fill="#5B3FF0" fontFamily={FONT} fontWeight="800" fontSize="11">z</text>
      </Round>
    ),
  },
];

const SKY_TILE = '#EAF3FF';
const CLOUD = { fill: '#fff', stroke: '#7FA6D6', strokeWidth: 3 };

const WEATHER: StampDef[] = [
  {
    id: 'weather-sunny',
    label: t('sunny'),
    words: 'sunny sun great clear bright weather health check',
    art: (
      <Tile fill={SKY_TILE}>
        {rays(50, 50, 22, 30, '#F5A524', 5)}
        <circle cx="50" cy="50" r="15" fill="#FFC93C" />
      </Tile>
    ),
  },
  {
    id: 'weather-partly',
    label: t('partlySunny'),
    words: 'partly sunny cloud mostly fine ok weather health check',
    art: (
      <Tile fill={SKY_TILE}>
        {rays(40, 40, 16, 22, '#F5A524', 4)}
        <circle cx="40" cy="40" r="11" fill="#FFC93C" />
        <Cloud cx={58} base={74} w={46} {...CLOUD} />
      </Tile>
    ),
  },
  {
    id: 'weather-cloudy',
    label: t('cloudy'),
    words: 'cloudy cloud grey meh unclear weather health check',
    art: (
      <Tile fill={SKY_TILE}>
        <Cloud cx={50} base={66} w={58} {...CLOUD} />
      </Tile>
    ),
  },
  {
    id: 'weather-rainy',
    label: t('rainy'),
    words: 'rainy rain wet struggling weather health check',
    art: (
      <Tile fill={SKY_TILE}>
        <Cloud cx={50} base={56} w={58} {...CLOUD} />
        <path d="M37 64l-4 9M50 64l-4 9M63 64l-4 9" stroke="#2F80ED" strokeWidth="4" strokeLinecap="round" />
      </Tile>
    ),
  },
  {
    id: 'weather-stormy',
    label: t('stormy'),
    words: 'stormy storm thunder lightning trouble crisis weather health check',
    art: (
      <Tile fill="#DCD4FF">
        <Cloud cx={50} base={56} w={58} fill="#6B6A85" stroke="#4B4A63" strokeWidth={3} />
        <path d="M52 56l-9 13h8l-5 12 13-17h-8l5-8z" fill="#FFC93C" stroke="#F5A524" strokeWidth="1.5" strokeLinejoin="round" />
      </Tile>
    ),
  },
  {
    id: 'weather-rainbow',
    label: t('rainbow'),
    words: 'rainbow better after storm hope recovery weather health check',
    art: (
      <Tile fill={SKY_TILE}>
        {['#F0645A', '#F5A524', '#1FBF96', '#3B8BF0'].map((c, i) => (
          <path key={c} d={`M${22 + i * 6} 70a${28 - i * 6} ${28 - i * 6} 0 0 1 ${56 - i * 12} 0`} fill="none" stroke={c} strokeWidth="6" />
        ))}
        <Cloud cx={27} base={76} w={30} {...CLOUD} strokeWidth={2.5} />
        <Cloud cx={73} base={76} w={30} {...CLOUD} strokeWidth={2.5} />
      </Tile>
    ),
  },
];

/** Every built-in pack, in the order the picker shows them. */
export const PACKS: StickerPack[] = [
  { id: 'stamps', label: t('stamps'), stickers: STAMPS },
  { id: 'workshop', label: t('workshop'), stickers: WORKSHOP },
  { id: 'moods', label: t('moods'), stickers: MOODS },
  { id: 'weather', label: t('teamWeather'), stickers: WEATHER },
];

const BY_ID = new Map(PACKS.flatMap((p) => p.stickers).map((s) => [s.id, s]));

/** The stamp or pack sticker a stored value names (`stamp:<id>`), or null. */
export function stampOf(value: string): StampDef | null {
  return value.startsWith(STAMP_PREFIX) ? (BY_ID.get(value.slice(STAMP_PREFIX.length)) ?? null) : null;
}
