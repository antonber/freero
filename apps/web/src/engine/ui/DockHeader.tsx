// The dock's header strip: it never scrolls, and holds the dock's close button. A dock panel puts
// its own header (title, search, filters) there with <DockHeader>, so the panel's content scrolls
// below the strip and never under the close button; no panel reserves room for the button itself.
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The element panels' headers are rendered into (null outside the dock). */
export const DockHeaderContext = createContext<HTMLElement | null>(null);

export interface DockHeaderProps {
  className?: string;
  children: ReactNode;
}

/**
 * Renders `children` in the dock's fixed header, left of the close button. Outside the dock (a
 * panel rendered elsewhere) it renders in place.
 */
export function DockHeader({ className, children }: DockHeaderProps) {
  const target = useContext(DockHeaderContext);
  const head = <div className={className}>{children}</div>;
  return target ? createPortal(head, target) : head;
}
