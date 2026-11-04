import { Button, Logo } from '@ui';
import { t } from '../messages';
import './auth/AuthPage.css';

export function NotFoundPage() {
  return (
    <div className="fr-authpage">
      <div className="fr-authcard" style={{ textAlign: 'center' }}>
        {/* A full navigation: the server answers `/` (your boards when signed in, else the site). */}
        <a href="/" className="fr-authcard__logo" aria-label={t('freeroHome')}>
          <Logo size={36} />
        </a>
        <h1 className="fr-authcard__title">{t('thisCornerOfTheCanvas')}</h1>
        <p className="fr-authcard__sub">{t('thePageYouWereLooking')}</p>
        <Button variant="primary" block size="lg" onClick={() => window.location.assign('/')}>{t('backToFreero')}</Button>
      </div>
    </div>
  );
}
