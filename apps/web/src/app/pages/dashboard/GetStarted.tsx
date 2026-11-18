// The dashboard's get-started card, for an account's first two weeks: a few starting points (a
// built-in template, a blank board), connecting an AI agent, inviting someone to a board of theirs,
// and — for accounts made without the sign-up form (a provider) — "How did you find Freero?". Closed
// for good with its ✕ (this browser). Product analytics hears which step was taken, never anything
// typed (CLIENT_PRODUCT_EVENTS `get_started`).
import { useEffect, useState } from 'react';
import { Bot, Lightbulb, ListChecks, Plus, RefreshCcw, UserPlus, Workflow, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { BoardSummary, DiscoverySource } from '@freero/shared';
import { IconButton, Select, type SelectOption } from '@ui';
import { reportProductEvent } from '../../analytics/bridge';
import { useAuth } from '../../auth/AuthContext';
import { t as tr } from './messages';

/** How long after sign-up the card is offered. */
const SHOWN_FOR_MS = 14 * 24 * 3_600_000;

/** Starting points: built-in templates by their public catalog id. */
const STARTS = [
  { template: 'brainstorm', icon: Lightbulb, label: () => tr('startBrainstorm') },
  { template: 'kanban', icon: ListChecks, label: () => tr('startPlan') },
  { template: 'retro-4ls', icon: RefreshCcw, label: () => tr('startRetro') },
  { template: 'flowchart', icon: Workflow, label: () => tr('startFlow') },
] as const;

const SOURCES: Array<SelectOption<DiscoverySource | ''>> = [
  { value: 'search', label: tr('sourceSearch') },
  { value: 'ai_assistant', label: tr('sourceAiAssistant') },
  { value: 'colleague', label: tr('sourceColleague') },
  { value: 'social', label: tr('sourceSocial') },
  { value: 'open_source', label: tr('sourceOpenSource') },
  { value: 'directory', label: tr('sourceDirectory') },
  { value: 'other', label: tr('sourceOther') },
];

const dismissedKey = (userId: string) => `fr.get-started.closed.${userId}`;
function read(key: string, store: () => Storage): boolean {
  try {
    return store().getItem(key) !== null;
  } catch {
    return false;
  }
}
function write(key: string, store: () => Storage): void {
  try {
    store().setItem(key, '1');
  } catch {
    // Private mode: the card may come back next visit.
  }
}

export interface GetStartedProps {
  /** The boards shown on the dashboard (an own one is offered for "Invite someone"). */
  boards: BoardSummary[] | null;
  /** Start a board from a built-in template (the dashboard's ?template= flow). */
  onTemplate(templateId: string): void;
  onBlank(): void;
  /** Open the share dialog of this board. */
  onInvite(board: BoardSummary): void;
}

export function GetStarted({ boards, onTemplate, onBlank, onInvite }: GetStartedProps) {
  const { user, updateProfile } = useAuth();
  const [closed, setClosed] = useState(() => (user ? read(dismissedKey(user.id), () => localStorage) : true));
  const [answered, setAnswered] = useState(false);
  const fresh = !!user && Date.now() - user.createdAt < SHOWN_FOR_MS;
  const visible = fresh && !closed;
  useEffect(() => {
    // Once per browser session, not on every visit to the dashboard.
    if (!visible || read('fr.get-started.shown', () => sessionStorage)) return;
    write('fr.get-started.shown', () => sessionStorage);
    reportProductEvent({ name: 'get_started', step: 'shown' });
  }, [visible]);
  if (!user || !visible) return null;

  const own = (boards ?? []).filter((b) => b.role === 'owner' && b.kind !== 'doc').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  const step = (s: 'template' | 'blank' | 'connect_agent' | 'invite') => reportProductEvent({ name: 'get_started', step: s });
  const close = () => {
    write(dismissedKey(user.id), () => localStorage);
    setClosed(true);
    reportProductEvent({ name: 'get_started', step: 'dismissed' });
  };
  const askSource = user.discoveryAnswered === false && !answered;

  return (
    <section className="fr-dash-start" aria-labelledby="fr-dash-start-title">
      <div className="fr-dash-start__head">
        <div>
          <h2 id="fr-dash-start-title" className="fr-dash-start__title">{tr('getStartedTitle')}</h2>
          <p className="fr-dash-start__sub">{tr('getStartedSub')}</p>
        </div>
        <IconButton icon={X} label={tr('closeGetStarted')} onClick={close} />
      </div>
      <div className="fr-dash-start__starts">
        {STARTS.map(({ template, icon: Icon, label }) => (
          <button
            key={template}
            type="button"
            className="fr-dash-start__start"
            onClick={() => {
              step('template');
              onTemplate(template);
            }}
          >
            <Icon size={18} aria-hidden />
            <span>{label()}</span>
          </button>
        ))}
        <button
          type="button"
          className="fr-dash-start__start"
          onClick={() => {
            step('blank');
            onBlank();
          }}
        >
          <Plus size={18} aria-hidden />
          <span>{tr('startBlank')}</span>
        </button>
      </div>
      <div className="fr-dash-start__more">
        <Link className="fr-dash-start__link" to="/settings/connect" onClick={() => step('connect_agent')}>
          <Bot size={16} aria-hidden />
          {tr('connectAgentStep')}
        </Link>
        {own ? (
          <button
            type="button"
            className="fr-dash-start__link"
            onClick={() => {
              step('invite');
              onInvite(own);
            }}
          >
            <UserPlus size={16} aria-hidden />
            {tr('inviteStep', { board: own.title || tr('untitledBoard') })}
          </button>
        ) : null}
        {askSource ? (
          <div className="fr-dash-start__source">
            <span>{tr('howDidYouFind')}</span>
            <Select<DiscoverySource | ''>
              options={SOURCES}
              value=""
              placeholder={tr('chooseOne')}
              aria-label={tr('howDidYouFind')}
              onChange={(source) => {
                if (!source) return;
                setAnswered(true);
                void updateProfile({ discoverySource: source }).catch(() => undefined);
              }}
            />
          </div>
        ) : answered ? (
          <span className="fr-dash-start__thanks">{tr('thanksForTelling')}</span>
        ) : null}
      </div>
    </section>
  );
}
