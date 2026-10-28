import type { ReactNode } from 'react';

/** One card of the settings page. */
export function Section({ id, title, description, children, danger }: { id: string; title: string; description?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section id={id} className={`fr-acct-card${danger ? ' fr-acct-card--danger' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="fr-acct-card__head">
        <h2 id={`${id}-title`}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
