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

const SINCE_LABEL: Record<string, string> = { visit: 'Since my last visit', 7: 'Last 7 days', 14: 'Last 14 days', 30: 'Last 30 days' };
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
      setError(e instanceof Error && e.message ? e.message : 'The catch-up couldn’t be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Opens a cited item (or frame) on the board — the dialog steps aside, a toast brings it back. */
  const open = (id: string) => {
    if (!editor.getElement(id)) {
      editor.host.notify('That item isn’t on the board any more.', 'info');
      return;
    }
    const kept = result;
    close();
    editor.select([id]);
    editor.zoomToFit([id], { animate: true, padding: 160, maxZoom: Math.max(1, editor.getCamera().zoom) });
    if (kept) editor.host.notify('Showing it on the board.', 'info', { action: { label: 'Back to the catch-up', run: () => editor.openPanel(CATCH_UP_DIALOG, { result: kept }) } });
  };

  const insert = () => {
    if (!result) return;
    applyPreview(editor, result);
    close();
    editor.host.notify('Catch-up added to the board. Undo takes it back.', 'success');
  };

  if (!ai) return null;
  const c = result?.catchUp;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-ai__title">
          <Sparkles size={18} aria-hidden /> Catch me up
        </span>
      }
      width={560}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)} disabled={busy}>
              Back
            </Button>
            <Button variant="secondary" onClick={insert} disabled={busy}>
              Insert on board
            </Button>
            <Button variant="primary" onClick={close} data-autofocus>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void run()} loading={busy}>
              Catch me up
            </Button>
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
                          <span key={id} className="fr-ai-catchup__cite is-removed" title="Removed since">
                            {label}
                          </span>
                        ) : (
                          <button key={id} type="button" className="fr-ai-catchup__cite" onClick={() => open(id)} title="Show it on the board">
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
          <p className="fr-ai__fine">Only you see this. Insert on board adds it as a note everyone sees (one step you can undo). AI can be wrong: check what it cites.</p>
        </div>
      ) : (
        <div className="fr-ai__form">
          <SegmentedControl<string> aria-label="Since when" options={OPTIONS} value={String(since)} onChange={(v) => setSince(asSince(v))} className="fr-ai__tasks" />
          <p className="fr-ai__hint">A short written summary of what other people added, changed, removed and commented on, with links to the items. Only you see it.</p>
          {error && (
            <p className="fr-ai__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-ai__fine">
            What changed (as you can see it) is sent to {ai.provider}, set up by {ai.source === 'workspace' ? 'your workspace’s admins' : 'this Freero server’s operator'}. Board text is passed as data, never as
            instructions.
          </p>
        </div>
      )}
    </Modal>
  );
}
