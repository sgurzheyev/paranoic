import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useLanguage } from './i18n';
import {
  applyThemeSpectrum,
  nearestStopLabel,
  snapThemeSpectrum,
  THEME_STOP_COUNT,
  themeSpectrumFromStopIndex,
  themeStopIndex,
  zipLiftTrackGradient,
} from './themeSpectrum';

type ZipLiftSliderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

/** Horizontal country-flag spectrum — morphs global theme across 10 language stops. */
export default function ZipLiftSlider({ value, onChange, disabled }: ZipLiftSliderProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const valueFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * 100);
  }, [value]);

  const applyLive = useCallback(
    (next: number, opts?: { snap?: boolean }) => {
      const resolved = opts?.snap === false ? next : snapThemeSpectrum(next);
      applyThemeSpectrum(resolved / 100);
      onChange(resolved);
    },
    [onChange]
  );

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Continuous while dragging for smooth lerp between neighboring flags.
    applyLive(valueFromClientX(e.clientX), { snap: false });
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    applyLive(valueFromClientX(e.clientX), { snap: false });
  };

  const onTrackPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
    applyLive(valueFromClientX(e.clientX), { snap: true });
  };

  const label = nearestStopLabel(value / 100);
  const stopIdx = themeStopIndex(value / 100);

  return (
    <div className="zip-lift">
      <div className="zip-lift-head">
        <span className="zip-lift-title">{t('profileModal.themeBackground')}</span>
        <span className="zip-lift-badge">{label}</span>
      </div>
      <div
        ref={trackRef}
        className={`zip-lift-track${disabled ? ' is-disabled' : ''}`}
        style={{ background: zipLiftTrackGradient() }}
        role="slider"
        aria-label={t('profileModal.themeBackground')}
        aria-valuemin={0}
        aria-valuemax={THEME_STOP_COUNT - 1}
        aria-valuenow={stopIdx}
        aria-valuetext={label}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        onKeyDown={(e) => {
          if (disabled) return;
          let nextIdx = stopIdx;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            nextIdx = Math.min(THEME_STOP_COUNT - 1, stopIdx + 1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            nextIdx = Math.max(0, stopIdx - 1);
          } else if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = THEME_STOP_COUNT - 1;
          else return;
          e.preventDefault();
          applyLive(themeSpectrumFromStopIndex(nextIdx), { snap: true });
        }}
      >
        <span className="zip-lift-thumb" style={{ left: `${value}%` }} aria-hidden />
      </div>
    </div>
  );
}
