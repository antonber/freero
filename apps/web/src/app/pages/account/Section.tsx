import type { ReactNode } from 'react';
import type { SettingsSectionId } from './sections';

interface SectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  danger?: boolean;
  /** Beside the title: a short status ("Saved"). */
  aside?: ReactNode;
}

/** One card of the settings page (and of the pages that share its look). */
export function Section({ id, title, description, children, danger, aside }: SectionProps) {
  return (
    <section id={id} className={`fr-acct-card${danger ? ' fr-acct-card--danger' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="fr-acct-card__head">
        <div className="fr-acct-card__title">
          <h2 id={`${id}-title`}>{title}</h2>
          {aside}
        </div>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * A section of account settings. Its id is its anchor, and must name its group in SECTION_GROUP
 * (sections.ts), so /settings#<id> links open the right group.
 */
export function SettingsSection(props: SectionProps & { id: SettingsSectionId }) {
  return <Section {...props} />;
}
