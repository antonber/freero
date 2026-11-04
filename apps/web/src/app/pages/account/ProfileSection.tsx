// Settings → Profile: the photo, name and cursor colour collaborators see.
import { useRef, useState, type FormEvent } from 'react';
import { ImageUp } from 'lucide-react';
import { Avatar, Button, ColorSwatches, Input, readableTextColor, useToast } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { SettingsSection } from './Section';
import { errorText } from './SecuritySections';
import { t as tr } from './messages';

// Same palette the server assigns at signup: saturated enough to read on the canvas.
const CURSOR_COLORS = [
  '#E8590C', '#2F9E44', '#1C7ED6', '#9C36B5', '#D6336C', '#0C8599',
  '#F08C00', '#5F3DC4', '#C92A2A', '#087F5B', '#3B5BDB', '#A61E4D',
];

export function ProfileSection() {
  const { user, updateProfile, adopt } = useAuth();
  const notify = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.color ?? CURSOR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!user) return null;
  const dirty = name.trim() !== user.name || color !== user.color;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError(tr('yourNameCanTBe'));
    if (n.length > 80) return setError(tr('keepItUnder80Characters'));
    setSaving(true);
    try {
      await updateProfile({ name: n, color });
      notify(tr('profileUpdated'), 'success');
    } catch (err) {
      notify(errorText(err, tr('couldNotSaveYourProfile')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      adopt((await api.uploadAvatar(f)).user);
      notify(tr('photoUpdated'), 'success');
    } catch (err) {
      notify(errorText(err, tr('couldNotUploadThePhoto')), 'error');
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const removePhoto = async () => {
    try {
      adopt((await api.removeAvatar()).user);
    } catch (err) {
      notify(errorText(err, tr('couldNotRemoveThePhoto')), 'error');
    }
  };

  return (
    <SettingsSection id="profile" title={tr('profile.title')}>
      <div className="fr-acct-avatar">
        <div className="fr-acct-preview">
          <Avatar name={name || user.name} color={color} src={user.avatarUrl} size={64} />
          <div className="fr-acct-preview__cursor" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2 1.5 L15 8.2 L9.2 9.6 L6.6 15.6 Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span style={{ background: color, color: readableTextColor(color) }}>{name.trim() || user.name}</span>
          </div>
        </div>
        <div className="fr-acct-avatar__actions">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            hidden
            aria-label={tr('chooseAProfilePhoto')}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button icon={ImageUp} loading={uploading} onClick={() => file.current?.click()}>{tr('uploadPhoto')}</Button>
          {user.avatarUrl ? (
            <Button variant="ghost" onClick={removePhoto}>{tr('remove')}</Button>
          ) : null}
          <span className="fr-acct__hint">{tr('profile.photoHint')}</span>
        </div>
      </div>
      <form className="fr-acct-form" onSubmit={save} noValidate>
        <Input label={tr('name')} value={name} maxLength={80} onChange={(e) => (setName(e.target.value), setError(null))} error={error ?? undefined} />
        <div className="fr-field">
          <span className="fr-field__label">{tr('cursorColor')}</span>
          <ColorSwatches colors={CURSOR_COLORS} value={color} onChange={setColor} size={28} aria-label={tr('cursorColor')} />
        </div>
        <div className="fr-acct-form__row">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>{tr('saveProfile')}</Button>
        </div>
      </form>
    </SettingsSection>
  );
}
