import { Ghost, Timer, type LucideIcon } from 'lucide-react';

type PrivacyIconToggleProps = {
  active: boolean;
  onToggle: () => void;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
};

function PrivacyIconToggle({
  active,
  onToggle,
  icon: Icon,
  label,
  disabled,
}: PrivacyIconToggleProps) {
  return (
    <button
      type="button"
      className={`profile-privacy-icon${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon size={17} strokeWidth={2.2} />
      <span className="profile-privacy-icon-ring" aria-hidden />
    </button>
  );
}

type ProfilePrivacyIconsProps = {
  ghostMode: boolean;
  ephemeral24h: boolean;
  onGhostMode: (next: boolean) => void;
  onEphemeral: (next: boolean) => void;
  ghostLabel: string;
  ephemeralLabel: string;
  disabled?: boolean;
};

export default function ProfilePrivacyIcons({
  ghostMode,
  ephemeral24h,
  onGhostMode,
  onEphemeral,
  ghostLabel,
  ephemeralLabel,
  disabled,
}: ProfilePrivacyIconsProps) {
  return (
    <div className="profile-privacy-icons" role="group" aria-label={ghostLabel}>
      <PrivacyIconToggle
        active={ghostMode}
        onToggle={() => onGhostMode(!ghostMode)}
        icon={Ghost}
        label={ghostLabel}
        disabled={disabled}
      />
      <PrivacyIconToggle
        active={ephemeral24h}
        onToggle={() => onEphemeral(!ephemeral24h)}
        icon={Timer}
        label={ephemeralLabel}
        disabled={disabled}
      />
    </div>
  );
}
