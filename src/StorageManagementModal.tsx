import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useLanguage } from './i18n';
import {
  clearStorageCategory,
  estimateStorageBreakdown,
  type StorageCategoryId,
  type StorageBreakdownBytes,
} from './storageManagement';
import './StorageManagementModal.css';

type StorageManagementModalProps = {
  open: boolean;
  onClose: () => void;
};

type LegendId = StorageCategoryId | 'other';

type TankSegment = {
  id: LegendId;
  color: string;
  bytes: number;
};

const EMPTY_BREAKDOWN: StorageBreakdownBytes = {
  messages: 0,
  images: 0,
  videos: 0,
  mapbox: 0,
};

const CATEGORY_COLOR: Record<LegendId, string> = {
  messages: '#FFEB3B',
  images: '#FF9800',
  videos: '#3F51B5',
  mapbox: '#4CAF50',
  other: '#00BCD4',
};

const DELETABLE = new Set<LegendId>(['messages', 'images', 'videos', 'mapbox']);

const LEGEND_ORDER: LegendId[] = ['messages', 'images', 'videos', 'mapbox', 'other'];

/** Same formatting as SettingsPanel local-storage row. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 KB';
  return formatBytes(bytes);
}

function spawnRipple(event: ReactPointerEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.85;
  const ripple = document.createElement('span');
  ripple.className = 'storage-mgmt__ripple';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function StorageTank({ segments, capacityBytes }: { segments: TankSegment[]; capacityBytes: number }) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const clipId = `sm-tank-clip-${uid}`;
  const shadeId = `sm-tank-shade-${uid}`;
  const sheenId = `sm-tank-sheen-${uid}`;
  const voidId = `sm-tank-void-${uid}`;
  const rimId = `sm-tank-rim-${uid}`;

  const X = 34;
  const W = 52;
  const Y = 22;
  const H = 256;
  const R = 26;
  const innerY = Y + 2;
  const innerH = H - 4;
  const innerBottom = innerY + innerH;
  const cx = X + W / 2;
  const total = Math.max(capacityBytes, 1);

  const rects: Array<TankSegment & { y: number; h: number }> = [];
  let cursor = innerBottom;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (seg.bytes <= 0) continue;
    const h = (seg.bytes / total) * innerH;
    cursor -= h;
    rects.push({ ...seg, y: cursor, h });
  }

  const usedBytes = segments.reduce((sum, seg) => sum + seg.bytes, 0);
  const fillTop = usedBytes > 0 ? innerBottom - Math.min(usedBytes, total) * (innerH / total) : innerBottom;
  const surfaceColor = segments.find((seg) => seg.bytes > 0)?.color ?? '#444';
  const showSurface = usedBytes > 0 && fillTop > innerY + 6 && fillTop < innerBottom - 4;

  return (
    <div className="storage-tank" aria-hidden>
      <svg className="storage-tank__svg" viewBox="0 0 120 300" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={voidId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1a1a1a" />
            <stop offset="45%" stopColor="#0a0a0a" />
            <stop offset="100%" stopColor="#000" />
          </linearGradient>
          <linearGradient id={shadeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="18%" stopColor="#fff" stopOpacity="0.1" />
            <stop offset="42%" stopColor="#fff" stopOpacity="0" />
            <stop offset="78%" stopColor="#000" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.48" />
          </linearGradient>
          <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="18%" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.25" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={X} y={Y} width={W} height={H} rx={R} ry={R} />
          </clipPath>
        </defs>

        <ellipse cx={cx} cy={Y + H - 2} rx={W / 2 + 3} ry="8" fill="rgba(0,0,0,0.45)" />

        <rect
          x={X - 1.2}
          y={Y - 1.2}
          width={W + 2.4}
          height={H + 2.4}
          rx={R + 1}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1.2"
        />

        <g clipPath={`url(#${clipId})`}>
          <rect x={X} y={Y} width={W} height={H} fill={`url(#${voidId})`} />
          {rects.map((seg) => (
            <rect
              key={seg.id}
              className="storage-tank__seg"
              x={X}
              y={seg.y}
              width={W}
              height={seg.h}
              fill={seg.color}
            />
          ))}
          {showSurface && (
            <ellipse cx={cx} cy={fillTop} rx={W / 2} ry="7" fill={surfaceColor} opacity="0.95" />
          )}
          <rect x={X} y={Y} width={W} height={H} fill={`url(#${shadeId})`} />
          <rect x={X + 6} y={Y + 14} width={9} height={H - 36} rx="4.5" fill={`url(#${sheenId})`} />
          <rect x={X} y={Y} width={W} height={34} fill={`url(#${rimId})`} />
        </g>

        <ellipse
          cx={cx}
          cy={Y + 11}
          rx={W / 2 - 1}
          ry="9"
          fill="rgba(255,255,255,0.07)"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="1.1"
        />
      </svg>
    </div>
  );
}

function PrivacyNotes({
  trust,
  e2ee,
  warn,
  compact,
}: {
  trust: string;
  e2ee: string;
  warn: string;
  compact?: boolean;
}) {
  return (
    <div className="storage-mgmt__privacy" role="status">
      <ShieldCheck className="storage-mgmt__privacy-icon" size={compact ? 16 : 18} aria-hidden />
      <div className="storage-mgmt__privacy-copy">
        <p>{trust}</p>
        <p className="storage-mgmt__lock">{e2ee}</p>
        <p className="storage-mgmt__warn">{warn}</p>
      </div>
    </div>
  );
}

/**
 * Privacy-focused local storage management (HyperOS-style Storage space).
 * Sizes and deletes use real IndexedDB + Mapbox Cache API data.
 */
