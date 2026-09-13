import { useCallback, useState, type KeyboardEvent } from 'react';

type ParanoicLogoProps = {
  size?: number;
  className?: string;
  /** Показать слово Paranoic рядом с иконкой */
  withWordmark?: boolean;
  /** Компактный режим для хедера (без дыхания) */
  compact?: boolean;
  onClick?: () => void;
};

const LOGO_SRC = '/icons/logo-p.png';

/**
 * V1 Glass P — тёмное стекло с cyan-ободком.
 * Bitmap из public/icons/logo-p.png: чётко в хедере и на Auth.
 */
export default function ParanoicLogo({
  size = 72,
  className = '',
  withWordmark = false,
  compact = false,
  onClick,
}: ParanoicLogoProps) {
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
        <img
          className="paranoic-logo-mark"
          src={LOGO_SRC}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      </div>

      {withWordmark && <span className="paranoic-logo-word">Paranoic</span>}
    </div>
  );
}
