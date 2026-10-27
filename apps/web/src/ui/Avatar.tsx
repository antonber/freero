import { useState } from 'react';
import { initials, readableTextColor } from './color';
import { Tooltip } from './Tooltip';
import './Avatar.css';

export interface AvatarProps {
  name: string;
  color: string;
  src?: string | null;
  /** Diameter in px (default 32). */
  size?: number;
  /** Adds a white ring (for stacks / over content). */
  ring?: boolean;
  className?: string;
  title?: string;
}

export function Avatar({ name, color, src, size = 32, ring, className, title }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const showImg = !!src && !broken;
  return (
    <span
      className={`fr-avatar${ring ? ' fr-avatar--ring' : ''}${className ? ` ${className}` : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.4)),
        background: showImg ? undefined : color,
        color: readableTextColor(color),
      }}
      role="img"
      aria-label={name}
      title={title}
    >
      {showImg ? <img src={src!} alt="" onError={() => setBroken(true)} draggable={false} /> : initials(name)}
    </span>
  );
}

export interface AvatarStackUser {
  id?: string;
  name: string;
  color: string;
  src?: string | null;
  avatarUrl?: string | null;
}

export interface AvatarStackProps {
  users: AvatarStackUser[];
  /** Max avatars before collapsing into "+N" (default 4). */
  max?: number;
  size?: number;
  className?: string;
  /** Called with the user when an avatar is clicked (e.g. follow). */
  onUserClick?: (user: AvatarStackUser) => void;
}

export function AvatarStack({ users, max = 4, size = 32, className, onUserClick }: AvatarStackProps) {
  const shown = users.length > max ? users.slice(0, max - 1) : users;
  const rest = users.slice(shown.length);
  return (
    <div className={`fr-avatar-stack${className ? ` ${className}` : ''}`} style={{ ['--fr-avatar-overlap' as string]: `${Math.round(size * -0.25)}px` }}>
      {shown.map((u, i) => {
        const av = <Avatar name={u.name} color={u.color} src={u.src ?? u.avatarUrl} size={size} ring />;
        return (
          <Tooltip key={u.id ?? `${u.name}-${i}`} content={u.name} side="bottom">
            {onUserClick ? (
              <button type="button" className="fr-avatar-stack__item fr-avatar-stack__btn" onClick={() => onUserClick(u)} aria-label={u.name}>
                {av}
              </button>
            ) : (
              <span className="fr-avatar-stack__item" tabIndex={-1}>
                {av}
              </span>
            )}
          </Tooltip>
        );
      })}
      {rest.length > 0 ? (
        <Tooltip content={rest.map((u) => u.name).join(', ')} side="bottom">
          <span
            className="fr-avatar-stack__item fr-avatar fr-avatar--ring fr-avatar--more"
            style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
            aria-label={`${rest.length} more`}
          >
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
