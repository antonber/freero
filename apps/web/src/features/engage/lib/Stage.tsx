// Presenter view (#40): one activity full screen — its question, the results growing live as the
// server publishes them, and the QR code of the answer link. A view on this screen only.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { richTextToPlain, useCollection, useElement, type PanelProps } from '@engine';
import { IconButton } from '@ui';
import { RESULTS, STAGE_DIALOG, answerLink, answersLabel, kindLabel } from './activity';
import { Body } from './Results';
import { QrCode } from './qr';

export function Stage({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const results = new Map(useCollection<ActivityResults>(RESULTS)).get(id);
  const close = () => editor.closePanel(STAGE_DIALOG);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      editor.closePanel(STAGE_DIALOG);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor]);
  if (!a || a.type !== 'activity') return null;
  const link = answerLink(editor.boardId, a.id, !!editor.host.engage);
  return (
    <div ref={root} className="fr-engage-stage" role="dialog" aria-modal="true" aria-label={`${kindLabel(a.kind)} full screen`} tabIndex={-1} style={{ ['--accent' as string]: a.color }}>
      <div className="fr-engage-stage__main">
        <div className="fr-engage-stage__kind">
          {kindLabel(a.kind)} · <span aria-live="polite">{answersLabel(a.kind, results)}</span>
          {a.closed ? ' · Closed' : ''}
        </div>
        <h1 className="fr-engage-stage__question">{richTextToPlain(a.question).trim() || 'Untitled activity'}</h1>
        <div className="fr-engage-stage__results">
          <Body a={a} r={results} />
        </div>
      </div>
      {!a.closed ? (
        <aside className="fr-engage-stage__join">
          <QrCode className="fr-engage-stage__qr" text={link} label="QR code of the answer link" />
          <p>Scan to answer</p>
          <code>{link.replace(/^https?:\/\//, '')}</code>
        </aside>
      ) : null}
      <IconButton className="fr-engage-stage__close" icon={X} label="Close full screen" shortcut="Esc" onClick={close} />
    </div>
  );
}
