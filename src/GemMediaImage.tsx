import { useEffect, useState } from 'react';
import { GEM_IMAGE_FALLBACK, gemImageProps } from './gemImage';

type GemMediaImageProps = {
  src: string;
  className: string;
  fallbackClassName?: string;
};

/** Фото капсулы с no-referrer и fallback 💎 при ошибке загрузки. */
export default function GemMediaImage({
  src,
  className,
  fallbackClassName = 'memory-gem-media-fallback',
}: GemMediaImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <span className={fallbackClassName} aria-hidden>
        {GEM_IMAGE_FALLBACK}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={className}
      draggable={false}
      {...gemImageProps}
      onError={() => setFailed(true)}
    />
  );
}
