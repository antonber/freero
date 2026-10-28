// The tracker dialogs. Send: pick a connection and project, see EXACTLY what the issue will hold
// (the server's own preview, fields it can't carry listed), create it. Import: a query in the
// tracker's own language becomes linked cards. The server writes the board (badges, cards) as one
// change attributed to the tracker for this person; the dialogs never write the board themselves.
import { useEffect, useMemo, useState } from 'react';
import { Download, TicketPlus } from 'lucide-react';
import { ISSUE_FIELD_LABELS, TRACKER_PROVIDERS, type IssueValues, type TrackerIssuePreview, type TrackerProject } from '@freero/shared';
import { definePanel, type Editor, type PanelProps } from '@engine';
import { Button, Input, Modal, SegmentedControl, Select, TextArea } from '@ui';
import { IMPORT_DIALOG, openIssue, SEND_DIALOG } from './lib/links';
import './trackers.css';

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** The connection picker and its projects, shared by both dialogs. */
function useConnection(editor: Editor) {
  const t = editor.host.trackers;
  const [connectionId, setConnectionId] = useState(t?.connections[0]?.id ?? '');
  const connection = t?.connections.find((c) => c.id === connectionId) ?? null;
  const [projects, setProjects] = useState<TrackerProject[] | null>(null);
  const [queryLanguage, setQueryLanguage] = useState('');
  const [project, setProject] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!t || !connectionId) return;
    let live = true;
    setProjects(null);
    t.projects(connectionId).then(
      (r) => {
        if (!live) return;
        setProjects(r.projects);
        setQueryLanguage(r.queryLanguage);
        const preferred = t.connections.find((c) => c.id === connectionId)?.defaults.project;
        setProject(preferred && r.projects.some((p) => p.key === preferred) ? preferred : (r.projects[0]?.key ?? preferred ?? ''));
      },
      (e) => live && (setProjects([]), setError(message(e, 'The tracker didn’t list its projects.'))),
    );
    return () => {
      live = false;
    };
  }, [t, connectionId]);
  return {
    t,
    connection,
    connectionId,
    setConnectionId,
    projects,
    project,
    setProject,
    queryLanguage,
    error,
    setError,
  };
}

function ConnectionFields({ c, projectLabel = 'Project', withProject = true }: { c: ReturnType<typeof useConnection>; projectLabel?: string; withProject?: boolean }) {
  const options = (c.t?.connections ?? []).map((x) => ({
    value: x.id,
    label: x.name,
    description: `${TRACKER_PROVIDERS[x.provider]} · ${x.scope === 'personal' ? 'yours' : 'your team’s'}`,
  }));
  return (
    <div className="fr-trackers-dialog__row">
      <div>
        <span className="fr-trackers-dialog__label">Tracker</span>
        <Select aria-label="Tracker" options={options} value={c.connectionId} onChange={c.setConnectionId} width="100%" />
      </div>
      {withProject && (
        <div>
          <span className="fr-trackers-dialog__label">{c.connection?.provider === 'github' ? 'Repository' : c.connection?.provider === 'linear' ? 'Team' : projectLabel}</span>
          {c.projects?.length ? (
            <Select
              aria-label={projectLabel}
              options={c.projects.map((p) => ({
                value: p.key,
                label: p.key === p.name ? p.key : `${p.name} (${p.key})`,
              }))}
              value={c.project}
              onChange={c.setProject}
              width="100%"
            />
          ) : (
            <Input aria-label={projectLabel} value={c.project} placeholder={c.projects === null ? 'Loading…' : 'Key'} onChange={(e) => c.setProject(e.target.value)} />
          )}
        </div>
      )}
    </div>
  );
}

/** The description as the issue will read it: links shown by their label (they point back here). */
function Description({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g);
  return (
    <p className="fr-trackers-preview__desc">
      {parts.map((p, i) => {
        const m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(p);
        return m ? (
          <span key={i} className="fr-trackers-preview__link" title={m[2]}>
            {m[1]}
          </span>
        ) : (
          p
        );
      })}
    </p>
  );
}

