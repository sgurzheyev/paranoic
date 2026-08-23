import { Camera, MessageCircle, Settings2, UserRound, Users } from 'lucide-react';
import { useLanguage } from './i18n';

export type LiquidNavTab = 'chats' | 'contacts' | 'settings' | 'profile';

/** @deprecated старые вкладки сессии — оставлены для совместимости типов */
export type SessionNavTab = 'chat' | 'camera' | 'map';

type LiquidNavigationBarProps = {
  active: LiquidNavTab;
  onChats: () => void;
  onContacts: () => void;
  onSettings: () => void;
  onProfile: () => void;
};

const TAB_IDS: LiquidNavTab[] = ['chats', 'contacts', 'settings', 'profile'];
const TAB_ICONS = {
  chats: MessageCircle,
  contacts: Users,
  settings: Settings2,
  profile: UserRound,
} as const;

/**
 * Фиксированный Bottom Tab Bar (iOS / modern Android).
 * Скрывается снаружи при открытом чате или активном звонке.
 */
export default function LiquidNavigationBar({
  active,
  onChats,
  onContacts,
  onSettings,
  onProfile,
}: LiquidNavigationBarProps) {
  const { t } = useLanguage();
  const labels: Record<LiquidNavTab, string> = {
    chats: t('nav.chats'),
    contacts: t('nav.contacts'),
    settings: t('nav.settings'),
    profile: t('nav.profile'),
  };
  const activeIndex = Math.max(0, TAB_IDS.findIndex((id) => id === active));

  const handlers: Record<LiquidNavTab, () => void> = {
    chats: onChats,
    contacts: onContacts,
    settings: onSettings,
    profile: onProfile,
  };

  return (
    <nav className="liquid-nav" aria-label={t('nav.aria')}>
      <div className="liquid-nav-panel liquid-nav-panel--tabs4">
        <span
          className="liquid-nav-blob liquid-nav-blob--tabs4"
          aria-hidden
          style={{
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {TAB_IDS.map((id) => {
          const Icon = TAB_ICONS[id];
          const isActive = id === active;
          const label = labels[id];
          return (
            <button
              key={id}
              type="button"
              className={`liquid-nav-btn${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              onClick={handlers[id]}
            >
              <Icon size={18} />
              <span className="liquid-nav-label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Заглушка: иконка камеры больше не в таббаре, но может пригодиться в оверлее. */
export { Camera };
