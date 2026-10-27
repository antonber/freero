import { isValidElement, type ComponentType, type ReactNode } from 'react';

/**
 * Anything usable as an icon: a rendered node (`<Plus size={18} />`) or an icon
 * component (`Plus` from lucide-react), which is rendered at the right size.
 */
export type IconProp =
  | ReactNode
  | ComponentType<{ size?: number | string; strokeWidth?: number | string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

function isComponent(icon: unknown): icon is ComponentType<{ size?: number; strokeWidth?: number }> {
  if (typeof icon === 'function') return true;
  // forwardRef / memo components (lucide icons are forwardRef objects)
  return typeof icon === 'object' && icon !== null && !isValidElement(icon) && '$$typeof' in icon;
}

export function renderIcon(icon: IconProp, size: number, strokeWidth = 2): ReactNode {
  if (icon === null || icon === undefined || icon === false) return null;
  if (isComponent(icon)) {
    const C = icon as ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
    return <C size={size} strokeWidth={strokeWidth} aria-hidden />;
  }
  return icon as ReactNode;
}

export function Icon({ icon, size = 18, className }: { icon: IconProp; size?: number; className?: string }) {
  if (!icon) return null;
  return (
    <span className={'fr-icon' + (className ? ` ${className}` : '')} aria-hidden>
      {renderIcon(icon, size)}
    </span>
  );
}
