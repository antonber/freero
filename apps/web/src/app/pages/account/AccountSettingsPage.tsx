// /settings/<group> — account settings, one group at a time with the groups listed beside them (a
// tab bar on narrow screens). /settings opens Profile; older links that name a section
// (/settings#two-factor, ?section=trackers, the sign-in providers' and Slack's returns) are sent
// to the group that holds it and scrolled to (sections.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Bot, Code, LayoutGrid, Plug, ShieldCheck, SlidersHorizontal, UserRound, Archive, type LucideIcon } from 'lucide-react';
import type { SecurityInfo } from '@freero/shared';
import { Button, Logo } from '@ui';
import { api } from '../../api/client';
import { TrackerConnections } from '../../components/TrackerConnections';
import { HelpMenu } from '../../problems/HelpMenu';
import { AccountDataSections } from './AccountDataSections';
import { ApiTokensSection, ConnectedAppsSection, DeveloperAppsSection } from './ApiSections';
import { NotificationsSections } from './NotificationsSections';
import { PreferencesSections } from './PreferencesSections';
import { ProfileSection } from './ProfileSection';
import { SettingsSection } from './Section';
import { EmailSection, PasswordSection, SessionsSection, SignInMethodsSection, TwoFactorSection } from './SecuritySections';
import { SlackSection } from './SlackSection';
import { groupPath, SETTINGS_GROUPS, settingsTarget, type SettingsGroup } from './sections';
import { t as tr } from './messages';
import './account.css';
import './settings.css';

const ICONS: Record<SettingsGroup, LucideIcon> = {
  profile: UserRound,
  preferences: SlidersHorizontal,
  notifications: Bell,
  security: ShieldCheck,
  integrations: Plug,
  developer: Code,
  account: Archive,
};

function groupTitle(g: SettingsGroup): string {
  switch (g) {
    case 'profile': return tr('group.profile');
    case 'preferences': return tr('group.preferences');
    case 'notifications': return tr('group.notifications');
    case 'security': return tr('group.security');
    case 'integrations': return tr('group.integrations');
    case 'developer': return tr('group.developer');
    case 'account': return tr('group.account');
  }
}

function groupIntro(g: SettingsGroup): string {
  switch (g) {
    case 'profile': return tr('howCollaboratorsSeeYouOn');
    case 'preferences': return tr('intro.preferences');
    case 'notifications': return tr('intro.notifications');
    case 'security': return tr('intro.security');
    case 'integrations': return tr('intro.integrations');
    case 'developer': return tr('intro.developer');
    case 'account': return tr('intro.account');
  }
}

/**
 * Scrolls to the section an address names once it is there: sections render after their data
 * loads, and ones above it may still push it down, so it follows for a moment, until the person
 * scrolls or acts themselves.
 */
function followSection(id: string, root: HTMLElement): () => void {
  let marked = false;
  const scroll = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    if (!marked) {
      marked = true;
      el.classList.add('is-target');
      el.addEventListener('animationend', () => el.classList.remove('is-target'), { once: true });
    }
  };
  const observer = new MutationObserver(scroll);
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, stop, true);
  };
  observer.observe(root, { childList: true, subtree: true });
  for (const e of events) window.addEventListener(e, stop, true);
  const timer = setTimeout(stop, 4000);
  scroll();
  return stop;
}

