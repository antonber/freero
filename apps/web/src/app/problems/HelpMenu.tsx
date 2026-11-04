// The "?" in the top bar of the dashboard and the settings page: help, and "Report a problem…".
import { useRef, useState } from 'react';
import { ChartNoAxesColumn, CircleHelp, LifeBuoy, MessageSquareWarning } from 'lucide-react';
import { IconButton, Menu, useToast } from '@ui';
import { toggleAnalytics, useAnalyticsState } from '../analytics/bridge';
import { toggleLabel } from '../analytics/runtime';
import { PROBLEM_SHORTCUT, useProblemReport } from './ProblemReport';

import { t } from '../messages';
export function HelpMenu({ size = 40, className }: { size?: 32 | 40; className?: string }) {
  const { open, available } = useProblemReport();
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const analytics = useAnalyticsState();
  const notify = useToast();
  return (
    <>
      <IconButton ref={ref} className={className} size={size} icon={CircleHelp} label={t('help')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)} />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchor={ref.current}
        align="end"
        minWidth={230}
        aria-label={t('help')}
        items={[
          ...(available ? [{ id: 'problem', label: 'Report a problem…', icon: MessageSquareWarning, shortcut: PROBLEM_SHORTCUT, onSelect: () => open() }] : []),
          { id: 'support', label: 'Help and support', icon: LifeBuoy, onSelect: () => window.open('/support', '_blank', 'noopener') },
          // Where this server measures with Google Analytics: this browser's opt-out (a GPC / Do Not Track signal can't be overridden).
          ...(analytics
            ? [
                {
                  id: 'analytics',
                  label: toggleLabel(analytics),
                  icon: ChartNoAxesColumn,
                  disabled: analytics === 'signal',
                  disabledReason: 'Your browser sends Global Privacy Control or Do Not Track, so analytics stays off.',
                  onSelect: () => {
                    toggleAnalytics();
                    notify(analytics === 'on' ? 'Analytics is off in this browser.' : 'Analytics is on again in this browser.', 'success');
                  },
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
