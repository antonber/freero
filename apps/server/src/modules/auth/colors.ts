/** Cursor/avatar colors: saturated enough to read on a light canvas, distinct from each other. */
export const CURSOR_COLORS = [
  '#E8590C', // orange
  '#2F9E44', // green
  '#1C7ED6', // blue
  '#9C36B5', // purple
  '#D6336C', // pink
  '#0C8599', // teal
  '#F08C00', // amber
  '#5F3DC4', // violet
  '#C92A2A', // red
  '#087F5B', // emerald
  '#3B5BDB', // indigo
  '#A61E4D', // raspberry
] as const;

export function randomCursorColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}
