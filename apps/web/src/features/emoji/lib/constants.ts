export const TOOL_ID = 'emoji';
export const DEFAULT_CHOICE = 'stamp:plus1';
/** On-screen size (px) of a freshly placed emoji/stamp. */
export const PLACE_SIZE = 64;
export const MAX_RECENT = 8;

export interface EmojiToolOptions {
  /** What a click places: an emoji grapheme or `stamp:<id>`. */
  current?: string;
  recent?: string[];
}
