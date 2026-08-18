import { Camera, MessageCircle, Settings2, UserRound, Users } from 'lucide-react';

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

const TABS: { id: LiquidNavTab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chats', label: 'Чаты', icon: MessageCircle },
  { id: 'contacts', label: 'Контакты', icon: Users },
  { id: 'settings', label: 'Настройки', icon: Settings2 },
  { id: 'profile', label: 'Профиль', icon: UserRound },
];

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
  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.id === active)
  );

  const handlers: Record<LiquidNavTab, () => void> = {
    chats: onChats,
    contacts: onContacts,
    settings: onSettings,
    profile: onProfile,
  };

  return (
    <nav className="liquid-nav pb-[max(16px,env(safe-area-inset-bottom))]" aria-label="Главная навигация">
      <div className="liquid-nav-panel liquid-nav-panel--tabs4">
        <span
          className="liquid-nav-blob liquid-nav-blob--tabs4"
          aria-hidden
          style={{
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              className={`liquid-nav-btn${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
              onClick={handlers[tab.id]}
            >
              <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
              <span className="liquid-nav-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Заглушка: иконка камеры больше не в таббаре, но может пригодиться в оверлее. */
export { Camera };
