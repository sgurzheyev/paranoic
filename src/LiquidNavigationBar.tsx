import { Camera, Globe2, MessageCircle } from 'lucide-react';

export type LiquidNavTab = 'chat' | 'camera' | 'map';

type LiquidNavigationBarProps = {
  active: LiquidNavTab;
  onChat: () => void;
  onCamera: () => void;
  onMap: () => void;
};

const TABS: { id: LiquidNavTab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Чат', icon: MessageCircle },
  { id: 'camera', label: 'Камера', icon: Camera },
  { id: 'map', label: 'Карта', icon: Globe2 },
];

/**
 * Нижняя Liquid Navigation — только при активном соединении / звонке.
 * Blob плавно едет под активной иконкой (CSS transform).
 */
export default function LiquidNavigationBar({
  active,
  onChat,
  onCamera,
  onMap,
}: LiquidNavigationBarProps) {
  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.id === active)
  );

  const handlers: Record<LiquidNavTab, () => void> = {
    chat: onChat,
    camera: onCamera,
    map: onMap,
  };

  return (
    <nav className="liquid-nav" aria-label="Навигация сессии">
      <div className="liquid-nav-panel">
        <span
          className="liquid-nav-blob"
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
