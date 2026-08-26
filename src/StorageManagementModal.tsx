import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  FileText,
  Image,
  Map,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import { useLanguage } from './i18n';
import {
  clearStorageCategory,
  estimateStorageBreakdown,
  type StorageCategoryId,
  type StorageBreakdownBytes,
} from './storageManagement';

type StorageManagementModalProps = {
  open: boolean;
  onClose: () => void;
};

type Category = {
  id: StorageCategoryId;
  icon: typeof FileText;
};

const CATEGORIES: Category[] = [
  { id: 'messages', icon: FileText },
  { id: 'images', icon: Image },
  { id: 'videos', icon: Video },
  { id: 'mapbox', icon: Map },
];

const EMPTY_BREAKDOWN: StorageBreakdownBytes = {
  messages: 0,
  images: 0,
  videos: 0,
  mapbox: 0,
};

/** Same formatting as SettingsPanel local-storage row. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Privacy-focused local storage management (Play Store screenshot surface).
 * Sizes and deletes use real IndexedDB + Mapbox Cache API data.
 */
export default function StorageManagementModal({
  open,
  onClose,
}: StorageManagementModalProps) {
  const { t } = useLanguage();
  const [usageLabel, setUsageLabel] = useState(t('settings.counting'));
  const [breakdown, setBreakdown] = useState<StorageBreakdownBytes>(EMPTY_BREAKDOWN);
  const [sizesReady, setSizesReady] = useState(false);
  const [deleting, setDeleting] = useState<StorageCategoryId | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const refreshTotals = async (cancelled?: () => boolean) => {
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (cancelled?.()) return;
        const used = est.usage ?? 0;
        const quota = est.quota ?? 0;
        setUsageLabel(
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
    if (!cancelled?.()) setUsageLabel(t('settings.localOnDevice'));
  };

  const refreshBreakdown = async (cancelled?: () => boolean) => {
    try {
      const next = await estimateStorageBreakdown();
      if (cancelled?.()) return;
      setBreakdown(next);
      setSizesReady(true);
    } catch {
      if (!cancelled?.()) {
        setBreakdown(EMPTY_BREAKDOWN);
        setSizesReady(true);
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    setSizesReady(false);
    setUsageLabel(t('settings.counting'));
    void refreshTotals(isCancelled);
    void refreshBreakdown(isCancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open / locale
  }, [open, t]);

  if (!open || typeof document === 'undefined') return null;

  const categoryLabel = (id: StorageCategoryId) => t(`settings.storageMgmt.cat.${id}`);

  const handleDelete = async (id: StorageCategoryId) => {
    if (deleting) return;
    const ok = window.confirm(
      'Вы уверены, что хотите удалить эти данные? Это действие необратимо.'
    );
    if (!ok) return;

    setDeleting(id);
    try {
      await clearStorageCategory(id);
      await Promise.all([refreshBreakdown(), refreshTotals()]);
    } catch (e) {
      console.warn('[paranoic storage] clear failed', id, e);
    } finally {
      setDeleting(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(920px,100dvh)] w-full max-w-lg flex-col overflow-hidden rounded-t-[22px] border border-white/10 bg-[#0b0d12] shadow-[0_-12px_48px_rgba(0,0,0,0.55)] sm:rounded-[22px] sm:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-mgmt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-3 py-3">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08] active:scale-[0.97]"
            onClick={onClose}
            aria-label={t('common.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <h2
            id="storage-mgmt-title"
            className="min-w-0 flex-1 truncate text-[1.05rem] font-bold tracking-tight text-slate-50"
          >
            {t('settings.storageMgmt.title')}
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.14em] text-slate-400">
              {t('settings.storageMgmt.totalLabel')}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-50">
              {usageLabel}
            </p>
          </div>

          <div
            className="flex gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.08] px-3.5 py-3.5"
            role="status"
          >
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              <ShieldCheck size={18} aria-hidden />
            </div>
            <p className="text-[0.84rem] leading-relaxed text-emerald-50/95">
              {t('settings.storageMgmt.trustBanner')}
            </p>
          </div>

          <ul className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
            {CATEGORIES.map((cat, index) => {
              const Icon = cat.icon;
              const bytes = breakdown[cat.id];
              const isEmpty = sizesReady && bytes <= 0;
              const isBusy = deleting === cat.id;
              const sizeLabel = !sizesReady
                ? t('settings.counting')
                : bytes <= 0
                  ? '0 KB'
                  : formatBytes(bytes);
              return (
                <li
                  key={cat.id}
                  className={`flex items-center gap-3 px-3.5 py-3${
                    index < CATEGORIES.length - 1 ? ' border-b border-white/[0.07]' : ''
                  }`}
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-teal-300">
                    <Icon size={18} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9rem] font-semibold text-slate-100">
                      {categoryLabel(cat.id)}
                    </p>
                    <p
                      className={`mt-0.5 text-[0.8rem] tabular-nums ${
                        isEmpty ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      {sizeLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(deleting) || isEmpty || !sizesReady}
                    onClick={() => void handleDelete(cat.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[0.75rem] font-semibold text-rose-200 transition hover:bg-rose-500/20 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
                  >
                    <Trash2 size={13} aria-hidden />
                    {isBusy ? t('settings.clearing') : t('settings.storageMgmt.delete')}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="px-0.5 text-[0.82rem] font-semibold leading-snug text-rose-300/95">
            {t('settings.storageMgmt.irreversible')}
          </p>

          <p className="px-0.5 pb-2 text-[0.75rem] leading-relaxed text-slate-500">
            {t('settings.storageMgmt.e2ee')}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
