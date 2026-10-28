// Inline "name this version" field: Enter saves, Escape cancels.
import { useState } from 'react';
import { MAX_VERSION_NAME } from '@freero/shared';
import { Button, Input } from '@ui';

export function NameField({
  initial = '',
  placeholder,
  onSave,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  /** Resolves true when saved (the field closes), false to keep it open. */
  onSave(name: string): Promise<boolean>;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const name = value.replace(/\s+/g, ' ').trim();
  const save = async () => {
    if (!name || busy) return;
    setBusy(true);
    const ok = await onSave(name);
    setBusy(false);
    if (ok) onCancel();
  };
  return (
    <form
      className="fr-history-name"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        size="sm"
        autoFocus
        value={value}
        maxLength={MAX_VERSION_NAME}
        placeholder={placeholder}
        aria-label="Version name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="fr-history-name__actions">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!name} loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
