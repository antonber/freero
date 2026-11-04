// Only the embed pages ever render inside another page's frame (#2). The server already refuses to
// let other sites frame anything else (frame-ancestors 'none'), but an embed page's own in-app
// navigation would load the full app INTO the frame without asking the server again: this stops
// that, so a framing site can never get the signed-in app under its own UI.
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button, Logo } from '@ui';
import { t } from '../messages';
import '../board/BoardPage.css';

/**
 * Pages made to run framed: a board embedded on another site, the live view in an AI assistant, and
 * the Microsoft Teams tab and its configuration page (framed by Teams only).
 */
const FRAMABLE = /^\/(embed\/(b|board)\/|teams\/b\/|teams\/config\/?$)/;

const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent can't even be compared
  }
})();

export function FrameGuard({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  if (!framed || FRAMABLE.test(pathname)) return <>{children}</>;
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        <h1>{t('freeroOpensInItsOwn')}</h1>
        <p>{t('thisPageCanTBe')}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" icon={ExternalLink} onClick={() => void window.open(pathname + search, '_blank', 'noopener')}>{t('openInFreero')}</Button>
        </div>
      </div>
    </div>
  );
}
