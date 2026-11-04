// A connection's field map (#43), for the people who manage it: which tracker fields hold story
// points and the start date, the issue type per project, and custom fields paired with kanban
// fields by name ("Team" on any kanban ↔ the tracker's Team field). Values sync both ways like the
// built-in fields; a kanban without a field of that name holds none, so nothing is sent or cleared.
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FieldMapEntry, type TrackerConnectionInfo, type TrackerFieldInfo, type TrackerFieldMapSettings } from '@freero/shared';
import { Button, Input, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../api/client';

const KIND_LABEL: Record<FieldMapEntry['type'], string> = {
  select: 'Single select',
  multiselect: 'Multi-select',
  number: 'Number',
  date: 'Date',
  text: 'Text',
  person: 'Person',
};

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message || fallback : fallback);

export function TrackerFieldMap({ connection, onSaved }: { connection: TrackerConnectionInfo; onSaved: (c: TrackerConnectionInfo) => void }) {
  const notify = useToast();
  const [fields, setFields] = useState<TrackerFieldInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initial: TrackerFieldMapSettings = connection.fieldMap ?? { estimateField: null, startDateField: null, issueTypes: {}, fields: [] };
  const [estimate, setEstimate] = useState(initial.estimateField ?? '');
  const [start, setStart] = useState(initial.startDateField ?? '');
  const [types, setTypes] = useState<Array<{ project: string; type: string }>>(Object.entries(initial.issueTypes).map(([project, type]) => ({ project, type })));
  const [map, setMap] = useState<FieldMapEntry[]>(initial.fields);
  const [planning, setPlanning] = useState(initial.planningProject ?? '');
  const [busy, setBusy] = useState(false);
  // Custom fields: every tracker with its own (#43, #120, #121; GitHub: its planning Project's, #42);
  // story points and start date: Jira, Azure DevOps and a GitHub Project; issue types: Jira and Azure DevOps.
  const github = connection.provider === 'github';
  const custom = connection.provider !== 'linear';
  const typed = connection.provider === 'jira' || connection.provider === 'azure';
  const pointed = typed || github;

  useEffect(() => {
    if (!custom) return setFields([]);
    let live = true;
    api.trackerFields(connection.id).then(
      (r) => live && setFields(r.fields),
      (e) => live && (setFields([]), setError(errorText(e, 'The tracker didn’t list its fields'))),
    );
    return () => {
      live = false;
    };
  }, [connection.id, custom]);

  const mappable = (fields ?? []).filter((f) => f.type);
  const pick = (kind: FieldMapEntry['type'] | 'any', current: string) => [
    { value: '', label: 'None' },
    ...mappable.filter((f) => kind === 'any' || f.type === kind).map((f) => ({ value: f.id, label: f.name, description: f.id })),
    ...(current && !mappable.some((f) => f.id === current) ? [{ value: current, label: current }] : []),
  ];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.updateTrackerConnection(connection.id, {
        fieldMap: {
          ...(pointed ? { estimateField: estimate || null, startDateField: start || null } : {}),
          ...(github ? { planningProject: planning.trim() || null } : {}),
          issueTypes: Object.fromEntries(types.filter((t) => t.project.trim() && t.type.trim()).map((t) => [t.project.trim(), t.type.trim()])),
          ...(custom ? { fields: map.filter((m) => m.tracker && m.board.trim()) } : {}),
        },
      });
      onSaved(out.connection);
      notify('Field map saved', 'success');
    } catch (e) {
      setError(errorText(e, 'Could not save the field map'));
    } finally {
      setBusy(false);
    }
  };

  if (!fields) return <Spinner />;
  return (
    <div className="fr-trackerconn__map" aria-label={`Field map of ${connection.name}`}>
      {github && (
        <div className="fr-trackerconn__grid">
          <Input
            label="Planning Project (owner/number, e.g. acme/3)"
            value={planning}
            placeholder="acme/3"
            onChange={(e) => setPlanning(e.target.value)}
          />
          <p className="fr-trackerconn__fine">
            Its Status, estimate, Iteration, Start date and Target date fields sync (found by name; save, then reopen to pick others). New issues join it. Without a Target date field, due dates are milestones’.
          </p>
        </div>
      )}
      {pointed && (
        <div className="fr-trackerconn__grid">
          <label>
            <span>{github ? 'Estimate (a number field)' : 'Story points (a card’s estimate)'}</span>
            <Select aria-label="Story points field" options={pick('number', estimate)} value={estimate} onChange={setEstimate} width="100%" />
          </label>
          <label>
            <span>Start date</span>
            <Select aria-label="Start date field" options={pick('date', start)} value={start} onChange={setStart} width="100%" />
          </label>
        </div>
      )}
      {typed && (
        <div className="fr-trackerconn__maprows">
          <span className="fr-trackerconn__maphead">Issue type per project (else {connection.defaults.issueType ?? 'Task'})</span>
          {types.map((t, i) => (
            <div key={i} className="fr-trackerconn__maprow">
              <Input aria-label="Project key" placeholder="Project key" value={t.project} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, project: e.target.value } : x)))} />
              <Input aria-label="Issue type" placeholder="Story" value={t.type} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={() => setTypes(types.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setTypes([...types, { project: '', type: '' }])}>
            Add a project
          </Button>
        </div>
      )}
      {custom && (
        <div className="fr-trackerconn__maprows">
          <span className="fr-trackerconn__maphead">Custom fields ↔ kanban fields (by the kanban field’s name)</span>
          {map.map((m, i) => (
            <div key={i} className="fr-trackerconn__maprow" data-testid="tracker-field-map-row">
              <Select
                aria-label="Tracker field"
                options={pick('any', m.tracker).slice(1)}
                value={m.tracker}
                onChange={(id) => {
                  const f = mappable.find((x) => x.id === id);
                  setMap(map.map((x, j) => (j === i ? { tracker: id, trackerName: f?.name ?? id, type: f?.type ?? x.type, board: x.board || f?.name || '' } : x)));
                }}
                width="100%"
              />
              <Input aria-label="Kanban field" placeholder="Kanban field name" value={m.board} maxLength={60} onChange={(e) => setMap(map.map((x, j) => (j === i ? { ...x, board: e.target.value } : x)))} />
              <span className="fr-trackerconn__fine">{KIND_LABEL[m.type]}</span>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={() => setMap(map.filter((_, j) => j !== i))} />
            </div>
          ))}
          {mappable.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              onClick={() => {
                const f = mappable.find((x) => !map.some((m) => m.tracker === x.id)) ?? mappable[0];
                setMap([...map, { tracker: f.id, trackerName: f.name, type: f.type!, board: f.name }]);
              }}
            >
              Map a field
            </Button>
          ) : (
            <p className="fr-trackerconn__fine">The tracker lists no custom fields Freero can map.</p>
          )}
        </div>
      )}
      {error && (
        <p className="fr-trackerconn__error" role="alert">
          {error}
        </p>
      )}
      <div className="fr-trackerconn__actions">
        <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
          Save field map
        </Button>
      </div>
      <p className="fr-trackerconn__fine">
        A mapped field syncs on every kanban that has a field of that name and kind; importing into a kanban without one adds it. Renaming the kanban field pauses it (nothing is cleared) until the
        names match again.
      </p>
    </div>
  );
}
