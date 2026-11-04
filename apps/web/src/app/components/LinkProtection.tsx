// The protection of a board's share link by its owner and co-owners (KAI-145, #122; the workspace may
// require both, #39): a password the link asks for and a day
// it stops working. The server enforces both (for link visitors and guests); members never need them.
import { useState, type FormEvent } from 'react';
import { CalendarClock, KeyRound } from 'lucide-react';
import { LINK_PASSWORD_MAX, LINK_PASSWORD_MIN, type BoardSummary } from '@freero/shared';
import { Button, Input, useToast } from '@ui';
import { api, ApiError } from '../api/client';

import { t as tr } from '../messages';
/** The end of `day` (YYYY-MM-DD) in this browser's time zone, as epoch ms. */
export function endOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/** YYYY-MM-DD of an instant in this browser's time zone. */
export function localDay(ms: number): string {
  const t = new Date(ms);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function LinkProtection({ board, onChange }: { board: BoardSummary; onChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  const p = board.linkProtection;
  const [editingPassword, setEditingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p) return null;

  const save = async (patch: { linkPassword?: string | null; linkExpiresAt?: number | null }, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const { board: updated } = await api.updateBoard(board.id, patch);
      onChange(updated);
      notify(done, 'success');
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('couldNotChangeTheLink'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < LINK_PASSWORD_MIN) return setError(tr('atLeastLinkPasswordMin', { link_password_min: LINK_PASSWORD_MIN }));
    if (await save({ linkPassword: password }, p.password ? tr('passwordChangedPeopleMustEnter') : tr('theLinkNowAsksFor'))) {
      setPassword('');
      setEditingPassword(false);
    }
  };

  const today = localDay(Date.now());
  // The workspace's link policy (#39): the latest day the link may work until.
  const maxDays = board.permissions.linkPolicy?.maxDays ?? null;
  const lastDay = maxDays === null ? undefined : localDay(Date.now() + maxDays * 24 * 60 * 60 * 1000);
  return (
    <div className="fr-share__protect" aria-label={tr('linkProtection')}>
      <div className="fr-share__protect-row">
        <KeyRound size={15} aria-hidden />
        {editingPassword ? (
          <form className="fr-share__protect-form" onSubmit={submitPassword}>
            <Input
              type="password"
              size="sm"
              aria-label={tr('linkPassword')}
              placeholder={p.password ? tr('newPassword') : tr('passwordForTheLink')}
              autoComplete="new-password"
              maxLength={LINK_PASSWORD_MAX}
              value={password}
              autoFocus
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
            <Button type="submit" size="sm" variant="primary" loading={busy}>{tr('save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingPassword(false)}>{tr('cancel')}</Button>
          </form>
        ) : (
          <>
            <span className="fr-share__protect-text">{p.password ? tr('asksForAPassword') : tr('noPassword')}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingPassword(true)}>
              {p.password ? tr('change') : tr('addPassword')}
            </Button>
            {p.password ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void save({ linkPassword: null }, tr('passwordRemoved'))}>{tr('remove')}</Button>
            ) : null}
          </>
        )}
      </div>
      <div className="fr-share__protect-row">
        <CalendarClock size={15} aria-hidden />
        <span className={`fr-share__protect-text${p.expired ? ' fr-share__expired' : ''}`}>
          {p.expiresAt === null ? tr('neverExpires') : p.expired ? tr('expiredTolocaledatestring', { toLocaleDateString: new Date(p.expiresAt).toLocaleDateString() }) : tr('worksUntilTheEndOf')}
        </span>
        <input
          type="date"
          className="fr-share__date"
          aria-label={tr('linkExpiryDate')}
          min={today}
          max={lastDay}
          value={p.expiresAt !== null && !p.expired ? localDay(p.expiresAt) : ''}
          onChange={(e) => e.target.value && void save({ linkExpiresAt: endOfDay(e.target.value) }, tr('theLinkWorksUntilTolocaledatestring', { toLocaleDateString: new Date(endOfDay(e.target.value)).toLocaleDateString() }))}
        />
        {p.expiresAt !== null ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void save({ linkExpiresAt: null }, tr('theLinkNoLongerExpires'))}>{tr('neverExpire')}</Button>
        ) : null}
      </div>
      {error ? (
        <p className="fr-share__protect-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
