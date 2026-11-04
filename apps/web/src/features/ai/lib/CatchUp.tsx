// "Catch me up" (#126): a short written summary of what OTHER people changed since your last visit
// or in the last 7, 14 or 30 days. The server builds it from the change set only (as you may see the
// board now) and it is shown to you alone; each point cites the items and frames it is about, which
// open on click. Putting it on the board is a separate choice: Insert (one undo step).
import { useState } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import { AI_CATCH_UP_SINCE, type AiActionResponse, type AiCatchUpSince } from '@freero/shared';
import type { PanelProps } from '@engine';
import { Button, Modal, SegmentedControl } from '@ui';
import { applyPreview, CATCH_UP_DIALOG } from './actions';

import { t } from '../messages';
const SINCE_LABEL: Record<string, string> = { visit: t('sinceMyLastVisit'), 7: 'Last 7 days', 14: 'Last 14 days', 30: 'Last 30 days' };
const OPTIONS = AI_CATCH_UP_SINCE.map((v) => ({ value: String(v), label: SINCE_LABEL[String(v)] }));
const asSince = (v: unknown): AiCatchUpSince => (v === 7 || v === 14 || v === 30 ? v : v === '7' || v === '14' || v === '30' ? (Number(v) as AiCatchUpSince) : 'visit');

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function CatchUpDialog({ editor, props }: PanelProps) {
  const ai = editor.host.ai;
  const [since, setSince] = useState<AiCatchUpSince>(asSince(props?.since));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Coming back from an item it cites: the same summary again, no new request.
  const [result, setResult] = useState<AiActionResponse | null>(props?.result && typeof props.result === 'object' ? (props.result as AiActionResponse) : null);
  const close = () => editor.closePanel(CATCH_UP_DIALOG);

  const run = async () => {
    if (!ai) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await ai.run({ task: 'catchup', since, target: 'preview', at: editor.getViewportCenter() }));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('theCatchUpCouldnT'));
    } finally {
      setBusy(false);
    }
  };

  /** Opens a cited item (or frame) on the board — the dialog steps aside, a toast brings it back. */
  const open = (id: string) => {
    if (!editor.getElement(id)) {
      editor.host.notify(t('thatItemIsnTOn'), 'info');
      return;
    }
    const kept = result;
    close();
    editor.select([id]);
    editor.zoomToFit([id], { animate: true, padding: 160, maxZoom: Math.max(1, editor.getCamera().zoom) });
    if (kept) editor.host.notify(t('showingItOnTheBoard'), 'info', { action: { label: t('backToTheCatchUp'), run: () => editor.openPanel(CATCH_UP_DIALOG, { result: kept }) } });
  };

  const insert = () => {
    if (!result) return;
    applyPreview(editor, result);
    close();
    editor.host.notify(t('catchUpAddedToThe'), 'success');
  };

  if (!ai) return null;
  const c = result?.catchUp;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-ai__title">
          <Sparkles size={18} aria-hidden />{' '}{t('catchMeUp2')}</span>
      }
      width={560}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)} disabled={busy}>{t('back')}</Button>
            <Button variant="secondary" onClick={insert} disabled={busy}>{t('insertOnBoard')}</Button>
            <Button variant="primary" onClick={close} data-autofocus>{t('done')}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => void run()} loading={busy}>{t('catchMeUp2')}</Button>
          </>
        )
      }
    >
      {result && c ? (
        <div className="fr-ai__result fr-ai-catchup">
          <p className="fr-ai__summary">{result.summary}</p>
          {c.points.length > 0 && (
            <ul className="fr-ai-catchup__points">
              {c.points.map((p, i) => (
                <li key={i}>
                  <span>{p.text}</span>
                  {p.ids.length > 0 && (
                    <span className="fr-ai-catchup__cites">
                      {p.ids.map((id) => {
                        const it = c.items[id];
                        if (!it) return null;
                        const label = `${it.kind === 'frame' ? 'Frame' : ''}${it.kind === 'frame' && it.text ? ': ' : ''}${clip(it.text || it.kind)}`;
                        return it.removed ? (
                          <span key={id} className="fr-ai-catchup__cite is-removed" title={t('removedSince')}>
                            {label}
                          </span>
                        ) : (
                          <button key={id} type="button" className="fr-ai-catchup__cite" onClick={() => open(id)} title={t('showItOnTheBoard')}>
                            {label} <ExternalLink size={11} aria-hidden />
                          </button>
                        );
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="fr-ai__fine">{t('onlyYouSeeThisInsert')}</p>
        </div>
      ) : (
        <div className="fr-ai__form">
          <SegmentedControl<string> aria-label={t('sinceWhen')} options={OPTIONS} value={String(since)} onChange={(v) => setSince(asSince(v))} className="fr-ai__tasks" />
          <p className="fr-ai__hint">{t('aShortWrittenSummaryOf')}</p>
          {error && (
            <p className="fr-ai__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-ai__fine">{t('whatChangedAsYouCan', { provider: ai.provider })}{' '}{ai.source === 'workspace' ? t('yourWorkspaceSAdmins') : t('thisFreeroServerSOperator')}. Board text is passed as data, never as
            instructions.
          </p>
        </div>
      )}
    </Modal>
  );
}
