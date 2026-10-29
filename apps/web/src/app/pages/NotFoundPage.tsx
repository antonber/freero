import { Button, Logo } from '@ui';
import './auth/AuthPage.css';

export function NotFoundPage() {
  return (
    <div className="fr-authpage">
      <div className="fr-authcard" style={{ textAlign: 'center' }}>
        {/* A full navigation: the server answers `/` (your boards when signed in, else the site). */}
        <a href="/" className="fr-authcard__logo" aria-label="Freero home">
          <Logo size={36} />
        </a>
        <h1 className="fr-authcard__title">This corner of the canvas is empty</h1>
        <p className="fr-authcard__sub">The page you were looking for doesn't exist or has moved.</p>
        <Button variant="primary" block size="lg" onClick={() => window.location.assign('/')}>
          Back to Freero
        </Button>
      </div>
    </div>
  );
}
