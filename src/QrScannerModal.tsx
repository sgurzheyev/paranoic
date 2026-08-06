import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode, type Html5QrcodeCameraScanConfig } from 'html5-qrcode';
import { CameraOff, X } from 'lucide-react';

type QrScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onScan: (text: string) => void | Promise<void>;
  /** Запасной вариант при бликах экрана — закрыть сканер и ввести ссылку вручную. */
  onManualEntry?: () => void;
};

const HIGH_RES_CAMERA: MediaTrackConstraints = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

const HIGH_RES_USER_CAMERA: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

export default function QrScannerModal({
  open,
  onClose,
  onScan,
  onManualEntry,
}: QrScannerModalProps) {
  const reactId = useId().replace(/:/g, '');
  const regionId = `qr-reader-${reactId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handlingRef = useRef(false);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    handlingRef.current = false;
    setStatus('starting');
    setErrorText('');

    const scanner = new Html5Qrcode(regionId, { verbose: false });
    scannerRef.current = scanner;

    const config: Html5QrcodeCameraScanConfig = {
      fps: 12,
      qrbox: (viewW, viewH) => {
        const side = Math.floor(Math.min(viewW, viewH) * 0.78);
        return { width: side, height: side };
      },
      aspectRatio: 1,
      disableFlip: false,
      videoConstraints: HIGH_RES_CAMERA,
    };

    const onSuccess = async (decoded: string) => {
      if (handlingRef.current || cancelled) return;
      handlingRef.current = true;
      try {
        await onScan(decoded);
      } catch {
        handlingRef.current = false;
      }
    };

    async function start() {
      try {
        await scanner.start(HIGH_RES_CAMERA, config, onSuccess, () => undefined);
        if (!cancelled) setStatus('scanning');
      } catch {
        try {
          await scanner.start(
            HIGH_RES_USER_CAMERA,
            { ...config, videoConstraints: HIGH_RES_USER_CAMERA },
            onSuccess,
            () => undefined
          );
          if (!cancelled) setStatus('scanning');
        } catch {
          if (!cancelled) {
            setStatus('error');
            setErrorText('Камера недоступна. Разрешите доступ в настройках браузера.');
          }
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      const current = scannerRef.current;
      scannerRef.current = null;
      if (current) {
        void current
          .stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              current.clear();
            } catch {
              /* */
            }
          });
      }
    };
  }, [open, onScan, regionId]);

  if (!open) return null;

  return (
    <div className="qr-modal-backdrop" role="dialog" aria-modal="true" aria-label="Сканер QR-кода">
      <div className="qr-modal">
        <div className="qr-modal-head">
          <h3>Сканировать QR ответа</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={22} />
          </button>
        </div>

        <div className="qr-stage">
          <div id={regionId} className="qr-reader" />
          {status === 'scanning' && (
            <div className="qr-focus" aria-hidden>
              <span className="qr-focus-corner tl" />
              <span className="qr-focus-corner tr" />
              <span className="qr-focus-corner bl" />
              <span className="qr-focus-corner br" />
              <span className="qr-scan-line" />
            </div>
          )}
          {status === 'starting' && (
            <div className="qr-overlay">
              <span className="btn-spinner" />
              <p>Включаем камеру…</p>
            </div>
          )}
          {status === 'error' && (
            <div className="qr-overlay error">
              <CameraOff size={36} />
              <p>{errorText}</p>
              <button type="button" className="text-link" onClick={onClose}>
                Закрыть
              </button>
            </div>
          )}
        </div>

        {status === 'scanning' && (
          <p className="qr-hint">Наведите камеру на QR-код с телефона близкого</p>
        )}

        <button
          type="button"
          className="text-link qr-manual"
          onClick={() => {
            onClose();
            onManualEntry?.();
          }}
        >
          Ввести ссылку вручную
        </button>
      </div>
    </div>
  );
}
