import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Logo } from '@ui';
import './AuthPage.css';

/** The centered card on the dotted canvas shared by every sign-in related page. */
export function AuthShell({ title, sub, docTitle, children }: { title: string; sub?: ReactNode; docTitle: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${docTitle} · Freero`;
  }, [docTitle]);
  return (
    <div className="fr-authpage">
      <div className="fr-authpage__deco" aria-hidden>
        <span className="fr-authpage__sticky fr-authpage__sticky--a">plan the launch</span>
        <span className="fr-authpage__sticky fr-authpage__sticky--b">ideas welcome</span>
        <span className="fr-authpage__blob" />
      </div>
      <div className="fr-authcard">
        <Link to="/" className="fr-authcard__logo" aria-label="Freero home">
          <Logo size={36} />
        </Link>
        <h1 className="fr-authcard__title">{title}</h1>
        {sub ? <p className="fr-authcard__sub">{sub}</p> : null}
        {children}
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
