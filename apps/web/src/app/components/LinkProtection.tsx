// The board owner's protection of its share link (KAI-145): a password the link asks for and a day
// it stops working. The server enforces both (for link visitors and guests); members never need them.
import { useState, type FormEvent } from 'react';
import { CalendarClock, KeyRound } from 'lucide-react';
import { LINK_PASSWORD_MAX, LINK_PASSWORD_MIN, type BoardSummary } from '@freero/shared';
import { Button, Input, useToast } from '@ui';
import { api, ApiError } from '../api/client';

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
      setError(e instanceof ApiError ? e.message : 'Could not change the link');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < LINK_PASSWORD_MIN) return setError(`At least ${LINK_PASSWORD_MIN} characters`);
    if (await save({ linkPassword: password }, p.password ? 'Password changed: people must enter the new one' : 'The link now asks for a password')) {
      setPassword('');
      setEditingPassword(false);
    }
  };

  const today = localDay(Date.now());
  return (
    <div className="fr-share__protect" aria-label="Link protection">
      <div className="fr-share__protect-row">
        <KeyRound size={15} aria-hidden />
        {editingPassword ? (
          <form className="fr-share__protect-form" onSubmit={submitPassword}>
            <Input
              type="password"
              size="sm"
              aria-label="Link password"
              placeholder={p.password ? 'New password' : 'Password for the link'}
              autoComplete="new-password"
              maxLength={LINK_PASSWORD_MAX}
              value={password}
              autoFocus
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingPassword(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span className="fr-share__protect-text">{p.password ? 'Asks for a password' : 'No password'}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingPassword(true)}>
              {p.password ? 'Change' : 'Add password'}
            </Button>
            {p.password ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void save({ linkPassword: null }, 'Password removed')}>
                Remove
              </Button>
            ) : null}
          </>
        )}
      </div>
      <div className="fr-share__protect-row">
        <CalendarClock size={15} aria-hidden />
        <span className={`fr-share__protect-text${p.expired ? ' fr-share__expired' : ''}`}>
          {p.expiresAt === null ? 'Never expires' : p.expired ? `Expired ${new Date(p.expiresAt).toLocaleDateString()}` : 'Works until the end of'}
        </span>
        <input
          type="date"
          className="fr-share__date"
          aria-label="Link expiry date"
          min={today}
          value={p.expiresAt !== null && !p.expired ? localDay(p.expiresAt) : ''}
          onChange={(e) => e.target.value && void save({ linkExpiresAt: endOfDay(e.target.value) }, `The link works until ${new Date(endOfDay(e.target.value)).toLocaleDateString()}`)}
        />
        {p.expiresAt !== null ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void save({ linkExpiresAt: null }, 'The link no longer expires')}>
            Never expire
          </Button>
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
