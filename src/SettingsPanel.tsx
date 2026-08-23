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
import { useLanguage } from './i18n';
import LanguagePickerModal from './i18n/LanguagePickerModal';
import { ensureNotifyPermission } from './notify';
import { EPHEMERAL_TTL_MS, purgeExpiredMessages } from './storage';
import {
  APP_LANGUAGES,
  loadSettings,
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
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function deviceLabel(fallback: string): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad/i.test(ua)) return 'iOS · Safari';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  return fallback;
}

/** Структурированные настройки в стиле защищённых мессенджеров. */
export default function SettingsPanel({
  settings,
  isAdmin,
  onSettingsChange,
  onOpenFamilyMap,
  onOpenAdmin,
}: SettingsPanelProps) {
  const { t, language, setLanguage } = useLanguage();
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [storageLabel, setStorageLabel] = useState(t('settings.counting'));
  const [purging, setPurging] = useState(false);
  const [purgeHint, setPurgeHint] = useState('');

  const patch = (partial: Partial<AppSettings>) => {
    const saved = saveSettings(partial);
    onSettingsChange(saved);
  };

  useEffect(() => {
    let cancelled = false;
    setStorageLabel(t('settings.counting'));
    void (async () => {
      try {
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (cancelled) return;
          const used = est.usage ?? 0;
          const quota = est.quota ?? 0;
          setStorageLabel(
            quota > 0
              ? t('settings.ofQuota', {
                  used: formatBytes(used),
                  quota: formatBytes(quota),
                })
              : formatBytes(used)
          );
          return;
        }
      } catch {
        /* */
      }
      if (!cancelled) setStorageLabel(t('settings.localOnDevice'));
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.ephemeral24h, t]);

  const clearOld = async () => {
    setPurging(true);
    setPurgeHint('');
    try {
      const result = await purgeExpiredMessages(EPHEMERAL_TTL_MS);
      setPurgeHint(
        result.removed > 0
          ? t('settings.cleared', { count: result.removed })
          : t('settings.nothingToClear')
      );
    } catch {
      setPurgeHint(t('settings.clearFailed'));
    } finally {
      setPurging(false);
    }
  };

  const changeLanguage = (next: AppLanguage) => {
    setLanguage(next);
    onSettingsChange(loadSettings());
  };

  const currentLanguage =
    APP_LANGUAGES.find((lang) => lang.id === language) ?? APP_LANGUAGES[0];

  return (
    <div className="tab-panel liquid-glass-card contacts-panel settings-tab">
      <div className="contacts-head">
        <h2>{t('settings.title')}</h2>
      </div>

      <Section title={t('settings.privacy')}>
        <ToggleRow
          icon={<Ghost size={16} />}
          label={t('settings.ghostMode')}
          description={t('settings.ghostModeDesc')}
          checked={settings.ghostMode}
          onChange={(ghostMode) => patch({ ghostMode })}
        />
        <ToggleRow
          icon={<Shield size={16} />}
          label={t('settings.hidePreview')}
          description={t('settings.hidePreviewDesc')}
          checked={!settings.notificationPreview}
          onChange={(hide) => patch({ notificationPreview: !hide })}
        />
        <ToggleRow
          icon={<Timer size={16} />}
          label={t('settings.ephemeral')}
          description={t('settings.ephemeralDesc')}
          checked={settings.ephemeral24h}
          onChange={(ephemeral24h) => patch({ ephemeral24h })}
        />
      </Section>

      <Section title={t('settings.notifications')}>
        <ToggleRow
          icon={settings.notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          label={t('settings.notifications')}
          description={t('settings.notificationsDesc')}
          checked={settings.notificationsEnabled}
          onChange={(notificationsEnabled) => {
            patch({ notificationsEnabled });
            if (notificationsEnabled) void ensureNotifyPermission();
          }}
        />
      </Section>

      <Section title={t('settings.dataMemory')}>
        <NavRow
          icon={<Database size={16} />}
          label={t('settings.localStorage')}
          description={storageLabel}
        />
        <NavRow
          icon={<Timer size={16} />}
          label={purging ? t('settings.clearing') : t('settings.clearOld')}
          description={purgeHint || t('settings.clearOldDesc')}
          onClick={() => {
            if (!purging) void clearOld();
          }}
        />
      </Section>

      <Section title={t('settings.devices')}>
        <NavRow
          icon={<MonitorSmartphone size={16} />}
          label={deviceLabel(t('common.thisDevice'))}
          description={t('settings.activeSession')}
          trailing={<span className="settings-pill">{t('common.now')}</span>}
        />
      </Section>

      <Section title={t('settings.power')}>
        <ToggleRow
          icon={<Zap size={16} />}
          label={t('settings.powerSaving')}
          description={t('settings.powerSavingDesc')}
          checked={settings.powerSaving}
          onChange={(powerSaving) => patch({ powerSaving })}
        />
      </Section>

      <Section title={t('settings.language')}>
        <button
          type="button"
          className="settings-row settings-row--btn settings-lang-trigger"
          aria-haspopup="dialog"
          aria-expanded={languagePickerOpen}
          aria-label={t('settings.languageAria')}
          onClick={() => setLanguagePickerOpen(true)}
        >
          <span className="settings-row-icon" aria-hidden>
            <Languages size={16} />
          </span>
          <span className="settings-row-copy">
            <span className="settings-row-label">{t('settings.language')}</span>
            <p className="settings-lang-current">
              <span className="settings-lang-flag" aria-hidden>
                {currentLanguage.flag}
              </span>
              {currentLanguage.label}
            </p>
          </span>
          <ChevronRight className="settings-row-chevron" size={16} aria-hidden />
        </button>
      </Section>

      <LanguagePickerModal
        open={languagePickerOpen}
        language={language}
        title={t('settings.languagePickerTitle')}
        ariaLabel={t('settings.languagePickerAria')}
        closeLabel={t('common.close')}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={changeLanguage}
      />

      <div className="settings-footer-actions">
        <button type="button" className="mega-btn primary compact" onClick={onOpenFamilyMap}>
          <Globe2 size={16} />
          {t('common.map')}
        </button>
        {isAdmin && (
          <button type="button" className="mega-btn media compact" onClick={onOpenAdmin}>
            <ShieldCheck size={16} />
            {t('settings.adminPanel')}
          </button>
        )}
      </div>
    </div>
  );
}