function Fields({ values }: { values: IssueValues }) {
  const rows: Array<[string, string]> = [];
  if (values.labels?.length) rows.push([ISSUE_FIELD_LABELS.labels, values.labels.join(', ')]);
  if (values.status) rows.push([ISSUE_FIELD_LABELS.status, STATUS_LABEL[values.status] ?? values.status]);
  if (values.assignee) rows.push([ISSUE_FIELD_LABELS.assignee, values.assignee]);
  if (values.dueDate) rows.push([ISSUE_FIELD_LABELS.dueDate, values.dueDate]);
  if (values.estimate !== undefined && values.estimate !== null) rows.push([ISSUE_FIELD_LABELS.estimate, String(values.estimate)]);
  if (!rows.length) return null;
  return (
    <dl className="fr-trackers-preview__fields">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SendDialog({ editor, props }: PanelProps) {
  const ids = useMemo(() => (Array.isArray(props?.ids) ? (props.ids as unknown[]).filter((v): v is string => typeof v === 'string') : []), [props]);
  const c = useConnection(editor);
  const [mode, setMode] = useState<'one' | 'each'>('one');
  const [issueType, setIssueType] = useState('');
  const [preview, setPreview] = useState<TrackerIssuePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => editor.closePanel(SEND_DIALOG);
  const request = {
    connectionId: c.connectionId,
    project: c.project,
    itemIds: ids,
    mode,
    ...(issueType.trim() ? { issueType: issueType.trim() } : {}),
  };

  useEffect(() => {
    if (!c.t || !c.connectionId || !ids.length) return;
    let live = true;
    setPreview(null);
    c.t
      .preview({
        connectionId: c.connectionId,
        project: c.project,
        itemIds: ids,
        mode,
      })
      .then(
        (p) => live && (setPreview(p), c.setError(null)),
        (e) => live && c.setError(message(e, 'Freero couldn’t prepare the issue.')),
      );
    return () => {
      live = false;
    };
    // c.setError is a state setter (stable); the preview depends only on what would be sent.
  }, [c.t, c.connectionId, c.project, ids, mode]);

  const send = async () => {
    if (!c.t || !c.project.trim()) return;
    setBusy(true);
    c.setError(null);
    try {
      const out = await c.t.send(request);
      close();
      const first = out.issues[0];
      editor.host.notify(
        out.issues.length === 1 ? `Created ${first.key} for ${plural(first.itemIds.length, 'item')}` : `Created ${plural(out.issues.length, 'issue')}`,
        'success',
        first ? { action: { label: 'Open', run: () => openIssue(first.url) } } : undefined,
      );
    } catch (e) {
      c.setError(message(e, 'The tracker didn’t create the issue.'));
    } finally {
      setBusy(false);
    }
  };

  if (!c.t) return null;
  const count = mode === 'each' ? ids.length : 1;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-trackers-dialog__title">
          <TicketPlus size={18} aria-hidden /> Send to tracker
        </span>
      }
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!preview || !c.project.trim()} data-autofocus>
            {count === 1 ? 'Create issue' : `Create ${count} issues`}
          </Button>
        </>
      }
    >
      <div className="fr-trackers-dialog">
        <ConnectionFields c={c} />
        <div className="fr-trackers-dialog__row">
          {ids.length > 1 && (
            <div>
              <span className="fr-trackers-dialog__label">Issues</span>
              <SegmentedControl<'one' | 'each'>
                aria-label="How many issues"
                size="sm"
                options={[
                  { value: 'one', label: 'One for all' },
                  { value: 'each', label: `One per item (${ids.length})` },
                ]}
                value={mode}
                onChange={setMode}
              />
            </div>
          )}
          {c.connection?.provider === 'jira' && (
            <div>
              <span className="fr-trackers-dialog__label">Issue type</span>
              <Input aria-label="Issue type" value={issueType} placeholder={c.connection.defaults.issueType ?? 'Task'} onChange={(e) => setIssueType(e.target.value)} />
            </div>
          )}
        </div>
        <p className="fr-trackers-dialog__hint">
          {mode === 'one' && ids.length > 1
            ? `One issue for the ${plural(ids.length, 'selected item')}, each listed with a link back to the board.`
            : 'Each item becomes an issue with a link back to the board.'}{' '}
          The items show the issue and stay in sync with it.
        </p>
        {preview ? (
          <div className="fr-trackers-preview" aria-label="What will be sent">
            {preview.map((p) => (
              <div key={p.itemIds.join(',')} className="fr-trackers-preview__issue">
                <p className="fr-trackers-preview__title">{p.values.title}</p>
                {p.values.description && <Description text={p.values.description} />}
                <Fields values={p.values} />
                {p.unmapped.length > 0 && (
                  <ul className="fr-trackers-preview__unmapped" aria-label="Not sent">
                    {p.unmapped.map((u) => (
                      <li key={u}>Not sent: {u}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          !c.error && <p className="fr-trackers-dialog__fine">Preparing the preview…</p>
        )}
        {c.error && (
          <p className="fr-trackers-dialog__error" role="alert">
            {c.error}
          </p>
        )}
      </div>
    </Modal>
  );
}

const QUERY_HINT: Record<string, string> = {
  jira: 'e.g. project = WEB AND sprint in openSprints()',
  linear: 'e.g. onboarding',
  github: 'e.g. repo:acme/web is:open label:bug',
};

function ImportDialog({ editor }: PanelProps) {
  const c = useConnection(editor);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => editor.closePanel(IMPORT_DIALOG);
  const run = async () => {
    if (!c.t || !query.trim()) return;
    setBusy(true);
    c.setError(null);
    try {
      const out = await c.t.importIssues({
        connectionId: c.connectionId,
        query: query.trim(),
      });
      close();
      editor.host.notify(
        out.created.length
          ? `Imported ${plural(out.created.length, 'issue')} as cards${out.skipped ? ` (${out.skipped} already here)` : ''}`
          : out.skipped
            ? `Those ${plural(out.skipped, 'issue')} are already on this board`
            : 'No issues matched',
        out.created.length ? 'success' : 'info',
      );
      if (out.created.length) {
        // The cards arrive over the board's socket: show them once they are here.
        const show = (tries: number) => {
          if (out.created.every((id) => editor.getElement(id)) || tries > 40) {
            editor.select(out.created.filter((id) => editor.getElement(id)));
            editor.zoomToFit(out.created, { animate: true });
          } else setTimeout(() => show(tries + 1), 50);
        };
        show(0);
      }
    } catch (e) {
      c.setError(message(e, 'The tracker didn’t answer the search.'));
    } finally {
      setBusy(false);
    }
  };
  if (!c.t) return null;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-trackers-dialog__title">
          <Download size={18} aria-hidden /> Import issues
        </span>
      }
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={!query.trim()}>
            Import
          </Button>
        </>
      }
    >
      <div className="fr-trackers-dialog">
        <ConnectionFields c={c} withProject={false} />
        <TextArea
          label={c.queryLanguage || 'Query'}
          value={query}
          rows={3}
          maxLength={2000}
          placeholder={QUERY_HINT[c.connection?.provider ?? 'jira']}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
          }}
        />
        <p className="fr-trackers-dialog__fine">Each issue becomes a task card linked to it (up to 50 at a time). Issues already on this board are left out.</p>
        {c.error && (
          <p className="fr-trackers-dialog__error" role="alert">
            {c.error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default [
  definePanel({
    id: SEND_DIALOG,
    slot: 'dialog',
    order: 61,
    minRole: 'editor',
    Component: SendDialog,
  }),
  definePanel({
    id: IMPORT_DIALOG,
    slot: 'dialog',
    order: 62,
    minRole: 'editor',
    Component: ImportDialog,
  }),
];
