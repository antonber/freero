import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Infinity as InfinityIcon,
  LayoutTemplate,
  MousePointer2,
  Pen,
  Presentation,
  Shapes,
  Spline,
  StickyNote,
  Type,
  Users,
} from 'lucide-react';
import { AvatarStack, Button, Logo } from '@ui';
import './LandingPage.css';

const FEATURES = [
  {
    icon: InfinityIcon,
    tint: 'violet',
    title: 'Room for every idea',
    body: 'Pan and zoom across a canvas that never runs out. Group work into frames and jump between them.',
  },
  {
    icon: Users,
    tint: 'mint',
    title: 'Together, in real time',
    body: 'See teammates’ cursors and edits as they happen. No refresh, no “who has the latest version?”',
  },
  {
    icon: StickyNote,
    tint: 'yellow',
    title: 'Stickies, shapes and ink',
    body: 'Jot, sketch and sort with sticky notes, shapes, text and a smooth pen that feels like paper.',
  },
  {
    icon: Spline,
    tint: 'blue',
    title: 'Connect the dots',
    body: 'Draw connectors that follow your shapes, build mind maps and turn messy notes into flows.',
  },
  {
    icon: LayoutTemplate,
    tint: 'pink',
    title: 'Start from a template',
    body: 'Kick off retros, roadmaps and brainstorms in seconds instead of staring at a blank board.',
  },
  {
    icon: Presentation,
    tint: 'orange',
    title: 'Present and share',
    body: 'Walk through frames as slides, invite people with the right access, and export when you’re done.',
  },
] as const;

const PEOPLE = [
  { id: '1', name: 'Maya Chen', color: '#E8590C' },
  { id: '2', name: 'Leo Okafor', color: '#1C7ED6' },
  { id: '3', name: 'Sam Rivera', color: '#2F9E44' },
  { id: '4', name: 'Noor Haddad', color: '#9C36B5' },
  { id: '5', name: 'Ines Duarte', color: '#D6336C' },
];

export function LandingPage() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = 'Freero · The infinite canvas for teams';
  }, []);

  return (
    <div className="fr-landing">
      <header className="fr-landing__nav">
        <Link to="/" className="fr-landing__brand" aria-label="Freero home">
          <Logo size={30} withWordmark />
        </Link>
        <nav className="fr-landing__links" aria-label="Main">
          <a href="#features">Features</a>
        </nav>
        <div className="fr-landing__nav-cta">
          <Button variant="ghost" onClick={() => navigate('/login')}>
            Log in
          </Button>
          <Button variant="primary" onClick={() => navigate('/signup')}>
            Sign up free
          </Button>
        </div>
      </header>

      <main>
        <section className="fr-hero">
          <div className="fr-hero__copy">
            <span className="fr-hero__eyebrow">
              <span className="fr-hero__eyebrow-dot" aria-hidden />
              Real-time whiteboard
            </span>
            <h1 className="fr-hero__title">
              The infinite canvas where <span className="fr-hero__hl">teams think</span> together.
            </h1>
            <p className="fr-hero__lede">
              Freero gives your team one endless board for brainstorms, plans and retros. Sticky notes, shapes,
              diagrams and live cursors, always in sync.
            </p>
            <div className="fr-hero__ctas">
              <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/signup')}>
                Start a board, free
              </Button>
              <Button variant="secondary" size="lg" onClick={() => navigate('/login')}>
                Log in
              </Button>
            </div>
            <p className="fr-hero__note">No credit card. Invite your team in one click.</p>
          </div>

          <HeroCanvas />
        </section>

        <section id="features" className="fr-features" aria-labelledby="features-title">
          <h2 id="features-title" className="fr-section-title">
            Everything a workshop needs, nothing it doesn’t
          </h2>
          <p className="fr-section-sub">Fast, focused tools that get out of the way so the ideas can take the space.</p>
          <div className="fr-features__grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="fr-feature">
                <span className={`fr-feature__icon fr-tint--${f.tint}`}>
                  <f.icon size={20} aria-hidden />
                </span>
                <h3 className="fr-feature__title">{f.title}</h3>
                <p className="fr-feature__body">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fr-cta-band">
          <div className="fr-cta-band__inner">
            <h2 className="fr-cta-band__title">Your next big idea needs room.</h2>
            <p className="fr-cta-band__sub">Open a board, share the link, and start thinking out loud.</p>
            <div className="fr-cta-band__actions">
              <Button variant="primary" size="lg" onClick={() => navigate('/signup')}>
                Create your free account
              </Button>
              <Link to="/login" className="fr-cta-band__link">
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="fr-landing__footer">
        <Logo size={22} withWordmark />
        <span>© {new Date().getFullYear()} Freero. Made for curious teams.</span>
      </footer>
    </div>
  );
}

