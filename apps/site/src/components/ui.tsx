// Building blocks of the marketing pages. Plain server-rendered markup: no client script, no state.
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { asset, SRC_DIR, webpSize } from '../lib/assets';
import type { FaqItem } from '../lib/define';
import { APP } from '../lib/site';

export function Container({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={narrow ? 'wrap wrap--narrow' : 'wrap'}>{children}</div>;
}

export function ButtonLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <a className={`btn btn--${variant}`} href={href}>
      {children}
    </a>
  );
}

export function Hero(props: { kicker?: string; title: ReactNode; lead: ReactNode; actions?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className={props.aside ? 'hero hero--split' : 'hero'}>
      <Container>
        <div className="hero__grid">
          <div className="hero__text">
            {props.kicker ? <p className="kicker">{props.kicker}</p> : null}
            <h1>{props.title}</h1>
            <p className="lead">{props.lead}</p>
            {props.actions ? <div className="actions">{props.actions}</div> : null}
            {props.children}
          </div>
          {props.aside ? <div className="hero__aside">{props.aside}</div> : null}
        </div>
      </Container>
    </header>
  );
}

export function Section(props: { id: string; title: ReactNode; lead?: ReactNode; children?: ReactNode; tone?: 'plain' | 'tint' | 'ink'; narrow?: boolean }) {
  const titleId = `${props.id}-title`;
  return (
    <section id={props.id} className={`section section--${props.tone ?? 'plain'}`} aria-labelledby={titleId}>
      <Container narrow={props.narrow}>
        <h2 id={titleId}>{props.title}</h2>
        {props.lead ? <p className="section__lead">{props.lead}</p> : null}
        {props.children}
      </Container>
    </section>
  );
}

export function Cards({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return <ul className={`cards cards--${cols}`}>{children}</ul>;
}

export function Card(props: { title: ReactNode; children: ReactNode; href?: string; tint?: 'violet' | 'mint' | 'yellow' | 'pink' | 'blue' | 'orange'; mark?: ReactNode }) {
  return (
    <li className={`card${props.tint ? ` card--${props.tint}` : ''}`}>
      {props.mark ? <span className="card__mark" aria-hidden="true">{props.mark}</span> : null}
      <h3 className="card__title">{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
      <div className="card__body">{props.children}</div>
    </li>
  );
}

/** A checklist: what something can / can't do. */
export function Checks({ items, kind }: { items: ReactNode[]; kind: 'yes' | 'no' }) {
  return (
    <ul className={`checks checks--${kind}`}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="visually-hidden">{kind === 'yes' ? 'Can: ' : 'Can’t: '}</span>
          {it}
        </li>
      ))}
    </ul>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>;
}

export function Step({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <li className="step">
      <h3 className="step__title">{title}</h3>
      <div className="step__body">{children}</div>
    </li>
  );
}

/** A command or config to copy. `label` names it for screen readers and above the block. */
export function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="code">
      <figcaption className="code__label">{label}</figcaption>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export interface Prompt {
  prompt: string;
  outcome: ReactNode;
  /** The permission it takes beyond the defaults, if any. */
  needs?: string;
}

export function Prompts({ items }: { items: Prompt[] }) {
  return (
    <ol className="prompts">
      {items.map((p, i) => (
        <li key={i} className="prompt">
          <p className="prompt__ask">
            <span className="visually-hidden">You ask: </span>“{p.prompt}”
          </p>
          <p className="prompt__outcome">
            <span className="prompt__label">What happens</span> {p.outcome}
          </p>
          {p.needs ? <p className="prompt__needs">Needs: {p.needs}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <section id="faq" className="section section--plain" aria-labelledby="faq-title">
      <Container narrow>
        <h2 id="faq-title">Frequently asked questions</h2>
        <div className="faq">
          {items.map((f, i) => (
            <div key={i} className="faq__item">
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function ClosingCta() {
  return (
    <section className="section section--ink cta" aria-labelledby="cta-title">
      <Container narrow>
        <h2 id="cta-title">Bring your team and your agents to one board</h2>
        <p className="section__lead">Free to use, open source, and yours to host. No credit card, no seat count.</p>
        <div className="actions actions--center">
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
          <ButtonLink href="/claude" variant="secondary">
            Connect Claude
          </ButtonLink>
          <ButtonLink href="/chatgpt" variant="secondary">
            Connect ChatGPT
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

/**
 * A comparison-style table with a caption (screen readers announce it). `stack` turns each row into
 * a card on narrow screens, every cell labelled with its column, instead of scrolling sideways.
 */
export function Table({ caption, head, rows, stack }: { caption: string; head: string[]; rows: ReactNode[][]; stack?: boolean }) {
  return (
    <div className={stack ? 'table-wrap table-wrap--stack' : 'table-wrap'} tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j} data-label={stack ? head[j] : undefined}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SHOT_WIDTHS = [800, 1600];

/**
 * A real product screenshot from src/assets/shots/<name>-<width>.webp (captured from the running
 * app by scripts/capture-shots.mjs). Responsive widths, intrinsic size, lazy below the fold.
 */
export function Shot({ name, alt, caption, eager, sizes = '(min-width: 1120px) 1088px, 100vw' }: { name: string; alt: string; caption?: ReactNode; eager?: boolean; sizes?: string }) {
  const files = SHOT_WIDTHS.map((w) => ({ w, rel: `shots/${name}-${w}.webp` })).filter((f) => fs.existsSync(path.join(SRC_DIR, 'assets', f.rel)));
  if (!files.length) throw new Error(`screenshot "${name}" is missing: run scripts/capture-shots.mjs`);
  const largest = files[files.length - 1];
  const { width, height } = webpSize(fs.readFileSync(path.join(SRC_DIR, 'assets', largest.rel)));
  const img = (
    <img
      src={asset(files[0].rel)}
      srcSet={files.map((f) => `${asset(f.rel)} ${f.w}w`).join(', ')}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
  return caption ? (
    <figure className="shot">
      {img}
      <figcaption>{caption}</figcaption>
    </figure>
  ) : (
    <div className="shot">{img}</div>
  );
}
