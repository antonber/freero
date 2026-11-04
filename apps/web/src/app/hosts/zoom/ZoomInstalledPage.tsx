// Route /zoom/installed — where Zoom sends people after they add the Freero app (the app's OAuth
// redirect URL, #168). Freero calls no Zoom API, so there is nothing to exchange: it says where the
// app is now.
import { Logo } from '@ui';
import { t } from '../messages';
import '../../board/BoardPage.css';

export default function ZoomInstalledPage() {
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        <h1>{t('freeroIsAddedToZoom')}</h1>
        <p>{t('freeroIsAddedToZoomText')}</p>
      </div>
    </div>
  );
}
