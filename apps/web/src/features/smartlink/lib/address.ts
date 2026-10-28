// Which pasted text is a Freero object address (and so becomes a smart link rather than a plain
// link card): a `freero://` URI, or a board / item URL of THIS app's origin. Another site's
// `/board/…` URL is just a web link.
import { formatObjectUri, parseObjectUri, type ObjectRef } from '@freero/shared';

/** The object a pasted text addresses, or null. The text must be the address alone. */
export function pastedObject(text: string | null, origin: string): { ref: ObjectRef; uri: string } | null {
  const t = (text ?? '').trim();
  if (!t || /\s/.test(t)) return null;
  // A bare path pasted on its own is too ambiguous to claim; full URLs and URIs only.
  if (t.startsWith('/')) return null;
  const ref = parseObjectUri(t, [origin]);
  return ref ? { ref, uri: formatObjectUri(ref) } : null;
}