export function AccountSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const target = settingsTarget(location.pathname, location.search, location.hash);
  const { group, section, redirect } = target;

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect, navigate]);
  useEffect(() => {
    document.title = tr('documentTitle', { group: groupTitle(group) });
  }, [group]);

  // Scroll: to the section a link names, or to the top when another group opens. Tidying the
  // address afterwards (a section dropping ?connected=) changes neither.
  const content = useRef<HTMLElement>(null);
  const following = useRef<(() => void) | null>(null);
  const shown = useRef<SettingsGroup | null>(null);
  useLayoutEffect(() => {
    if (redirect || !content.current) return;
    if (section) {
      following.current?.();
      following.current = followSection(section, content.current);
    } else if (shown.current !== null && shown.current !== group) {
      following.current?.();
      following.current = null;
      window.scrollTo(0, 0);
      content.current.closest('.fr-acct')?.scrollTo(0, 0);
    }
    shown.current = group;
  }, [location.key, redirect]);
  useEffect(() => () => following.current?.(), []);

  // On narrow screens the groups are a tab bar: keep the open one in view.
  const nav = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = nav.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && active && list.scrollWidth > list.clientWidth) {
      const start = active.offsetLeft - list.offsetLeft;
      if (start < list.scrollLeft || start + active.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = start - 16;
    }
  }, [group]);

  const [security, setSecurity] = useState<SecurityInfo | null>(null);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const loadSecurity = useCallback(() => {
    api.security().then(setSecurity, () => undefined);
  }, []);
  useEffect(loadSecurity, [loadSecurity]);
  const securityChanged = useCallback(() => {
    loadSecurity();
    setSessionsVersion((v) => v + 1);
  }, [loadSecurity]);

  return (
    <div className="fr-acct fr-acct--settings">
      <header className="fr-acct__top fr-acct__top--wide">
        <Link to="/app" className="fr-acct__back">
          <ArrowLeft size={16} aria-hidden />{' '}{tr('backToBoards')}</Link>
        <Logo size={26} withWordmark />
        <HelpMenu size={32} />
      </header>
      <div className="fr-acct-layout">
        <nav className="fr-acct-nav" aria-label={tr('accountSettings')}>
          <p className="fr-acct-nav__title">{tr('accountSettings')}</p>
          <ul ref={nav} className="fr-acct-nav__list">
            {SETTINGS_GROUPS.map((g) => {
              const Icon = ICONS[g];
              return (
                <li key={g}>
                  <Link to={groupPath(g)} className={`fr-acct-nav__item${g === group ? ' is-active' : ''}`} aria-current={g === group ? 'page' : undefined}>
                    <Icon size={17} aria-hidden />
                    <span>{groupTitle(g)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main ref={content} className="fr-acct-content">
          <header className="fr-acct-content__head">
            <h1 className="fr-acct__title">{groupTitle(group)}</h1>
            <p>{groupIntro(group)}</p>
          </header>
          {redirect ? null : <Group group={group} security={security} setSecurity={setSecurity} securityChanged={securityChanged} sessionsVersion={sessionsVersion} />}
        </main>
      </div>
    </div>
  );
}

function Group({
  group,
  security,
  setSecurity,
  securityChanged,
  sessionsVersion,
}: {
  group: SettingsGroup;
  security: SecurityInfo | null;
  setSecurity: (s: SecurityInfo) => void;
  securityChanged: () => void;
  sessionsVersion: number;
}) {
  const navigate = useNavigate();
  switch (group) {
    case 'profile':
      return <ProfileSection />;
    case 'preferences':
      return <PreferencesSections />;
    case 'notifications':
      return <NotificationsSections />;
    case 'security':
      return (
        <>
          <EmailSection security={security} />
          <SignInMethodsSection security={security} onChange={setSecurity} />
          <PasswordSection security={security} onChanged={securityChanged} />
          <TwoFactorSection security={security} onChanged={securityChanged} />
          <SessionsSection version={sessionsVersion} />
        </>
      );
    case 'integrations':
      return (
        <>
          <SlackSection />
          <SettingsSection id="connect-agent" title={tr('aiAgents')} description={tr('agents.description')}>
            <div className="fr-acct-form__row fr-acct-form__row--wrap">
              <Button variant="primary" icon={Bot} onClick={() => navigate('/settings/connect')}>{tr('connectAnAgent')}</Button>
              <Button variant="secondary" icon={LayoutGrid} onClick={() => navigate('/apps')}>{tr('appsAgents')}</Button>
            </div>
          </SettingsSection>
          <ConnectedAppsSection />
          <SettingsSection id="trackers" title={tr('yourIssueTrackers')} description={tr('trackers.description')}>
            <TrackerConnections workspaceId={null} />
          </SettingsSection>
        </>
      );
    case 'developer':
      return (
        <>
          <ApiTokensSection />
          <DeveloperAppsSection />
        </>
      );
    case 'account':
      return <AccountDataSections security={security} />;
  }
}
