import { useEffect, useRef, useState } from 'react';
import { Box, Gem, Type, X } from 'lucide-react';
import type { MapGem } from './mapGems';

type ArFootprintsProps = {
  gems: MapGem[];
  onClose: () => void;
  onSelectGem?: (gem: MapGem) => void;
};

type XrSystem = {
  isSessionSupported?: (mode: string) => Promise<boolean>;
  requestSession?: (
    mode: string,
    options?: { requiredFeatures?: string[]; optionalFeatures?: string[] }
  ) => Promise<XrSessionLike>;
};

type XrSessionLike = {
  end: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
};

/**
 * AR Footprints: WebXR immersive-ar при поддержке,
 * иначе камера телефона (getUserMedia) для поиска меток.
 */
export default function ArFootprints({ gems, onClose, onSelectGem }: ArFootprintsProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'starting' | 'xr' | 'camera'>('starting');
  const [hint, setHint] = useState('Запускаем AR…');
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<XrSessionLike | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const startCameraFallback = async () => {
      setMode('camera');
      setHint(
        gems.length > 0
          ? `Ищем следы рядом · ${gems.length} капсул на карте`
          : 'Наведите камеру — капсулы появятся, когда вы рядом'
      );
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setMode('camera');
          setError(
            'Нет доступа к камере. Разрешите камеру или закройте AR — карта и звонки доступны.'
          );
          setHint('Базовый режим без AR');
        }
      }
    };

    const start = async () => {
      if (
        !navigator.mediaDevices?.getUserMedia &&
        !(navigator as Navigator & { xr?: XrSystem }).xr
      ) {
        setMode('camera');
        setError('AR и камера недоступны на этом устройстве. Используйте карту.');
        setHint('Базовый режим');
        return;
      }

      const xr = (navigator as Navigator & { xr?: XrSystem }).xr;
      try {
        const supported = Boolean(
          xr?.isSessionSupported && (await xr.isSessionSupported('immersive-ar'))
        );
        if (supported && xr?.requestSession) {
          const session = await xr.requestSession('immersive-ar', {
            requiredFeatures: ['local'],
            optionalFeatures: ['hit-test', 'dom-overlay'],
          });
          if (cancelled) {
            await session.end();
            return;
          }
          sessionRef.current = session;
          setMode('xr');
          setHint('WebXR активен · ищите золотые следы в мире');
          session.addEventListener('end', () => {
            sessionRef.current = null;
            if (!cancelled) onClose();
          });
          return;
        }
      } catch (e) {
        console.warn('[P2P Audit] WebXR unavailable — camera fallback', e);
      }
      await startCameraFallback();
    };

    void start();

    return () => {
      cancelled = true;
      stopCamera();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.end().catch(() => undefined);
    };
  }, [gems.length, onClose]);

  const nearby = gems.filter((g) => g.media_url || g.type === 'text').slice(0, 24);

  return (
    <div className="ar-footprints" role="dialog" aria-label="AR Footprints">
      <video
        ref={videoRef}
        className="ar-footprints-video"
        playsInline
        muted
        autoPlay
        aria-hidden={mode !== 'camera'}
      />
      <div className="ar-footprints-veil" aria-hidden />

      <header className="ar-footprints-bar">
        <div className="ar-footprints-title">
          <Box size={18} />
          <div>
            <p className="ar-footprints-eyebrow">AR Footprints</p>
            <p className="ar-footprints-hint">{hint}</p>
          </div>
        </div>
        <button type="button" className="ar-footprints-close" onClick={onClose} aria-label="Закрыть AR">
          <X size={18} />
        </button>
      </header>

      {error && (
        <p className="ar-footprints-error" role="alert">
          {error}
        </p>
      )}

      {mode === 'starting' && !error && (
        <p className="ar-footprints-loading">Подключаем камеру…</p>
      )}

      {nearby.length > 0 && (
        <div className="ar-footprints-rail" aria-label="Капсулы поблизости">
          <p className="ar-footprints-rail-title">
            <Gem size={14} /> Капсулы
          </p>
          <div className="ar-footprints-thumbs">
            {nearby.map((gem) => (
              <button
                key={gem.id}
                type="button"
                className="ar-footprints-thumb"
                onClick={() => onSelectGem?.(gem)}
                aria-label={
                  gem.type === 'photo'
                    ? 'Фото-капсула'
                    : gem.type === 'video'
                      ? 'Видео-капсула'
                      : 'Текстовая капсула'
                }
              >
                {gem.type === 'photo' && gem.media_url ? (
                  <img src={gem.media_url} alt="" draggable={false} />
                ) : gem.type === 'video' && gem.media_url ? (
                  <video src={gem.media_url} muted playsInline preload="metadata" />
                ) : (
                  <span className="ar-footprints-thumb-fallback">
                    <Type size={18} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
