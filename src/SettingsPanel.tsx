import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  BellOff,
  ChevronRight,
  Database,
  Ghost,
  Globe2,
  Languages,
  MonitorSmartphone,
  Shield,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react';
import { ensureNotifyPermission } from './notify';
import { EPHEMERAL_TTL_MS, purgeExpiredMessages } from './storage';
import {
  saveSettings,
  type AppLanguage,
  type AppSettings,
} from './settings';

type SettingsPanelProps = {
  settings: AppSettings;
  isAdmin: boolean;
  onSettingsChange: (next: AppSettings) => void;
  onOpenFamilyMap: () => void;
  onOpenAdmin: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-card">{children}</div>
    </section>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-row settings-row--toggle">
      <div className="settings-row-icon">{icon}</div>
      <div className="settings-row-copy">
        <span className="settings-row-label">{label}</span>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`ios-switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ios-switch-knob" />
      </button>
    </div>
  );
}

function NavRow({
  icon,
  label,
  description,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`settings-row${onClick ? ' settings-row--btn' : ''}`}
      onClick={onClick}
    >
      <div className="settings-row-icon">{icon}</div>
      <div className="settings-row-copy">
        <span className="settings-row-label">{label}</span>
        {description ? <p>{description}</p> : null}
      </div>
      {trailing ?? (onClick ? <ChevronRight size={16} className="settings-row-chevron" /> : null)}
    </Tag>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad/i.test(ua)) return 'iOS · Safari';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Это устройство';
}

/** Структурированные настройки в стиле защищённых мессенджеров. */
export default function SettingsPanel({
  settings,
  isAdmin,
  onSettingsChange,
  onOpenFamilyMap,
  onOpenAdmin,
}: SettingsPanelProps) {
  const [storageLabel, setStorageLabel] = useState('Считаем…');
  const [purging, setPurging] = useState(false);
  const [purgeHint, setPurgeHint] = useState('');

  const patch = (partial: Partial<AppSettings>) => {
    const saved = saveSettings(partial);
    onSettingsChange(saved);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (cancelled) return;
          const used = est.usage ?? 0;
          const quota = est.quota ?? 0;
          setStorageLabel(
            quota > 0
              ? `${formatBytes(used)} из ${formatBytes(quota)}`
              : formatBytes(used)
          );
          return;
        }
      } catch {
        /* */
      }
      if (!cancelled) setStorageLabel('Локально на устройстве');
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.ephemeral24h]);

  const clearOld = async () => {
    setPurging(true);
    setPurgeHint('');
    try {
      const result = await purgeExpiredMessages(EPHEMERAL_TTL_MS);
      setPurgeHint(
        result.removed > 0
          ? `Удалено сообщений: ${result.removed}`
          : 'Нечего чистить — всё свежее'
      );
    } catch {
      setPurgeHint('Не удалось очистить');
    } finally {
      setPurging(false);
    }
  };

  const setLanguage = (language: AppLanguage) => {
    patch({ language });
  };

  return (
    <div className="tab-panel liquid-glass-card contacts-panel settings-tab">
      <div className="contacts-head">
        <h2>Настройки</h2>
      </div>

      <Section title="Конфиденциальность">
        <ToggleRow
          icon={<Ghost size={16} />}
          label="Ghost Mode"
          description="На карте вы в Антарктиде, GPS выключен."
          checked={settings.ghostMode}
          onChange={(ghostMode) => patch({ ghostMode })}
        />
        <ToggleRow
          icon={<Shield size={16} />}
          label="Скрывать превью уведомлений"
          description="В баннере только «Новое сообщение», без текста."
          checked={!settings.notificationPreview}
          onChange={(hide) => patch({ notificationPreview: !hide })}
        />
        <ToggleRow
          icon={<Timer size={16} />}
          label="Удалять через 24 часа"
          description="Старые сообщения стираются из локального хранилища."
          checked={settings.ephemeral24h}
          onChange={(ephemeral24h) => patch({ ephemeral24h })}
        />
      </Section>

      <Section title="Уведомления">
        <ToggleRow
          icon={settings.notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          label="Уведомления"
          description="Звук и баннеры входящих вызовов и сообщений."
          checked={settings.notificationsEnabled}
          onChange={(notificationsEnabled) => {
            patch({ notificationsEnabled });
            if (notificationsEnabled) void ensureNotifyPermission();
          }}
        />
      </Section>

      <Section title="Данные и память">
        <NavRow
          icon={<Database size={16} />}
          label="Локальное хранилище"
          description={storageLabel}
        />
        <NavRow
          icon={<Timer size={16} />}
          label={purging ? 'Очистка…' : 'Очистить старые сообщения'}
          description={purgeHint || 'Сообщения старше 24 часов и сироты медиа'}
          onClick={() => {
            if (!purging) void clearOld();
          }}
        />
      </Section>

      <Section title="Устройства">
        <NavRow
          icon={<MonitorSmartphone size={16} />}
          label={deviceLabel()}
          description="Активный сеанс · E2EE на этом устройстве"
          trailing={<span className="settings-pill">Сейчас</span>}
        />
      </Section>

      <Section title="Энергосбережение">
        <ToggleRow
          icon={<Zap size={16} />}
          label="Режим экономии"
          description="Меньше анимаций и фоновой активности интерфейса."
          checked={settings.powerSaving}
          onChange={(powerSaving) => patch({ powerSaving })}
        />
      </Section>

      <Section title="Язык интерфейса">
        <div className="settings-lang-row">
          <div className="settings-row-icon">
            <Languages size={16} />
          </div>
          <div className="settings-lang-options">
            <button
              type="button"
              className={`settings-lang-btn${settings.language === 'ru' ? ' is-active' : ''}`}
              onClick={() => setLanguage('ru')}
            >
              Русский
            </button>
            <button
              type="button"
              className={`settings-lang-btn${settings.language === 'en' ? ' is-active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              English
            </button>
          </div>
        </div>
      </Section>

      <div className="settings-footer-actions">
        <button type="button" className="mega-btn primary compact" onClick={onOpenFamilyMap}>
          <Globe2 size={16} />
          Открыть карту семьи
        </button>
        {isAdmin && (
          <button type="button" className="mega-btn media compact" onClick={onOpenAdmin}>
            <ShieldCheck size={16} />
            Admin Panel
          </button>
        )}
      </div>
    </div>
  );
}
