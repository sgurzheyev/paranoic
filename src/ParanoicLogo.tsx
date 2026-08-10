import { useCallback, useId, useState, type KeyboardEvent } from 'react';

type ParanoicLogoProps = {
  size?: number;
  className?: string;
  /** Показать слово Paranoic рядом с иконкой */
  withWordmark?: boolean;
  /** Компактный режим для хедера (без тяжёлого дыхания) */
  compact?: boolean;
  onClick?: () => void;
};

/**
 * Liquid Glass / Silver Chrome логотип Paranoic.
 * SVG + CSS: жидкое дыхание, хромовый блик, упругий клик с зеркальной волной.
 */
export default function ParanoicLogo({
  size = 72,
  className = '',
  withWordmark = false,
  compact = false,
  onClick,
}: ParanoicLogoProps) {
  const uid = useId().replace(/:/g, '');
  const [rippling, setRippling] = useState(false);

  const handleActivate = useCallback(() => {
    setRippling(true);
    window.setTimeout(() => setRippling(false), 700);
    onClick?.();
  }, [onClick]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <div
      className={`paranoic-logo${compact ? ' is-compact' : ''}${rippling ? ' is-rippling' : ''}${className ? ` ${className}` : ''}`}
      style={{ ['--logo-size' as string]: `${size}px` }}
      role="button"
      tabIndex={0}
      aria-label="Paranoic"
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      <div className="paranoic-logo-orb">
        <span className="paranoic-logo-ripple" aria-hidden />
        <svg
          className="paranoic-logo-svg"
          viewBox="0 0 80 80"
          width={size}
          height={size}
          aria-hidden
        >
          <defs>
            <linearGradient id={`pg-body-${uid}`} x1="18%" y1="8%" x2="82%" y2="92%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
              <stop offset="38%" stopColor="#E2E8F0" stopOpacity="0.78" />
              <stop offset="72%" stopColor="#94A3B8" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#64748B" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id={`pg-edge-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#CBD5E1" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#475569" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id={`pg-liquid-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55">
                <animate
                  attributeName="stop-opacity"
                  values="0.35;0.7;0.35"
                  dur="4.2s"
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="50%" stopColor="#E2E8F0" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#64748B" stopOpacity="0.45">
                <animate
                  attributeName="offset"
                  values="0.85;1;0.85"
                  dur="4.2s"
                  repeatCount="indefinite"
                />
              </stop>
            </linearGradient>
            <linearGradient id={`pg-shine-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="58%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`pg-glow-${uid}`} cx="32%" cy="28%" r="55%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.75" />
              <stop offset="55%" stopColor="#F8FAFC" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#94A3B8" stopOpacity="0" />
            </radialGradient>
            <filter id={`pg-soft-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" />
            </filter>
            <clipPath id={`pg-clip-${uid}`}>
              <path d="M40 6c-12 0-22 4.2-28.5 11.2C5 24.2 2 34 2 40c0 14.5 8.2 26.2 20.8 31.6 5.8 2.5 12.2 3.8 17.2 3.8s11.4-1.3 17.2-3.8C69.8 66.2 78 54.5 78 40c0-6-3-15.8-9.5-22.8C62 10.2 52 6 40 6z" />
            </clipPath>
          </defs>

          <ellipse
            cx="40"
            cy="72"
            rx="22"
            ry="4"
            fill="#0F172A"
            opacity="0.35"
            filter={`url(#pg-soft-${uid})`}
          />

          <path
            className="paranoic-logo-shield"
            d="M40 6c-12 0-22 4.2-28.5 11.2C5 24.2 2 34 2 40c0 14.5 8.2 26.2 20.8 31.6 5.8 2.5 12.2 3.8 17.2 3.8s11.4-1.3 17.2-3.8C69.8 66.2 78 54.5 78 40c0-6-3-15.8-9.5-22.8C62 10.2 52 6 40 6z"
            fill={`url(#pg-body-${uid})`}
            stroke={`url(#pg-edge-${uid})`}
            strokeWidth="1.4"
          />

          <g clipPath={`url(#pg-clip-${uid})`}>
            <rect
              className="paranoic-logo-liquid"
              x="-10"
              y="-10"
              width="100"
              height="100"
              fill={`url(#pg-liquid-${uid})`}
              opacity="0.85"
            />
            <circle
              className="paranoic-logo-blob"
              cx="28"
              cy="26"
              r="18"
              fill={`url(#pg-glow-${uid})`}
            />
            <rect
              className="paranoic-logo-chrome"
              x="-40"
              y="-20"
              width="40"
              height="120"
              fill={`url(#pg-shine-${uid})`}
            >
              <animateTransform
                attributeName="transform"
                type="translate"
                values="-55 0;120 0;-55 0"
                keyTimes="0;0.18;1"
                dur="5.5s"
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.2 1;0.4 0 1 1"
              />
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="28 40 40;28 40 40;28 40 40"
                dur="5.5s"
                repeatCount="indefinite"
                additive="sum"
              />
              <animate
                attributeName="opacity"
                values="0;0;1;0.8;0;0"
                keyTimes="0;0.58;0.66;0.76;0.84;1"
                dur="5.5s"
                repeatCount="indefinite"
              />
            </rect>
          </g>

          <path
            className="paranoic-logo-p"
            d="M30 22h14.5c7.4 0 12.5 4.6 12.5 11.2 0 6.4-4.8 11-12.2 11H37v14.6c0 1.4-.9 2.2-2.2 2.2h-2.6c-1.3 0-2.2-.8-2.2-2.2V24.2c0-1.3.9-2.2 2.2-2.2zm7 6.4v9.2h6.8c3.6 0 5.8-1.9 5.8-4.7s-2.2-4.5-5.8-4.5H37z"
            fill="#0F172A"
            fillOpacity="0.55"
          />
          <path
            d="M30.6 21.4h14.5c7.6 0 13 4.7 13 11.6 0 6.6-5 11.4-12.6 11.4H37.6v14.2c0 .7-.4 1.2-1.1 1.2h-2.8c-.7 0-1.1-.5-1.1-1.2V23c0-.9.6-1.6 1.6-1.6h.4z"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.35"
            strokeWidth="0.8"
          />
        </svg>
      </div>

      {withWordmark && <span className="paranoic-logo-word">Paranoic</span>}
    </div>
  );
}
