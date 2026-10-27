import { useEffect, useState, type FormEvent } from 'react';
import { Avatar, Button, ColorSwatches, Input, Modal, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

// Same palette the server assigns at signup: saturated enough to read on the canvas.
const CURSOR_COLORS = [
  '#E8590C', '#2F9E44', '#1C7ED6', '#9C36B5', '#D6336C', '#0C8599',
  '#F08C00', '#5F3DC4', '#C92A2A', '#087F5B', '#3B5BDB', '#A61E4D',
];

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refresh } = useAuth();
  const notify = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5F3DC4');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && user) {
      setName(user.name);
      setColor(user.color);
      setError(null);
    }
  }, [open, user]);

  if (!user) return null;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n) return setError('Your name can’t be empty');
    if (n.length > 80) return setError('Keep it under 80 characters');
    setSaving(true);
    try {
      await api.updateMe({ name: n, color });
      await refresh();
      notify('Profile updated', 'success');
      onClose();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not save your profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Profile"
      description="How collaborators see you on boards."
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => save()}>
            Save changes
          </Button>
        </>
      }
    >
      <form className="fr-profile" onSubmit={save} noValidate>
        <div className="fr-profile__preview">
          <Avatar name={name || user.name} color={color} size={56} />
          <div className="fr-profile__cursor" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2 1.5 L15 8.2 L9.2 9.6 L6.6 15.6 Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span style={{ background: color }}>{name.trim() || user.name}</span>
          </div>
        </div>
        <Input label="Name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} error={error ?? undefined} maxLength={80} />
        <Input label="Email" value={user.email} disabled readOnly />
        <div className="fr-field">
          <span className="fr-field__label">Cursor color</span>
          <ColorSwatches colors={CURSOR_COLORS} value={color} onChange={setColor} size={28} aria-label="Cursor color" />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
