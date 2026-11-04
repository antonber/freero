// Route /embed/signed-in — where the sign-in tab opened by an embed's sign-in popup (#2) lands:
// it tells the popup (the app's session channel) and closes itself.
import { useEffect } from 'react';
import { Logo } from '@ui';
import { announceSessionChange, useAuth } from '../auth/AuthContext';
import { t } from '../messages';
import '../board/BoardPage.css';

export default function EmbedSignedInPage() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    announceSessionChange();
    window.close();
  }, [user]);
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        <h1>{user ? t('youReSignedIn') : t('signingIn')}</h1>
        <p>{t('goBackToTheFreero')}</p>
      </div>
    </div>
  );
}
