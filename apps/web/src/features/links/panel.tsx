import { useState } from 'react';
import { Frame, Link2 } from 'lucide-react';
import type { FrameElement } from '@freero/shared';
import { definePanel, useElement, useElements, type PanelProps } from '@engine';
import { Button, Input, Modal } from '@ui';
import { LINK_DIALOG, normalizeLink } from './lib/link';

import { t } from './messages';
/** Edits one item's link: a web address, a pasted item link, or a frame to jump to. */
function LinkEditor({ editor, props }: PanelProps) {
  const id = String(props?.id ?? '');
  const el = useElement(id);
  const frames = (useElements('frame') as FrameElement[]).filter((f) => f.id !== id).sort((a, b) => a.index - b.index);
  const [value, setValue] = useState(() => el?.link ?? '');
  const [error, setError] = useState<string | null>(null);
  const close = () => editor.closePanel(LINK_DIALOG);
  if (!el) return null;

  const save = (input: string) => {
    const r = normalizeLink(input, { origin: window.location.origin, boardId: editor.boardId });
    if ('error' in r) return setError(r.error);
    if (r.link === `#${id}`) return setError(t('anItemCanTLink'));
    if ((r.link || null) !== (el.link ?? null)) editor.update(id, { link: r.link || null });
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title={el.link ? t('editLink') : t('addLink')}
      width={440}
      footer={
        <div className="fr-links-footer">
          {el.link && (
            <Button variant="ghost" onClick={() => save('')}>{t('removeLink')}</Button>
          )}
          <span className="fr-links-footer__spacer" />
          <Button variant="secondary" onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => save(value)}>{t('save')}</Button>
        </div>
      }
    >
      <form
        className="fr-links-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <Input
          data-autofocus=""
          icon={Link2}
          label={t('link')}
          placeholder="https://… or a copied item link"
          value={value}
          error={error ?? undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {frames.length > 0 && (
          <div className="fr-links-frames">
            <span className="fr-links-frames__label">{t('orJumpToAFrame')}</span>
            <div className="fr-links-frames__list">
              {frames.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="fr-links-frames__item"
                  aria-pressed={value === `#${f.id}`}
                  onClick={() => save(`#${f.id}`)}
                >
                  <Frame size={14} aria-hidden />
                  <span>{f.title || t('untitledFrame')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="fr-links-hint">{t('toLinkToAnyOther')}</p>
      </form>
    </Modal>
  );
}

export default definePanel({ id: LINK_DIALOG, slot: 'dialog', order: 50, Component: LinkEditor });
