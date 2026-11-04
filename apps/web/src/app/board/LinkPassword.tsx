// A board whose share link asks for a password (KAI-145): the person gives it once (the server
// remembers it for this password; a new password asks again), then the board opens.
import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { LINK_PASSWORD_MAX } from '@freero/shared';
import { Button, Input, Logo } from '@ui';
import { ApiError } from '../api/client';
import { t } from '../messages';
import './BoardPage.css';

export function LinkPassword({ unlock, onUnlocked, footer }: { unlock: (password: string) => Promise<unknown>; onUnlocked: () => void; footer?: React.ReactNode }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError(t('enterThePassword'));
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotCheckThePassword'));
      setBusy(false);
    }
  };
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card fr-reqaccess">
        <Logo size={36} />
        <h1>{t('thisLinkAsksForA')}</h1>
        <p>
          <KeyRound size={15} aria-hidden />{' '}{t('theBoardSOwnerProtected')}</p>
        <form className="fr-reqaccess__form" onSubmit={submit} noValidate>
          <Input
            type="password"
            aria-label={t('linkPassword')}
            placeholder={t('password')}
            autoComplete="off"
            autoFocus
            maxLength={LINK_PASSWORD_MAX}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <Button type="submit" variant="primary" size="lg" loading={busy}>{t('openBoard')}</Button>
        </form>
        {footer}
      </div>
    </div>
  );
}
