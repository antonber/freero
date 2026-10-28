// AI for a team workspace (KAI-101): turn it on, choose Freero's provider (when the server offers
// it to teams) or the workspace's own (provider, endpoint, model, key), set a monthly token budget
// and who may use it; see this month's usage. The key is write-only: the server seals it and never
// sends it back. Every change is checked again by the server and audited.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AI_PROVIDER_LABELS, type AiAccess, type AiProviderKind, type WorkspaceAiAdmin, type WorkspaceAiPatch, type WorkspaceSummary } from '@freero/shared';
import { Button, Input, Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : e instanceof ApiError && e.status === 502 ? e.message : fallback);

function Row({ label, hint, children }: { label: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="fr-admin-row">
      <div className="fr-admin-row__text">
        <span className="fr-admin-row__label">{label}</span>
        <span className="fr-admin-row__hint">{hint}</span>
      </div>
      <div className="fr-admin-row__control">{children}</div>
    </div>
  );
}

const ACCESS_OPTIONS: SelectOption<AiAccess>[] = [
  { value: 'members', label: 'Members (not guests)' },
  { value: 'admins', label: 'Owners and admins' },
  { value: 'everyone', label: 'Everyone who can edit' },
];
const BUDGETS = [null, 100_000, 500_000, 1_000_000, 5_000_000, 20_000_000];
const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
const budgetLabel = (n: number | null) => (n === null ? 'No budget' : `${tokens(n)} tokens`);

/** Whether this server offers AI at all (the tab shows only then). */
export async function aiOffered(workspaceId: string): Promise<boolean> {
  return api.workspaceAi(workspaceId).then(
    () => true,
    () => false,
  );
}