export default function StorageManagementModal({
  open,
  onClose,
}: StorageManagementModalProps) {
  const { t } = useLanguage();
  const [breakdown, setBreakdown] = useState<StorageBreakdownBytes>(EMPTY_BREAKDOWN);
  const [sizesReady, setSizesReady] = useState(false);
  const [usedEstimate, setUsedEstimate] = useState(0);
  const [quota, setQuota] = useState(0);
  const [hasQuota, setHasQuota] = useState(false);
  const [totalsReady, setTotalsReady] = useState(false);
  const [deleting, setDeleting] = useState<StorageCategoryId | null>(null);
  const [detailId, setDetailId] = useState<StorageCategoryId | null>(null);

  useEffect(() => {
    if (!open) {
      setDetailId(null);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (detailId) setDetailId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, detailId]);

  const refreshTotals = async (cancelled?: () => boolean) => {
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (cancelled?.()) return;
        const used = est.usage ?? 0;
        const nextQuota = est.quota ?? 0;
        setUsedEstimate(used);
        setQuota(nextQuota);
        setHasQuota(nextQuota > 0);
        setTotalsReady(true);
        return;
      }
    } catch {
      /* */
    }
    if (!cancelled?.()) {
      setHasQuota(false);
      setTotalsReady(true);
    }
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
    setTotalsReady(false);
    void refreshTotals(isCancelled);
    void refreshBreakdown(isCancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open / locale
  }, [open, t]);

  const catSum = breakdown.messages + breakdown.images + breakdown.videos + breakdown.mapbox;
  const usedAppOrEstimate = Math.max(usedEstimate, catSum);
  const otherBytes = Math.max(0, usedAppOrEstimate - catSum);
  const freeBytes = Math.max(0, quota - usedAppOrEstimate);
  const usedRatio = hasQuota && quota > 0 ? usedAppOrEstimate / quota : 1;
  // Origin quota is often tens of GB; below ~12% used, scale the tank to
  // measured usage so category colours stay readable (subtitle still uses quota).
  const tankCapacity =
    hasQuota && usedRatio >= 0.12 ? quota : Math.max(usedAppOrEstimate, 1);

  const tankSegments = useMemo<TankSegment[]>(
    () =>
      LEGEND_ORDER.map((id) => ({
        id,
        color: CATEGORY_COLOR[id],
        bytes: id === 'other' ? otherBytes : breakdown[id],
      })),
    [breakdown, otherBytes]
  );

  const usageLine = !totalsReady
    ? t('settings.counting')
    : hasQuota
      ? t('settings.storageMgmt.usageLine', {
          used: formatStorageSize(usedAppOrEstimate),
          total: formatStorageSize(quota),
          free: formatStorageSize(freeBytes),
        })
      : t('settings.storageMgmt.usageLineNoQuota', {
          used: formatStorageSize(usedAppOrEstimate),
        });

  const categoryLabel = (id: LegendId) => t(`settings.storageMgmt.cat.${id}`);

  const handleClear = async (id: StorageCategoryId, confirmText: string) => {
    if (deleting) return;
    if (!window.confirm(confirmText)) return;
    setDeleting(id);
    try {
      await clearStorageCategory(id);
      await Promise.all([refreshBreakdown(), refreshTotals()]);
      if (id === detailId) setDetailId(null);
    } catch (e) {
      console.warn('[paranoic storage] clear failed', id, e);
    } finally {
      setDeleting(null);
    }
  };

  const handleFreeCache = () => {
    const size = formatStorageSize(breakdown.mapbox);
    void handleClear(
      'mapbox',
      t('settings.storageMgmt.freeCacheConfirm', { size })
    );
  };

  const handleDeleteCategory = (id: StorageCategoryId) => {
    const name = categoryLabel(id);
    const size = formatStorageSize(breakdown[id]);
    const confirmText =
      id === 'mapbox'
        ? t('settings.storageMgmt.freeCacheConfirm', { size })
        : t('settings.storageMgmt.deleteConfirm', { name });
    void handleClear(id, confirmText);
  };

  if (!open || typeof document === 'undefined') return null;

  const title = detailId ? categoryLabel(detailId) : t('settings.storageMgmt.title');
  const backAction = detailId ? () => setDetailId(null) : onClose;
  const mapboxBytes = breakdown.mapbox;
  const canFreeCache = sizesReady && mapboxBytes > 0 && !deleting;

  return createPortal(
    <div className="storage-mgmt-backdrop" role="presentation">
      <div
        className="storage-mgmt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-mgmt-title"
      >
        <header className="storage-mgmt__header">
          <button
            type="button"
            className="storage-mgmt__icon-btn"
            onPointerDown={spawnRipple}
            onClick={backAction}
            aria-label={t('common.back')}
          >
            <ArrowLeft size={20} />
          </button>
          <h2 id="storage-mgmt-title" className="storage-mgmt__title">
            {title}
          </h2>
        </header>

        {!detailId && <p className="storage-mgmt__usage">{usageLine}</p>}

        <div className="storage-mgmt__scroll">
          {detailId ? (
            <CategoryDetail
              id={detailId}
              bytes={breakdown[detailId]}
              sizesReady={sizesReady}
              busy={deleting === detailId}
              deleteLabel={
                deleting === detailId ? t('settings.clearing') : t('settings.storageMgmt.delete')
              }
              onDelete={() => handleDeleteCategory(detailId)}
              trust={t('settings.storageMgmt.trustBanner')}
              e2ee={t('settings.storageMgmt.e2ee')}
              warn={t('settings.storageMgmt.irreversible')}
              label={categoryLabel(detailId)}
            />
          ) : (
            <>
              <div className="storage-mgmt__layout">
                <div className="storage-mgmt__tank-col">
                  <StorageTank segments={tankSegments} capacityBytes={tankCapacity} />
                </div>
                <ul className="storage-mgmt__legend">
                  {LEGEND_ORDER.map((id) => {
                    const bytes = id === 'other' ? otherBytes : breakdown[id];
                    const drillable = DELETABLE.has(id);
                    const sizeLabel = !sizesReady && id !== 'other' ? t('settings.counting') : formatStorageSize(bytes);
                    const pending = !sizesReady && id !== 'other';
                    const rowInner = (
                      <>
                        <span
                          className="storage-mgmt__dot"
                          style={{ background: CATEGORY_COLOR[id], '--dot': CATEGORY_COLOR[id] } as CSSProperties}
                        />
                        <span className="storage-mgmt__row-copy">
                          <span className="storage-mgmt__row-label">{categoryLabel(id)}</span>
                          <span className={`storage-mgmt__row-size${pending ? ' is-pending' : ''}`}>
                            {sizeLabel}
                          </span>
                        </span>
                        {drillable ? (
                          <ChevronRight className="storage-mgmt__chevron" size={18} aria-hidden />
                        ) : (
                          <span className="storage-mgmt__chevron" />
                        )}
                      </>
                    );

                    return (
                      <li key={id}>
                        {drillable ? (
                          <button
                            type="button"
                            className="storage-mgmt__row is-drillable"
                            onPointerDown={spawnRipple}
                            onClick={() => setDetailId(id as StorageCategoryId)}
                          >
                            {rowInner}
                          </button>
                        ) : (
                          <div className="storage-mgmt__row">{rowInner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <PrivacyNotes
                compact
                trust={t('settings.storageMgmt.trustBanner')}
                e2ee={t('settings.storageMgmt.e2ee')}
                warn={t('settings.storageMgmt.irreversible')}
              />
            </>
          )}
        </div>

        {!detailId && (
          <div className="storage-mgmt__footer">
            <button
              type="button"
              className="storage-mgmt__pill"
              disabled={!canFreeCache}
              onPointerDown={canFreeCache ? spawnRipple : undefined}
              onClick={handleFreeCache}
            >
              {deleting === 'mapbox'
                ? t('settings.clearing')
                : t('settings.storageMgmt.freeUp', {
                    size: formatStorageSize(mapboxBytes),
                  })}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function CategoryDetail({
  id,
  bytes,
  sizesReady,
  busy,
  deleteLabel,
  onDelete,
  trust,
  e2ee,
  warn,
  label,
}: {
  id: StorageCategoryId;
  bytes: number;
  sizesReady: boolean;
  busy: boolean;
  deleteLabel: string;
  onDelete: () => void;
  trust: string;
  e2ee: string;
  warn: string;
  label: string;
}) {
  const empty = sizesReady && bytes <= 0;
  return (
    <div className="storage-mgmt__detail">
      <div className="storage-mgmt__detail-kicker">
        <span
          className="storage-mgmt__detail-dot"
          style={{ background: CATEGORY_COLOR[id], '--dot': CATEGORY_COLOR[id] } as CSSProperties}
        />
        {label}
      </div>
      <p className={`storage-mgmt__detail-size${!sizesReady ? ' is-pending' : ''}`}>
        {!sizesReady ? '—' : formatStorageSize(bytes)}
      </p>
      <PrivacyNotes trust={trust} e2ee={e2ee} warn={warn} />
      <div className="storage-mgmt__detail-actions">
        <button
          type="button"
          className="storage-mgmt__pill storage-mgmt__pill--danger"
          disabled={busy || empty || !sizesReady}
          onPointerDown={!busy && !empty && sizesReady ? spawnRipple : undefined}
          onClick={onDelete}
        >
          {deleteLabel}
        </button>
      </div>
    </div>
  );
}
