import { memo } from 'react';
import { ArrowUpRight, Crosshair } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { defineDecoration, useEditor, useIsExporting } from '@engine';
import { followLink } from './lib/follow';
import { describeLink, resolveLink } from './lib/link';
import './links.css';

/** Badge size on screen (px); it shrinks on items too small to carry it. */
const BADGE_PX = 22;

/**
 * A small badge at the item's bottom-right corner; clicking it follows the link. Drawn inside the
 * item's wrapper so it moves and rotates with it; left out of image exports.
 */
const LinkBadge = memo(function LinkBadge({ element, zoom }: { element: BoardElement; zoom: number }) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const target = resolveLink(element.link, window.location.origin);
  if (exporting || !target) return null;
  const size = Math.min(BADGE_PX / zoom, Math.min(element.w, element.h) * 0.6);
  const label = target.kind === 'item' ? 'Go to linked item' : `Open ${describeLink(target)}`;
  const Icon = target.kind === 'item' ? Crosshair : ArrowUpRight;
  return (
    <button
      type="button"
      className="fr-links-badge"
      data-fr-interactive=""
      title={label}
      aria-label={label}
      style={{ width: size, height: size, right: -size * 0.3, bottom: -size * 0.3 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        followLink(editor, element.link);
      }}
    >
      <Icon size="62%" strokeWidth={2.4} aria-hidden />
    </button>
  );
});

export default defineDecoration({
  id: 'links.badge',
  order: 100,
  appliesTo: (el) => !!el.link && el.type !== 'connector',
  Component: LinkBadge,
});