export function AdminAi({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [data, setData] = useState<WorkspaceAiAdmin | null>(null);
  const [provider, setProvider] = useState<AiProviderKind>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const show = (d: WorkspaceAiAdmin) => {
    setData(d);
    setProvider(d.settings.provider);
    setBaseUrl(d.settings.baseUrl ?? '');
    setModel(d.settings.model ?? '');
    setKey('');
  };

  useEffect(() => {
    api.workspaceAi(workspace.id).then(show, (e) => notify(errorText(e, 'Could not load the AI settings'), 'error'));
  }, [workspace.id, notify]);

  const patch = async (p: WorkspaceAiPatch, done: string, what = 'save') => {
    setBusy(what);
    try {
      show(await api.updateWorkspaceAi(workspace.id, p));
      notify(done, 'success');
    } catch (e) {
      notify(errorText(e, 'Could not save the AI settings'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.testWorkspaceAi(workspace.id);
      notify(`It works: ${r.model} answered.`, 'success');
    } catch (e) {
      notify(errorText(e, 'The connection test failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Spinner />;
  const s = data.settings;
  const own = s.source === 'workspace';
  const canOwn = data.workspaceKeysAllowed;
  const canInstance = data.instance.available;
  const saveOwn = (e: FormEvent) => {
    e.preventDefault();
    void patch(
      { source: 'workspace', provider, baseUrl: baseUrl.trim() || null, model: model.trim() || null, ...(key.trim() ? { apiKey: key.trim() } : {}) },
      'Provider saved',
    );
  };
  const sourceOptions: SelectOption<'instance' | 'workspace'>[] = [
    ...(canInstance ? [{ value: 'instance' as const, label: 'This server’s provider' }] : []),
    ...(canOwn ? [{ value: 'workspace' as const, label: 'Our own provider' }] : []),
  ];
  const budgetOptions: SelectOption<string>[] = [...BUDGETS, ...(BUDGETS.includes(s.monthlyTokenBudget) ? [] : [s.monthlyTokenBudget])].map((b) => ({
    value: b === null ? 'none' : String(b),
    label: budgetLabel(b),
  }));

  return (
    <section aria-labelledby="admin-ai-title">
      <h1 id="admin-ai-title" className="fr-admin__title">
        AI
      </h1>

      <div className="fr-admin-card">
        <Row
          label="AI on this workspace’s boards"
          hint="Generate ideas, cluster notes, summarise and draw diagrams. People preview every result before it’s added to a board."
        >
          <Toggle
            aria-label="AI on this workspace’s boards"
            checked={s.enabled}
            disabled={busy !== null}
            onChange={(on) => void patch({ enabled: on }, on ? 'AI is on for this workspace' : 'AI is off for this workspace')}
          />
        </Row>
        <Row label="Who may use it" hint="Besides being able to edit the board.">
          <Select<AiAccess> aria-label="Who may use AI" options={ACCESS_OPTIONS} value={s.access} onChange={(v) => void patch({ access: v }, 'Saved')} width={230} />
        </Row>
        <Row label="Monthly budget" hint="Tokens (prompt + answer) everyone together may use per calendar month (UTC). AI stops for the rest of the month when it’s used up.">
          <Select<string>
            aria-label="Monthly budget"
            options={budgetOptions}
            value={s.monthlyTokenBudget === null ? 'none' : String(s.monthlyTokenBudget)}
            onChange={(v) => void patch({ monthlyTokenBudget: v === 'none' ? null : Number(v) }, 'Budget saved')}
            width={230}
          />
        </Row>
        <p className="fr-admin-card__note">
          What happens to your data: when someone uses AI, their prompt and the board content the action reads (the selection, or the whole board for a
          summary) are sent to the provider below and processed under that provider’s terms. Freero doesn’t store prompts or answers; the audit log
          records who used AI, on which board, the task, model and tokens. Board text is always passed to the model as data, never as instructions.
        </p>
      </div>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">Provider</h2>
        {sourceOptions.length > 1 ? (
          <Row label="Use" hint={own ? 'Your provider, your key, your bill.' : `${data.instance.provider ?? ''}, run by this Freero server’s operator.`}>
            <Select<'instance' | 'workspace'> aria-label="Provider source" options={sourceOptions} value={s.source} onChange={(v) => void patch({ source: v }, 'Saved')} width={230} />
          </Row>
        ) : (
          <p className="fr-admin-card__note">{canInstance ? `This Freero server’s provider: ${data.instance.provider ?? ''}.` : 'Bring your own provider: your key, your bill.'}</p>
        )}
        {own && canOwn ? (
          <form className="fr-admin-ai__form" onSubmit={saveOwn}>
            <Select<AiProviderKind>
              aria-label="Provider"
              options={(Object.keys(AI_PROVIDER_LABELS) as AiProviderKind[]).map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }))}
              value={provider}
              onChange={setProvider}
              width={420}
            />
            <Input
              label="Endpoint (optional)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
            />
            <Input label={provider === 'anthropic' ? 'Model (optional)' : 'Model'} value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'anthropic' ? 'claude-sonnet-5-5' : 'e.g. gpt-5.1 or llama3.3'} />
            <Input
              label="API key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={s.hasKey ? 'Stored — leave blank to keep it' : provider === 'openai' ? 'Not needed for a local endpoint' : ''}
            />
            <div className="fr-admin-ai__actions">
              <Button type="submit" variant="primary" loading={busy === 'save'}>
                Save provider
              </Button>
              {s.hasKey ? (
                <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void patch({ apiKey: null }, 'Key removed', 'remove')}>
                  Remove key
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        <div className="fr-admin-ai__actions fr-admin-ai__actions--test">
          <Button type="button" variant="secondary" loading={busy === 'test'} disabled={busy !== null && busy !== 'test'} onClick={() => void test()}>
            Test connection
          </Button>
          <span className="fr-admin-row__hint">Sends one tiny request with the saved settings.</span>
        </div>
      </div>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">Usage in {data.usage.month}</h2>
        <p className="fr-admin-card__note">
          {data.usage.requests} {data.usage.requests === 1 ? 'request' : 'requests'} · {tokens(data.usage.inputTokens + data.usage.outputTokens)} tokens
          {s.monthlyTokenBudget !== null ? ` of ${tokens(s.monthlyTokenBudget)}` : ''}
        </p>
        {data.usage.byUser.length ? (
          <div className="fr-admin-table-wrap fr-admin-ai__usage">
            <table className="fr-admin-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Tokens in</th>
                  <th scope="col">Tokens out</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.byUser.map((u) => (
                  <tr key={u.userId}>
                    <td>{u.name}</td>
                    <td>{u.requests}</td>
                    <td>{tokens(u.inputTokens)}</td>
                    <td>{tokens(u.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
