import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useLanguage } from './i18n';
import { applyThemeSpectrum, nearestStopLabel, zipLiftTrackGradient } from './themeSpectrum';

type ZipLiftSliderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

/** Horizontal color-spectrum track — morphs global theme in real time. */
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
    (next: number) => {
      applyThemeSpectrum(next / 100);
      onChange(next);
    },
    [onChange]
  );

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyLive(valueFromClientX(e.clientX));
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    applyLive(valueFromClientX(e.clientX));
  };

  const onTrackPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  const label = nearestStopLabel(value / 100);

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
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={label}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        onKeyDown={(e) => {
          if (disabled) return;
          let next = value;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(100, value + 2);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, value - 2);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = 100;
          else return;
          e.preventDefault();
          applyLive(next);
        }}
      >
        <span className="zip-lift-thumb" style={{ left: `${value}%` }} aria-hidden />
      </div>
    </div>
  );
}
