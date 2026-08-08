import { initials } from './identity';

type AvatarProps = {
  name: string;
  color?: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  online?: boolean | 'self' | 'off';
  className?: string;
};

const SIZE_CLASS = {
  sm: 'sm',
  md: '',
  lg: 'lg',
} as const;

export default function Avatar({
  name,
  color = '#34d399',
  avatarUrl,
  size = 'md',
  online,
  className = '',
}: AvatarProps) {
  const sizeClass = SIZE_CLASS[size];
  const classes = ['avatar', sizeClass, className].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-hidden={!name}>
      <span className="avatar-face" style={avatarUrl ? undefined : { background: color }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="avatar-img" draggable={false} />
        ) : (
          <span className="avatar-initials">{initials(name)}</span>
        )}
      </span>
      {online === true || online === 'self' ? (
        <span className={`online-dot ${online === 'self' ? 'self' : 'on'}`} />
      ) : online === 'off' || online === false ? (
        <span className="online-dot off" />
      ) : null}
    </span>
  );
}
