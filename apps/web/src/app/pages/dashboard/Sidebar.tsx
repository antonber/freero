import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, Clock, Folder, House, LogOut, Settings, Star, Trash2, Users } from 'lucide-react';
import { Avatar, Logo, Menu, Tooltip } from '@ui';
import { useAuth } from '../../auth/AuthContext';
import { useMediaQuery } from '../../lib/hooks';

export type View = 'home' | 'recent' | 'starred' | 'shared' | 'mine' | 'trash';

export const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'mine', label: 'My boards', icon: Folder },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

export function Sidebar({ view, onView }: { view: View; onView: (v: View) => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accountRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const compact = useMediaQuery('(max-width: 1000px)');
  if (!user) return null;

  return (
    <aside className="fr-sidebar">
      <Link to="/app" className="fr-sidebar__brand" aria-label="Freero home" onClick={() => onView('home')}>
        <Logo size={28} withWordmark />
      </Link>
      <Link to="/app" className="fr-sidebar__brand fr-sidebar__brand--compact" aria-label="Freero home" onClick={() => onView('home')}>
        <Logo size={30} />
      </Link>

      <nav className="fr-sidebar__nav" aria-label="Boards">
        {NAV.map((n) => (
          <Tooltip key={n.id} content={n.label} side="right" disabled={!compact}>
            <button
              type="button"
              className={`fr-nav${view === n.id ? ' fr-nav--active' : ''}`}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => onView(n.id)}
            >
              <n.icon size={18} aria-hidden />
              <span className="fr-nav__label">{n.label}</span>
            </button>
          </Tooltip>
        ))}
      </nav>

      <div className="fr-sidebar__spacer" />

      <button
        ref={accountRef}
        type="button"
        className={`fr-account${menuOpen ? ' fr-account--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Account menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Avatar name={user.name} color={user.color} src={user.avatarUrl} size={32} />
        <span className="fr-account__text">
          <span className="fr-account__name">{user.name}</span>
          <span className="fr-account__email">{user.email}</span>
        </span>
        <ChevronsUpDown className="fr-account__chev" size={15} aria-hidden />
      </button>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={accountRef.current}
        side="top"
        align="start"
        minWidth={220}
        aria-label="Account"
        items={[
          { heading: user.email },
          { id: 'settings', label: 'Account settings', icon: Settings, onSelect: () => navigate('/settings') },
          { divider: true },
          {
            id: 'logout',
            label: 'Log out',
            icon: LogOut,
            onSelect: async () => {
              await logout();
              navigate('/', { replace: true });
            },
          },
        ]}
      />
    </aside>
  );
}
