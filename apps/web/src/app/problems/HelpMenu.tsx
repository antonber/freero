// The "?" in the top bar of the dashboard and the settings page: help, and "Report a problem…".
import { useRef, useState } from 'react';
import { CircleHelp, Cookie, LifeBuoy, MessageSquareWarning } from 'lucide-react';
import { IconButton, Menu } from '@ui';
import { openCookieSettings, useAnalyticsEnabled } from '../analytics/bridge';
import { PROBLEM_SHORTCUT, useProblemReport } from './ProblemReport';

export function HelpMenu({ size = 40, className }: { size?: 32 | 40; className?: string }) {
  const { open, available } = useProblemReport();
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const analytics = useAnalyticsEnabled();
  return (
    <>
      <IconButton ref={ref} className={className} size={size} icon={CircleHelp} label="Help" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)} />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchor={ref.current}
        align="end"
        minWidth={230}
        aria-label="Help"
        items={[
          ...(available ? [{ id: 'problem', label: 'Report a problem…', icon: MessageSquareWarning, shortcut: PROBLEM_SHORTCUT, onSelect: () => open() }] : []),
          { id: 'support', label: 'Help and support', icon: LifeBuoy, onSelect: () => window.open('/support', '_blank', 'noopener') },
          // Where Google Analytics is on: change the consent choice (the banner, focused).
          ...(analytics ? [{ id: 'cookies', label: 'Cookie settings', icon: Cookie, onSelect: () => openCookieSettings(ref.current) }] : []),
        ]}
      />
    </>
  );
}
