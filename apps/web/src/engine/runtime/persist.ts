// Per-user, per-browser conveniences (not board data): last tool options such as sticky color.
const KEY = 'freero:tool-options';

export function loadToolOptions(): Record<string, Record<string, unknown>> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function saveToolOptions(v: Record<string, Record<string, unknown>>): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      // storage unavailable
    }
  }, 300);
}
