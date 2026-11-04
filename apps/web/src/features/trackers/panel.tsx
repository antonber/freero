// The tracker dialogs. Send: pick a connection and project, see EXACTLY what the issue will hold
// (the server's own preview, fields it can't carry listed), create it. Import: a query in the
// tracker's own language becomes linked cards — or (#119, #43) a project's sprint or an epic's
// issues, picked rather than written. The server writes the board (badges, cards) as one change
// attributed to the tracker for this person; the dialogs never write the board themselves.
import { useEffect, useMemo, useState } from 'react';
import { Download, TicketPlus } from 'lucide-react';
import {
  ISSUE_FIELD_LABELS,
  richTextToPlain,
  TRACKER_PROVIDERS,
  type IssueValues,
  type RoadmapGroupBy,
  type TrackerIssuePreview,
  type TrackerProject,
  type TrackerProviderKind,
  type TrackerSprint,
} from '@freero/shared';
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
/** What a tracker calls its sprints (#119); none: it has none Freero imports by. */
const SPRINT_NAME: Partial<Record<TrackerProviderKind, string>> = { jira: 'Sprint', linear: 'Cycle', azure: 'Iteration', github: 'Iteration' };
/** What a tracker calls the issue others go under (#43); none: not from Freero (GitHub). */
const PARENT_NAME: Partial<Record<TrackerProviderKind, string>> = { jira: 'Epic', linear: 'Parent issue', azure: 'Parent work item', asana: 'Parent task', monday: 'Parent item', clickup: 'Parent task', github: 'Parent issue' };
/** What a tracker's project is called where it isn't one (#120, #121). */
const PROJECT_NAME: Partial<Record<TrackerProviderKind, string>> = { github: 'Repository', linear: 'Team', monday: 'Board', clickup: 'List', trello: 'Board' };
/** A parent's key, as people find it in each tracker. */
const PARENT_HINT: Partial<Record<TrackerProviderKind, string>> = { azure: '#12', linear: 'ENG-12', asana: 'Task id or link', monday: 'Item id', clickup: 'Task id or link', github: '#12 or owner/name#12' };
/** Trackers whose whole project (board, List) can be imported without a query (#120, #121, #180). */
const WHOLE_PROJECT: ReadonlySet<TrackerProviderKind> = new Set(['asana', 'monday', 'clickup', 'trello']);
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** The connection picker and its projects, shared by both dialogs. */
function useConnection(editor: Editor) {
  const t = editor.host.trackers;
  const [connectionId, setConnectionId] = useState(t?.connections[0]?.id ?? '');
  const connection = t?.connections.find((c) => c.id === connectionId) ?? null;
  const [projects, setProjects] = useState<TrackerProject[] | null>(null);
  const [queryLanguage, setQueryLanguage] = useState('');
  const [project, setProject] = useState('');
  // Which connection `projects` / `project` belong to (a switch shows the old ones for a moment).
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!t || !connectionId) return;
    let live = true;
    setProjects(null);
    t.projects(connectionId).then(
      (r) => {
        if (!live) return;
        setProjects(r.projects);
        setLoadedFor(connectionId);
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
    /** The project is one of this connection's (safe to ask the tracker about). */
    projectReady: loadedFor === connectionId && !!projects?.some((p) => p.key === project),
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
          <span className="fr-trackers-dialog__label">{(c.connection && PROJECT_NAME[c.connection.provider]) ?? projectLabel}</span>
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
  if (values.status) rows.push([ISSUE_FIELD_LABELS.status, values.statusName ? `${STATUS_LABEL[values.status] ?? values.status} · column “${values.statusName}”` : (STATUS_LABEL[values.status] ?? values.status)]);
  if (values.priority) rows.push([ISSUE_FIELD_LABELS.priority, values.priority]);
  if (values.assignee) rows.push([ISSUE_FIELD_LABELS.assignee, values.assignee]);
  if (values.dueDate) rows.push([ISSUE_FIELD_LABELS.dueDate, values.dueDate]);
  if (values.estimate !== undefined && values.estimate !== null) rows.push([ISSUE_FIELD_LABELS.estimate, String(values.estimate)]);
  if (values.sprint) rows.push([ISSUE_FIELD_LABELS.sprint, values.sprint]);
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

/** The issue types of the project (#43): a picker, the connection's preferred one first. */
function useIssueTypes(editor: Editor, connectionId: string, project: string, wanted: boolean) {
  const [types, setTypes] = useState<{ issueTypes: string[]; preferred: string | null } | null>(null);
  useEffect(() => {
    const t = editor.host.trackers;
    setTypes(null);
    if (!wanted || !t?.issueTypes || !connectionId || !project) return;
    let live = true;
    t.issueTypes(connectionId, project).then(
      (r) => live && setTypes(r),
      () => live && setTypes({ issueTypes: [], preferred: null }),
    );
    return () => {
      live = false;
    };
  }, [editor, connectionId, project, wanted]);
  return types;
}

function SendDialog({ editor, props }: PanelProps) {
  const ids = useMemo(() => (Array.isArray(props?.ids) ? (props.ids as unknown[]).filter((v): v is string => typeof v === 'string') : []), [props]);
  const c = useConnection(editor);
  const [mode, setMode] = useState<'one' | 'each' | 'clusters'>('one');
  const [issueType, setIssueType] = useState('');
  const [parent, setParent] = useState('');
  const [preview, setPreview] = useState<TrackerIssuePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => editor.closePanel(SEND_DIALOG);
  const provider = c.connection?.provider;
  const parentName = provider ? PARENT_NAME[provider] : undefined;
  const typed = provider === 'jira' || provider === 'azure';
  const types = useIssueTypes(editor, c.connectionId, c.project, typed && c.projectReady);
  useEffect(() => {
    if (!parentName && mode === 'clusters') setMode('one');
  }, [parentName, mode]);
  const request = {
    connectionId: c.connectionId,
    project: c.project,
    itemIds: ids,
    mode,
    ...(issueType.trim() ? { issueType: issueType.trim() } : {}),
    ...(parent.trim() && mode !== 'clusters' && parentName ? { parent: parent.trim() } : {}),
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
        out.parent
          ? `Created ${out.parent.key} with ${plural(out.issues.length, 'issue')} under it`
          : out.issues.length === 1
            ? `Created ${first.key} for ${plural(first.itemIds.length, 'item')}`
            : `Created ${plural(out.issues.length, 'issue')}`,
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
  const count = mode === 'each' ? ids.length : mode === 'clusters' ? (preview?.length ?? 1) : 1;
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
            <div style={parentName ? { flexBasis: '100%' } : undefined}>
              <span className="fr-trackers-dialog__label">Issues</span>
              <SegmentedControl<'one' | 'each' | 'clusters'>
                aria-label="How many issues"
                size="sm"
                options={[
                  { value: 'one', label: 'One for all' },
                  { value: 'each', label: `One per item (${ids.length})` },
                  ...(parentName ? [{ value: 'clusters' as const, label: 'One per cluster' }] : []),
                ]}
                value={mode}
                onChange={setMode}
              />
            </div>
          )}
          {typed && (
            <div>
              <span className="fr-trackers-dialog__label">{provider === 'azure' ? 'Work item type' : 'Issue type'}</span>
              {types?.issueTypes.length ? (
                <Select
                  aria-label="Issue type"
                  options={types.issueTypes.map((t) => ({ value: t, label: t }))}
                  value={issueType || (types.preferred && types.issueTypes.includes(types.preferred) ? types.preferred : types.issueTypes.includes('Task') ? 'Task' : types.issueTypes[0])}
                  onChange={setIssueType}
                  width="100%"
                />
              ) : (
                <Input aria-label="Issue type" value={issueType} placeholder={types?.preferred ?? c.connection?.defaults.issueType ?? 'Task'} onChange={(e) => setIssueType(e.target.value)} />
              )}
            </div>
          )}
          {parentName && mode !== 'clusters' && (
            <div>
              <span className="fr-trackers-dialog__label">Under (optional)</span>
              <Input aria-label={parentName} value={parent} placeholder={(provider && PARENT_HINT[provider]) ?? 'WEB-12'} onChange={(e) => setParent(e.target.value)} />
            </div>
          )}
        </div>
        <p className="fr-trackers-dialog__hint">
          {mode === 'clusters'
            ? `A new ${parentName === 'Epic' ? 'epic' : 'parent'} for the ${plural(ids.length, 'selected item')}, with an issue under it for each cluster of items close together.`
            : mode === 'one' && ids.length > 1
              ? `One issue for the ${plural(ids.length, 'selected item')}, each listed with a link back to the board.`
              : 'Each item becomes an issue with a link back to the board.'}{' '}
          The items show the issue and stay in sync with it.
        </p>
        {preview ? (
          <div className="fr-trackers-preview" aria-label="What will be sent">
            {preview.map((p, n) => (
              <div key={p.itemIds.join(',') || `parent-${n}`} className="fr-trackers-preview__issue">
                <p className="fr-trackers-preview__title">
                  {mode === 'clusters' && !p.itemIds.length ? `${parentName ?? 'Parent'}: ` : ''}
                  {p.values.title}
                </p>
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
  azure: "e.g. SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Fabrikam'",
  asana: 'e.g. project:Launch section:"In progress" assignee:me',
  monday: 'e.g. board:Roadmap group:"This week" status:"Working on it"',
  clickup: 'e.g. list:Sprint status:"in review" assignee:me tag:web',
  trello: 'e.g. board:Launch list:"Doing" member:me label:web',
};

const GROUP_BY: Array<{ value: RoadmapGroupBy; label: string }> = [
  { value: 'epic', label: 'Epic' },
  { value: 'team', label: 'Team' },
  { value: 'label', label: 'Label' },
  { value: 'none', label: 'One lane' },
];

type ImportBy = 'query' | 'project' | 'sprint' | 'epic';

/** A project's sprints for the picker (#119): the current one first, closed ones shown but not picked. */
function useSprints(editor: Editor, connectionId: string, project: string, wanted: boolean) {
  const [sprints, setSprints] = useState<TrackerSprint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = editor.host.trackers;
    setSprints(null);
    setError(null);
    if (!wanted || !t?.sprints || !connectionId || !project) return;
    let live = true;
    t.sprints(connectionId, project).then(
      (r) => live && setSprints(r.sprints),
      (e) => live && (setSprints([]), setError(message(e, 'The tracker didn’t list its sprints.'))),
    );
    return () => {
      live = false;
    };
  }, [editor, connectionId, project, wanted]);
  return { sprints, error };
}

function ImportDialog({ editor, props }: PanelProps) {
  const c = useConnection(editor);
  const [query, setQuery] = useState('');
  const [by, setBy] = useState<ImportBy>('query');
  const [sprint, setSprint] = useState('current');
  const [epic, setEpic] = useState('');
  const [busy, setBusy] = useState(false);
  const provider = c.connection?.provider;
  const sprintName = provider ? SPRINT_NAME[provider] : undefined;
  const parentName = provider ? PARENT_NAME[provider] : undefined;
  const s = useSprints(editor, c.connectionId, c.project, by === 'sprint' && !!sprintName && c.projectReady);
  useEffect(() => {
    if ((by === 'sprint' && !sprintName) || (by === 'epic' && !parentName) || (by === 'project' && !(provider && WHOLE_PROJECT.has(provider)))) setBy('query');
  }, [by, sprintName, parentName, provider]);
  const ready = by === 'query' ? !!query.trim() : by === 'project' ? !!c.project : by === 'sprint' ? !!c.project && !!sprint : !!c.project && !!epic.trim();
  // Roadmap mode (KAI-160): opened on a timeline, the issues become its bars, in lanes.
  const timeline = useMemo(() => {
    const el = typeof props?.timelineId === 'string' ? editor.getElement(props.timelineId) : undefined;
    return el?.type === 'timeline' ? el : null;
  }, [editor, props]);
  // Opened on a kanban: the issues go into it, each in the column named after its status.
  const kanban = useMemo(() => {
    const el = typeof props?.kanbanId === 'string' ? editor.getElement(props.kanbanId) : undefined;
    return el?.type === 'kanban' ? el : null;
  }, [editor, props]);
  const kanbanTitle = kanban ? richTextToPlain(String((kanban as { title?: string }).title ?? '')) || 'the kanban' : '';
  const [groupBy, setGroupBy] = useState<RoadmapGroupBy>('epic');
  const close = () => editor.closePanel(IMPORT_DIALOG);
  const run = async () => {
    if (!c.t || !ready) return;
    setBusy(true);
    c.setError(null);
    try {
      const out = await c.t.importIssues({
        connectionId: c.connectionId,
        ...(by === 'query' ? { query: query.trim() } : { scope: { project: c.project, ...(by === 'sprint' ? { sprint } : by === 'epic' ? { epic: epic.trim() } : {}) } }),
        ...(timeline ? { timeline: { id: timeline.id, groupBy } } : {}),
        ...(kanban ? { placement: { into: kanban.id } } : {}),
      });
      close();
      const where = timeline ? ` onto the timeline${out.unscheduled ? ` (${out.unscheduled} without dates in Unscheduled)` : ''}` : kanban ? ` into “${kanbanTitle}”` : ' as cards';
      editor.host.notify(
        out.created.length
          ? `Imported ${plural(out.created.length, 'issue')}${where}${out.skipped ? ` (${out.skipped} already here)` : ''}`
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
            editor.zoomToFit(timeline ? [timeline.id, ...out.created] : out.created, { animate: true });
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
          <Download size={18} aria-hidden /> {timeline ? 'Import issues onto the timeline' : kanban ? 'Import issues into the kanban' : 'Import issues'}
        </span>
      }
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={!ready}>
            Import
          </Button>
        </>
      }
    >
      <div className="fr-trackers-dialog">
        <ConnectionFields c={c} withProject={by !== 'query'} />
        {(sprintName || parentName || (provider && WHOLE_PROJECT.has(provider))) && (
          <div className="fr-trackers-dialog__row">
            <span className="fr-trackers-dialog__label">Bring in</span>
            <SegmentedControl<ImportBy>
              size="sm"
              aria-label="Bring in"
              value={by}
              options={[
                { value: 'query', label: c.queryLanguage || 'Query' },
                ...(provider && WHOLE_PROJECT.has(provider) ? [{ value: 'project' as const, label: provider === 'monday' || provider === 'trello' ? 'A board' : provider === 'clickup' ? 'A List' : 'A project' }] : []),
                ...(sprintName ? [{ value: 'sprint' as const, label: `A ${sprintName.toLowerCase()}` }] : []),
                ...(parentName ? [{ value: 'epic' as const, label: parentName === 'Epic' ? 'An epic' : `A ${parentName.toLowerCase()}` }] : []),
              ]}
              onChange={setBy}
            />
          </div>
        )}
        {by === 'query' && (
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
        )}
        {by === 'sprint' && sprintName && (
          <div>
            <span className="fr-trackers-dialog__label">{sprintName}</span>
            <Select
              aria-label={sprintName}
              width="100%"
              value={sprint}
              options={[
                { value: 'current', label: `Current ${sprintName.toLowerCase()}`, description: s.sprints?.find((x) => x.state === 'active')?.name ?? (s.sprints ? 'None is active' : 'Loading…') },
                ...[...(s.sprints ?? [])].reverse().map((x) => ({
                  value: x.id,
                  label: x.name,
                  description: x.state === 'active' ? 'Now' : x.state === 'closed' ? 'Closed' : x.startDate ? `Starts ${x.startDate}` : 'Upcoming',
                })),
              ]}
              onChange={setSprint}
            />
            {s.error && (
              <p className="fr-trackers-dialog__error" role="alert">
                {s.error}
              </p>
            )}
          </div>
        )}
        {by === 'epic' && parentName && (
          <Input label={`${parentName} key`} value={epic} placeholder={(provider && PARENT_HINT[provider]) ?? 'WEB-12'} onChange={(e) => setEpic(e.target.value)} />
        )}
        {timeline && (
          <div className="fr-trackers-dialog__row">
            <span className="fr-trackers-dialog__label">Lanes by</span>
            <SegmentedControl<RoadmapGroupBy> size="sm" aria-label="Lanes by" value={groupBy} options={GROUP_BY} onChange={setGroupBy} />
          </div>
        )}
        <p className="fr-trackers-dialog__fine">
          {timeline
            ? `Each issue becomes a bar on “${richTextToPlain(String((timeline as { title?: string }).title ?? '')) || 'the timeline'}” at its start and due dates, linked to it: moving a bar changes the issue’s dates, and dates changed in the tracker move the bar. Issues without dates wait in an “Unscheduled” frame below. Up to 50 at a time.`
            : kanban
              ? `Each issue becomes a card in “${kanbanTitle}”, linked to it: in the column named after its status (else one of its kind, else a new column), with its priority in a Priority field${sprintName ? ` and its ${sprintName.toLowerCase()} in a ${sprintName} field (the project’s ${sprintName.toLowerCase()}s as options; closed ones can’t be picked)` : ''}. Moving a card or changing its fields updates the issue. Up to 50 at a time.`

              : 'Each issue becomes a task card linked to it (up to 50 at a time). Issues already on this board are left out.'}
        </p>
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
