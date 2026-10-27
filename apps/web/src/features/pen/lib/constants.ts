export const TOOL_ID = 'pen';

export type PenMode = 'pen' | 'highlighter';
export type SizeIndex = 0 | 1 | 2;

export const PEN_COLORS = ['#17162B', '#5B3FF0', '#2F80ED', '#14A3A3', '#1FA463', '#F5A524', '#E5484D', '#FF3D8B'];
export const PEN_COLOR_NAMES: Record<string, string> = {
  '#17162B': 'Ink',
  '#5B3FF0': 'Violet',
  '#2F80ED': 'Blue',
  '#14A3A3': 'Teal',
  '#1FA463': 'Green',
  '#F5A524': 'Amber',
  '#E5484D': 'Red',
  '#FF3D8B': 'Pink',
};

export const HIGHLIGHTER_COLORS = ['#FFE45C', '#B8F36B', '#7DE8C4', '#8CCBFF', '#C9B8FF', '#FF9BD2', '#FFB870', '#FF8C8C'];
export const HIGHLIGHTER_COLOR_NAMES: Record<string, string> = {
  '#FFE45C': 'Yellow',
  '#B8F36B': 'Lime',
  '#7DE8C4': 'Mint',
  '#8CCBFF': 'Sky',
  '#C9B8FF': 'Lilac',
  '#FF9BD2': 'Pink',
  '#FFB870': 'Apricot',
  '#FF8C8C': 'Coral',
};

/** Stroke widths (world units) for the S / M / L choices. */
export const PEN_WIDTHS = [2, 4, 8] as const;
export const HIGHLIGHTER_WIDTHS = [12, 20, 32] as const;
export const SIZE_LABELS = ['Thin', 'Medium', 'Thick'] as const;

export const HIGHLIGHTER_OPACITY = 0.5;

export interface PenToolOptions {
  mode?: PenMode;
  penColor?: string;
  highlighterColor?: string;
  penSize?: SizeIndex;
  highlighterSize?: SizeIndex;
}

export function resolvePenOptions(o: PenToolOptions) {
  const mode = o.mode ?? 'pen';
  const highlighter = mode === 'highlighter';
  const size = (highlighter ? o.highlighterSize : o.penSize) ?? 1;
  return {
    mode,
    highlighter,
    size,
    color: highlighter ? (o.highlighterColor ?? HIGHLIGHTER_COLORS[0]) : (o.penColor ?? PEN_COLORS[0]),
    width: (highlighter ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS)[size],
  };
}

/** Closest S/M/L index for an existing stroke width (format toolbar). */
export function sizeIndexOf(width: number, highlighter: boolean): SizeIndex {
  const widths = highlighter ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
  let best: SizeIndex = 0;
  widths.forEach((w, i) => {
    if (Math.abs(w - width) < Math.abs(widths[best] - width)) best = i as SizeIndex;
  });
  return best;
}
