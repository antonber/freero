// AI for a team workspace (KAI-101): turn it on, choose Freero's provider (when the server offers
// it to teams) or the workspace's own (provider, endpoint, model, key), set a monthly token budget
// and who may use it; see this month's usage. The key is write-only: the server seals it and never
// sends it back. Every change is checked again by the server and audited.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AI_PROVIDER_LABELS, type AiAccess, type AiProviderKind, type WorkspaceAiAdmin, type WorkspaceAiPatch, type WorkspaceSummary } from '@freero/shared';
import { Button, Input, Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
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
  { value: 'members', label: t('membersNotGuests') },
  { value: 'admins', label: t('ownersAndAdmins') },
  { value: 'everyone', label: t('everyoneWhoCanEdit') },
];
const BUDGETS = [null, 100_000, 500_000, 1_000_000, 5_000_000, 20_000_000];
const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
const budgetLabel = (n: number | null) => (n === null ? t('noBudget') : `${tokens(n)} tokens`);

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
    api.workspaceAi(workspace.id).then(show, (e) => notify(errorText(e, t('couldNotLoadTheAi')), 'error'));
  }, [workspace.id, notify]);

  const patch = async (p: WorkspaceAiPatch, done: string, what = 'save') => {
    setBusy(what);
    try {
      show(await api.updateWorkspaceAi(workspace.id, p));
      notify(done, 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotSaveTheAi')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.testWorkspaceAi(workspace.id);
      notify(t('itWorksModelAnswered', { model: r.model }), 'success');
    } catch (e) {
      notify(errorText(e, t('theConnectionTestFailed')), 'error');
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
      t('providerSaved'),
    );
  };
  const sourceOptions: SelectOption<'instance' | 'workspace'>[] = [
    ...(canInstance ? [{ value: 'instance' as const, label: t('thisServerSProvider') }] : []),
    ...(canOwn ? [{ value: 'workspace' as const, label: t('ourOwnProvider') }] : []),
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
          label={t('aiOnThisWorkspaceS')}
          hint={t('generateIdeasClusterNotesSummarise')}
        >
          <Toggle
            aria-label={t('aiOnThisWorkspaceS')}
            checked={s.enabled}
            disabled={busy !== null}
            onChange={(on) => void patch({ enabled: on }, on ? t('aiIsOnForThis') : t('aiIsOffForThis'))}
          />
        </Row>
        <Row label={t('whoMayUseIt')} hint={t('besidesBeingAbleToEdit')}>
          <Select<AiAccess> aria-label={t('whoMayUseAi')} options={ACCESS_OPTIONS} value={s.access} onChange={(v) => void patch({ access: v }, 'Saved')} width={230} />
        </Row>
        <Row label={t('monthlyBudget')} hint={t('tokensPromptAnswerEveryoneTogether')}>
          <Select<string>
            aria-label={t('monthlyBudget')}
            options={budgetOptions}
            value={s.monthlyTokenBudget === null ? 'none' : String(s.monthlyTokenBudget)}
            onChange={(v) => void patch({ monthlyTokenBudget: v === 'none' ? null : Number(v) }, t('budgetSaved'))}
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
        <h2 className="fr-admin-card__title">{t('provider')}</h2>
        {sourceOptions.length > 1 ? (
          <Row label={t('use')} hint={own ? t('yourProviderYourKeyYour') : t('valueRunByThisFreero', { value: data.instance.provider ?? '' })}>
            <Select<'instance' | 'workspace'> aria-label={t('providerSource')} options={sourceOptions} value={s.source} onChange={(v) => void patch({ source: v }, 'Saved')} width={230} />
          </Row>
        ) : (
          <p className="fr-admin-card__note">{canInstance ? t('thisFreeroServerSProvider', { value: data.instance.provider ?? '' }) : t('bringYourOwnProviderYour')}</p>
        )}
        {own && canOwn ? (
          <form className="fr-admin-ai__form" onSubmit={saveOwn}>
            <Select<AiProviderKind>
              aria-label={t('provider')}
              options={(Object.keys(AI_PROVIDER_LABELS) as AiProviderKind[]).map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }))}
              value={provider}
              onChange={setProvider}
              width={420}
            />
            <Input
              label={t('endpointOptional')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
            />
            <Input label={provider === 'anthropic' ? t('modelOptional') : t('model')} value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'anthropic' ? 'claude-sonnet-5-5' : t('eGGpt51')} />
            <Input
              label={t('apiKey')}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={s.hasKey ? t('storedLeaveBlankToKeep') : provider === 'openai' ? t('notNeededForALocal') : ''}
            />
            <div className="fr-admin-ai__actions">
              <Button type="submit" variant="primary" loading={busy === 'save'}>{t('saveProvider')}</Button>
              {s.hasKey ? (
                <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void patch({ apiKey: null }, t('keyRemoved'), 'remove')}>{t('removeKey')}</Button>
              ) : null}
            </div>
          </form>
        ) : null}
        <div className="fr-admin-ai__actions fr-admin-ai__actions--test">
          <Button type="button" variant="secondary" loading={busy === 'test'} disabled={busy !== null && busy !== 'test'} onClick={() => void test()}>{t('testConnection')}</Button>
          <span className="fr-admin-row__hint">{t('sendsOneTinyRequestWith')}</span>
        </div>
      </div>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{t('usageInMonth', { month: data.usage.month })}</h2>
        <p className="fr-admin-card__note">{t('requestsRequestsTokensTokens', { requests: data.usage.requests, tokens: tokens(data.usage.inputTokens + data.usage.outputTokens) })}{s.monthlyTokenBudget !== null ? t('ofTokens', { tokens: tokens(s.monthlyTokenBudget) }) : ''}
        </p>
        {data.usage.byUser.length ? (
          <div className="fr-admin-table-wrap fr-admin-ai__usage">
            <table className="fr-admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('person')}</th>
                  <th scope="col">{t('requests')}</th>
                  <th scope="col">{t('tokensIn')}</th>
                  <th scope="col">{t('tokensOut')}</th>
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
