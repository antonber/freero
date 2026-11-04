import { useEffect, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Logo } from '@ui';
import { LanguagePicker } from '../../components/LanguagePicker';
import { t } from './messages';
import './AuthPage.css';

/** The centered card on the dotted canvas shared by every sign-in related page. */
export function AuthShell({ title, sub, docTitle, children }: { title: string; sub?: ReactNode; docTitle: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${docTitle} · Freero`;
  }, [docTitle]);
  return (
    <div className="fr-authpage">
      <div className="fr-authpage__deco" aria-hidden>
        <span className="fr-authpage__sticky fr-authpage__sticky--a">{t('planTheLaunch')}</span>
        <span className="fr-authpage__sticky fr-authpage__sticky--b">{t('ideasWelcome')}</span>
        <span className="fr-authpage__blob" />
      </div>
      <main className="fr-authcard">
        <a href="/" className="fr-authcard__logo" aria-label={t('freeroHome')}>
          <Logo size={36} />
        </a>
        <h1 className="fr-authcard__title">{title}</h1>
        {sub ? <p className="fr-authcard__sub">{sub}</p> : null}
        {children}
      </main>
      {/* People without an account choose the language here (#5); it's this browser's until they sign up. */}
      <div className="fr-authpage__lang">
        <LanguagePicker size="sm" />
      </div>
    </div>
  );
}

export function AuthNotice({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  return (
    <div className={kind === 'error' ? 'fr-authcard__error' : 'fr-authcard__success'} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'error' ? <CircleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
      <span>{children}</span>
    </div>
  );
}
