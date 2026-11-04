import type { Editor } from '@engine';
import { resolveLink } from './link';

import { t } from '../messages';
/** Follows an item's link: camera glides to an in-board target, web links open in a new tab. */
export function followLink(editor: Editor, link: string | null | undefined): void {
  const target = resolveLink(link, window.location.origin);
  if (!target) return editor.host.notify(t('thisLinkCanTBe'), 'error');
  if (target.kind === 'url') {
    window.open(target.href, '_blank', 'noopener,noreferrer');
    return;
  }
  if (target.kind === 'path') return editor.host.navigate(target.path);
  const el = editor.getElement(target.id);
  if (!el || !editor.getBounds([target.id])) {
    return editor.host.notify(el ? t('theLinkedItemIsHidden') : t('theLinkedItemIsNo'), 'info');
  }
  editor.select([target.id]);
  editor.zoomToFit([target.id], { animate: true, maxZoom: 1, padding: 120 });
}