/** Purely illustrative board built from CSS + SVG (no images). */
function HeroCanvas() {
  return (
    <div className="fr-hero__canvas" aria-hidden>
      <div className="fr-mock">
        <div className="fr-mock__bar">
          <div className="fr-mock__title">
            <Logo size={20} />
            <span>Q3 launch workshop</span>
          </div>
          <div className="fr-mock__bar-right">
            <AvatarStack users={PEOPLE} max={4} size={24} />
            <span className="fr-mock__share">Share</span>
          </div>
        </div>

        <div className="fr-mock__tools">
          <span className="fr-mock__tool fr-mock__tool--on">
            <MousePointer2 size={15} />
          </span>
          <span className="fr-mock__tool">
            <StickyNote size={15} />
          </span>
          <span className="fr-mock__tool">
            <Shapes size={15} />
          </span>
          <span className="fr-mock__tool">
            <Type size={15} />
          </span>
          <span className="fr-mock__tool">
            <Pen size={15} />
          </span>
        </div>

        <div className="fr-mock__frame">
          <span className="fr-mock__frame-label">Ideas</span>
        </div>

        <svg className="fr-mock__links" viewBox="0 0 100 75" preserveAspectRatio="none">
          <path d="M45 33 C 56 33, 56 22, 66 22" />
          <path d="M45 52 C 58 52, 60 58, 70 58" />
        </svg>

        <div className="fr-mock__sticky fr-mock__sticky--yellow" style={{ left: '17%', top: '24%', rotate: '-3deg' }}>
          Guided first board
        </div>
        <div className="fr-mock__sticky fr-mock__sticky--pink" style={{ left: '30%', top: '26%', rotate: '2deg' }}>
          Dark mode?
          <span className="fr-mock__votes">+3</span>
        </div>
        <div className="fr-mock__sticky fr-mock__sticky--mint" style={{ left: '18%', top: '50%', rotate: '1.5deg' }}>
          Weekly demo day
        </div>
        <div className="fr-mock__sticky fr-mock__sticky--violet fr-mock__sticky--selected" style={{ left: '31%', top: '48%', rotate: '-2deg' }}>
          Talk to 10 customers
        </div>

        <div className="fr-mock__shape fr-mock__shape--circle" style={{ left: '66%', top: '20%' }}>
          Launch
        </div>
        <div className="fr-mock__shape fr-mock__shape--pill" style={{ left: '70%', top: '52%' }}>
          Measure
        </div>
        <div className="fr-mock__note" style={{ left: '62%', top: '74%' }}>
          ✓ owners assigned
        </div>

        <Cursor name="Maya" color="#E8590C" className="fr-mock__cursor--a" />
        <Cursor name="Leo" color="#1C7ED6" className="fr-mock__cursor--b" />

        <div className="fr-mock__zoom">
          <span>−</span>
          <span>100%</span>
          <span>+</span>
        </div>
      </div>
    </div>
  );
}

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <div className={`fr-mock__cursor fr-anim ${className}`}>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path d="M2 1.5 L15 8.2 L9.2 9.6 L6.6 15.6 Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span style={{ background: color }}>{name}</span>
    </div>
  );
}
