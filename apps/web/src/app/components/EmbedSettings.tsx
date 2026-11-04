// "Embed on other sites" in the share dialog (#2; docs/integrations/embedding.md): the owner turns
// embedding on (the server refuses it where the workspace's policy is off), then anyone with the
// dialog copies the iframe code or the embed link — read-only or not, starting at a frame. What
// an embed shows always follows the sharing above it: it never lets more people in.
import { useEffect, useMemo, useState } from 'react';
import { Code2, Copy } from 'lucide-react';
import { boardEmbedCode, boardEmbedUrl, type BoardSummary, type OutlineItem } from '@freero/shared';
import { Button, Select, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { copyText } from '../lib/hooks';

import { t } from '../messages';
/** The board's frames (nested ones too), for "Start at". */
function framesOf(items: OutlineItem[], out: Array<{ id: string; title: string }> = []): Array<{ id: string; title: string }> {
  for (const it of items) {
    if (it.kind === 'frame') out.push({ id: it.id, title: it.title?.trim() || t('untitledFrame') });
    if (it.children) framesOf(it.children, out);
  }
  return out;
}

export function EmbedSettings({ board, onChange }: { board: BoardSummary; onChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  // Its owner and co-owners (#122) turn it on or off, like the link.
  const isOwner = board.permissions.manageSharing ?? board.role === 'owner';
  const on = board.embeddable === true;
  const allowed = board.permissions.boardEmbeds !== false;
  const [busy, setBusy] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [frame, setFrame] = useState('');
  const [frames, setFrames] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    api.boardOutline(board.id).then(
      ({ outline }) => !cancelled && setFrames(framesOf(outline.items)),
      () => undefined, // no outline (the workspace's downloads policy): the whole board only
    );
    return () => {
      cancelled = true;
    };
  }, [on, board.id]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const { board: updated } = await api.updateBoard(board.id, { embeddable: next });
      onChange(updated);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t('couldNotChangeEmbedding'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const opts = { readonly, frame: frame || null };
  const url = boardEmbedUrl(window.location.origin, board.id, opts);
  const code = boardEmbedCode(url, board.title);
  const frameOptions = useMemo<SelectOption<string>[]>(() => [{ value: '', label: t('wholeBoard') }, ...frames.map((f) => ({ value: f.id, label: f.title }))], [frames]);
  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    notify(ok ? t('whatCopied', { what }) : t('couldNotCopy'), ok ? 'success' : 'error');
  };
  // What the embed shows follows the sharing above: say who that is.
  const who =
    board.linkAccess === 'none'
      ? t('onlyPeopleWithAccessAfter')
      : board.permissions.guestLinks && !board.linkProtection?.password
        ? t('anyoneCanViewItPeople')
        : t('peopleSignInToSee');

  return (
    <section className="fr-share__embed" aria-label={t('embedOnOtherSites')}>
      <div className="fr-share__link">
        <span className={`fr-share__link-icon${on ? ' fr-share__link-icon--open' : ''}`}>
          <Code2 size={17} aria-hidden />
        </span>
        <div className="fr-share__who">
          <span className="fr-share__name">{t('embedOnOtherSites')}</span>
          <span className="fr-share__email-text">{!allowed && !on ? (board.label?.caps.boardEmbeds === 'off' ? t('turnedOffByItsLabel', { name: board.label.name }) : t('turnedOffInThisWorkspace')) : on ? who : t('showTheLiveBoardIn')}</span>
        </div>
        {isOwner ? (
          <Toggle aria-label={t('allowEmbeddingOnOtherSites')} checked={on} disabled={busy || (!allowed && !on)} onChange={(v) => void toggle(v)} />
        ) : (
          <span className="fr-share__role">{on ? t('on') : t('off')}</span>
        )}
      </div>
      {on ? (
        <div className="fr-share__embed-options">
          <div className="fr-share__embed-row">
            <Toggle size="sm" checked={readonly} onChange={setReadonly} label={t('viewOnly')} />
            {frameOptions.length > 1 ? <Select<string> aria-label={t('startAt')} size="sm" options={frameOptions} value={frame} onChange={setFrame} width={200} /> : null}
          </div>
          <textarea className="fr-share__embed-code" readOnly value={code} aria-label={t('embedCode')} rows={3} onFocus={(e) => e.currentTarget.select()} />
          <div className="fr-share__embed-row">
            <Button size="sm" variant="primary" icon={Copy} onClick={() => void copy(code, t('embedCode'))}>{t('copyEmbedCode')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void copy(url, t('embedLink'))}>{t('copyEmbedLink')}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
